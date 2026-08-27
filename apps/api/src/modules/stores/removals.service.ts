import type { AuditAction, Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { conflict, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Remoção dos cadastros.
 *
 * Tudo que entra no sistema pode sair. A regra que decide COMO sair é sempre a
 * mesma: se o registro já foi usado por algo que virou histórico — venda,
 * movimento de estoque, ponto — ele é desativado, não apagado. Apagar
 * quebraria o histórico, que passaria a apontar para o nada e deixaria de
 * conseguir explicar o que aconteceu.
 *
 * Se nada aponta para ele, some de vez: cadastro errado criado há dois minutos
 * não precisa ficar sujando a lista para sempre.
 *
 * Nos dois casos o ato fica auditado, com quem removeu e por quê.
 */

interface RemovalOutcome {
  removido: "apagado" | "desativado";
  mensagem: string;
}

async function finish(params: {
  request: FastifyRequest;
  action: AuditAction;
  entityType: string;
  entityId: string;
  storeId?: string | null;
  reason: string;
  outcome: RemovalOutcome;
  previousData?: Prisma.InputJsonValue | undefined;
}): Promise<RemovalOutcome> {
  await audit(params.request, {
    action: params.action,
    result: "SUCCESS",
    userId: params.request.user.sub,
    companyId: params.request.user.companyId,
    storeId: params.storeId ?? null,
    userRoleSnapshot: params.request.user.role,
    entityType: params.entityType,
    entityId: params.entityId,
    ...(params.previousData ? { previousData: params.previousData } : {}),
    newData: { removido: params.outcome.removido },
    reason: params.reason,
  });

  return params.outcome;
}

// ------------------------------------------------------------------ catálogo

export async function removeCategory(params: {
  categoryId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { categoryId, reason, request } = params;

  const category = await prisma.category.findFirst({
    where: { id: categoryId, companyId: request.user.companyId, deletedAt: null },
    include: { _count: { select: { products: true, children: true } } },
  });
  if (!category) {
    throw notFound("CATEGORY_NOT_FOUND", "Categoria não encontrada.");
  }

  if (category._count.children > 0) {
    throw conflict(
      "HAS_SUBCATEGORIES",
      "Esta categoria tem subcategorias. Remova ou mova as subcategorias antes.",
    );
  }

  const emUso = category._count.products > 0;

  if (emUso) {
    // Os produtos ficam sem categoria em vez de sumirem junto — perder o
    // produto porque a categoria saiu seria bem pior que perder a etiqueta.
    await prisma.$transaction([
      prisma.product.updateMany({ where: { categoryId: category.id }, data: { categoryId: null } }),
      prisma.category.update({
        where: { id: category.id },
        data: { isActive: false, deletedAt: new Date() },
      }),
    ]);
  } else {
    await prisma.category.delete({ where: { id: category.id } });
  }

  return finish({
    request,
    action: "CATEGORY_DELETE",
    entityType: "Category",
    entityId: category.id,
    reason,
    previousData: { code: category.code, name: category.name },
    outcome: {
      removido: emUso ? "desativado" : "apagado",
      mensagem: emUso
        ? `Categoria removida. ${category._count.products} produto(s) ficaram sem categoria.`
        : "Categoria apagada.",
    },
  });
}

export async function removeSizeGrade(params: {
  gradeId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { gradeId, reason, request } = params;

  const grade = await prisma.sizeGrade.findFirst({
    where: { id: gradeId, companyId: request.user.companyId, deletedAt: null },
    include: { _count: { select: { products: true } } },
  });
  if (!grade) {
    throw notFound("GRADE_NOT_FOUND", "Grade não encontrada.");
  }

  if (grade._count.products > 0) {
    throw conflict(
      "GRADE_IN_USE",
      `${grade._count.products} produto(s) usam esta grade. Troque a grade deles antes de remover.`,
    );
  }

  await prisma.sizeGrade.delete({ where: { id: grade.id } });

  return finish({
    request,
    action: "SIZE_GRADE_DELETE",
    entityType: "SizeGrade",
    entityId: grade.id,
    reason,
    previousData: { code: grade.code, name: grade.name },
    outcome: { removido: "apagado", mensagem: "Grade apagada." },
  });
}

/**
 * Remove um tamanho do produto.
 *
 * Recusa quando ainda há peça daquele tamanho na loja: sumir com a variação
 * deixaria o saldo apontando para um tamanho que não existe mais no cadastro.
 */
export async function removeVariation(params: {
  variationId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { variationId, reason, request } = params;

  const variation = await prisma.productVariation.findFirst({
    where: { id: variationId, companyId: request.user.companyId, deletedAt: null },
    include: { _count: { select: { saleItems: true } } },
  });
  if (!variation) {
    throw notFound("VARIATION_NOT_FOUND", "Tamanho não encontrado.");
  }

  const emEstoque = await prisma.stockItem.aggregate({
    where: { variationId: variation.id },
    _sum: { quantity: true },
  });

  if ((emEstoque._sum.quantity ?? 0) > 0) {
    throw conflict(
      "STOCK_REMAINING",
      `Ainda há ${emEstoque._sum.quantity} peça(s) deste tamanho em estoque. Dê baixa antes de remover.`,
    );
  }

  const jaVendido = variation._count.saleItems > 0;

  if (jaVendido) {
    await prisma.productVariation.update({
      where: { id: variation.id },
      data: { isActive: false, deletedAt: new Date() },
    });
  } else {
    await prisma.$transaction([
      prisma.stockItem.deleteMany({ where: { variationId: variation.id } }),
      prisma.productVariation.delete({ where: { id: variation.id } }),
    ]);
  }

  return finish({
    request,
    action: "VARIATION_DELETE",
    entityType: "ProductVariation",
    entityId: variation.id,
    reason,
    previousData: { sku: variation.sku, size: variation.size },
    outcome: {
      removido: jaVendido ? "desativado" : "apagado",
      mensagem: jaVendido
        ? "Tamanho desativado. As vendas antigas continuam apontando para ele."
        : "Tamanho apagado.",
    },
  });
}

// ------------------------------------------------------------------ clientes

export async function removeCustomer(params: {
  customerId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { customerId, reason, request } = params;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: request.user.companyId, deletedAt: null },
    include: {
      _count: { select: { sales: true, reservations: true, quotes: true, serviceOrders: true } },
    },
  });
  if (!customer) {
    throw notFound("CUSTOMER_NOT_FOUND", "Cliente não encontrado.");
  }

  const reservasAtivas = await prisma.reservation.count({
    where: { customerId: customer.id, status: "ATIVA" },
  });
  if (reservasAtivas > 0) {
    throw conflict(
      "ACTIVE_RESERVATIONS",
      `Este cliente tem ${reservasAtivas} reserva(s) ativa(s). Cancele antes de remover.`,
    );
  }

  const temHistorico =
    customer._count.sales > 0 ||
    customer._count.reservations > 0 ||
    customer._count.quotes > 0 ||
    customer._count.serviceOrders > 0;

  if (temHistorico) {
    // O telefone é liberado junto: se a pessoa voltar, o cadastro novo não
    // pode esbarrar no único de telefone de um cliente que "não existe mais".
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        phone: `${customer.phone}#removido-${Date.now()}`,
      },
    });
  } else {
    await prisma.customer.delete({ where: { id: customer.id } });
  }

  return finish({
    request,
    action: "CUSTOMER_DELETE",
    entityType: "Customer",
    entityId: customer.id,
    reason,
    previousData: { name: customer.name },
    outcome: {
      removido: temHistorico ? "desativado" : "apagado",
      mensagem: temHistorico
        ? "Cliente removido. As compras dele continuam no histórico."
        : "Cliente apagado.",
    },
  });
}

// --------------------------------------------------------------- maquininhas

export async function removeTerminal(params: {
  terminalId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { terminalId, reason, request } = params;

  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  await assertStoreAccess(request, terminal.storeId);

  const cobrancas = await prisma.salePayment.count({ where: { terminalId: terminal.id } });
  const jaCobrou = cobrancas > 0;

  if (jaCobrou) {
    // As vendas cobradas por ela precisam continuar apontando para o
    // equipamento que as processou, senão a conciliação não fecha.
    await prisma.paymentTerminal.update({
      where: { id: terminal.id },
      data: { status: "RETIRED", isPrimary: false, deletedAt: new Date() },
    });
  } else {
    await prisma.paymentTerminal.delete({ where: { id: terminal.id } });
  }

  return finish({
    request,
    action: "TERMINAL_DELETE",
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    storeId: terminal.storeId,
    reason,
    previousData: { provider: terminal.provider, serialNumber: terminal.serialNumber },
    outcome: {
      removido: jaCobrou ? "desativado" : "apagado",
      mensagem: jaCobrou
        ? `Maquininha retirada. As ${cobrancas} cobrança(s) dela continuam no histórico.`
        : "Maquininha apagada.",
    },
  });
}

// ------------------------------------------------------------------ etiquetas

export async function removeLabelTemplate(params: {
  templateId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { templateId, reason, request } = params;

  const template = await prisma.labelTemplate.findFirst({
    where: { id: templateId, companyId: request.user.companyId, deletedAt: null },
    include: { _count: { select: { printJobs: true } } },
  });
  if (!template) {
    throw notFound("TEMPLATE_NOT_FOUND", "Modelo não encontrado.");
  }

  const naFila = await prisma.printJob.count({
    where: { templateId: template.id, status: { in: ["NA_FILA", "IMPRIMINDO"] } },
  });
  if (naFila > 0) {
    throw conflict(
      "TEMPLATE_IN_QUEUE",
      `Há ${naFila} etiqueta(s) esperando impressão com este modelo. Cancele ou imprima antes.`,
    );
  }

  const foiUsado = template._count.printJobs > 0;

  if (foiUsado) {
    await prisma.labelTemplate.update({
      where: { id: template.id },
      data: { isActive: false, isDefault: false, deletedAt: new Date() },
    });
  } else {
    await prisma.labelTemplate.delete({ where: { id: template.id } });
  }

  return finish({
    request,
    action: "LABEL_TEMPLATE_DELETE",
    entityType: "LabelTemplate",
    entityId: template.id,
    reason,
    previousData: { code: template.code, name: template.name },
    outcome: {
      removido: foiUsado ? "desativado" : "apagado",
      mensagem: foiUsado ? "Modelo removido do uso." : "Modelo apagado.",
    },
  });
}

// ------------------------------------------------------- comissões e metas

export async function removeCommissionRule(params: {
  ruleId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { ruleId, reason, request } = params;

  const rule = await prisma.commissionRule.findFirst({
    where: { id: ruleId, companyId: request.user.companyId },
  });
  if (!rule) {
    throw notFound("RULE_NOT_FOUND", "Regra não encontrada.");
  }

  // Regra já encerrada some; regra vigente é encerrada com data. A comissão de
  // um mês passado precisa continuar sendo explicável pela regra daquele mês.
  const vigente = rule.isActive && rule.effectiveTo === null;

  if (vigente) {
    await prisma.commissionRule.update({
      where: { id: rule.id },
      data: { isActive: false, effectiveTo: new Date() },
    });
  } else {
    await prisma.commissionRule.delete({ where: { id: rule.id } });
  }

  return finish({
    request,
    action: "COMMISSION_RULE_DELETE",
    entityType: "CommissionRule",
    entityId: rule.id,
    storeId: rule.storeId,
    reason,
    previousData: { name: rule.name, percent: rule.percent.toFixed(3) },
    outcome: {
      removido: vigente ? "desativado" : "apagado",
      mensagem: vigente
        ? "Regra encerrada. As comissões já calculadas por ela continuam válidas."
        : "Regra apagada.",
    },
  });
}

export async function removeGoal(params: {
  goalId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { goalId, reason, request } = params;

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, companyId: request.user.companyId },
  });
  if (!goal) {
    throw notFound("GOAL_NOT_FOUND", "Meta não encontrada.");
  }

  await assertStoreAccess(request, goal.storeId);

  // Meta não é referenciada por nada — o realizado é calculado das vendas.
  // Some de vez, sem deixar lixo.
  await prisma.goal.delete({ where: { id: goal.id } });

  return finish({
    request,
    action: "GOAL_DELETE",
    entityType: "Goal",
    entityId: goal.id,
    storeId: goal.storeId,
    reason,
    previousData: { targetAmount: goal.targetAmount.toFixed(2), periodStart: goal.periodStart },
    outcome: { removido: "apagado", mensagem: "Meta apagada." },
  });
}

// ------------------------------------------------------- estações e caixas

export async function removePOSStation(params: {
  stationId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { stationId, reason, request } = params;

  const station = await prisma.pOSStation.findFirst({
    where: { id: stationId, deletedAt: null, store: { companyId: request.user.companyId } },
    include: { _count: { select: { cashRegisters: true } } },
  });
  if (!station) {
    throw notFound("STATION_NOT_FOUND", "Estação não encontrada.");
  }

  await assertStoreAccess(request, station.storeId);

  if (station._count.cashRegisters > 0) {
    throw conflict(
      "HAS_CASH_REGISTERS",
      "Esta estação tem caixas. Remova os caixas antes de remover a estação.",
    );
  }

  await prisma.pOSStation.delete({ where: { id: station.id } });

  return finish({
    request,
    action: "POS_STATION_DELETE",
    entityType: "POSStation",
    entityId: station.id,
    storeId: station.storeId,
    reason,
    previousData: { code: station.code, name: station.name },
    outcome: { removido: "apagado", mensagem: "Estação apagada." },
  });
}

export async function removeCashRegister(params: {
  registerId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { registerId, reason, request } = params;

  const register = await prisma.cashRegister.findFirst({
    where: { id: registerId, deletedAt: null, posStation: { store: { companyId: request.user.companyId } } },
    include: {
      posStation: { select: { storeId: true } },
      _count: { select: { devices: true, cashSessions: true } },
    },
  });
  if (!register) {
    throw notFound("REGISTER_NOT_FOUND", "Caixa não encontrado.");
  }

  await assertStoreAccess(request, register.posStation.storeId);

  const aberto = await prisma.cashSession.count({
    where: { cashRegisterId: register.id, status: "ABERTO" },
  });
  if (aberto > 0) {
    throw conflict("SESSION_OPEN", "Este caixa está aberto. Feche o turno antes de remover.");
  }

  if (register._count.devices > 0) {
    throw conflict(
      "HAS_DEVICES",
      "Há tablets vinculados a este caixa. Desvincule antes de remover.",
    );
  }

  const teveTurno = register._count.cashSessions > 0;

  if (teveTurno) {
    await prisma.cashRegister.update({
      where: { id: register.id },
      data: { isActive: false, deletedAt: new Date() },
    });
  } else {
    await prisma.cashRegister.delete({ where: { id: register.id } });
  }

  return finish({
    request,
    action: "CASH_REGISTER_DELETE",
    entityType: "CashRegister",
    entityId: register.id,
    storeId: register.posStation.storeId,
    reason,
    previousData: { code: register.code, name: register.name },
    outcome: {
      removido: teveTurno ? "desativado" : "apagado",
      mensagem: teveTurno
        ? "Caixa removido. Os turnos antigos continuam no histórico."
        : "Caixa apagado.",
    },
  });
}

/**
 * Remove uma loja.
 *
 * A loja é o cadastro mais pesado do sistema: dela penduram estação, caixa,
 * tablet, maquininha, estoque, venda e ponto. Por isso a regra aqui é a mesma
 * do resto, só que mais rígida no que conta como "usada".
 *
 * Loja que já vendeu, já teve turno de caixa ou já registrou ponto é
 * DESATIVADA — apagar levaria junto o faturamento do mês, o espelho de ponto
 * de quem trabalhou ali e a garantia de quem comprou.
 *
 * Loja recém-criada por engano, que nunca operou, é apagada de vez, junto com
 * a estrutura vazia que veio com ela. Um cadastro errado de dois minutos não
 * precisa ficar na lista para sempre.
 */
export async function removeStore(params: {
  storeId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { storeId, reason, request } = params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, companyId: request.user.companyId, deletedAt: null },
    include: {
      _count: {
        select: {
          posStations: true,
          devices: true,
          userStores: true,
          timeClockEntries: true,
          stockItems: true,
        },
      },
    },
  });

  if (!store) {
    throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
  }

  await assertStoreAccess(request, store.id);

  // Aberta agora é gente trabalhando: fechar antes é o que garante que o
  // caixa do dia foi conferido.
  if (store.isOpen) {
    throw conflict("STORE_OPEN", "Esta loja está aberta. Feche-a antes de removê-la.");
  }

  const [vendas, turnos] = await Promise.all([
    prisma.sale.count({ where: { storeId: store.id } }),
    prisma.cashSession.count({ where: { storeId: store.id } }),
  ]);

  const temHistorico =
    vendas > 0 || turnos > 0 || store._count.timeClockEntries > 0 || store._count.stockItems > 0;

  if (temHistorico) {
    await prisma.store.update({
      where: { id: store.id },
      data: { isActive: false, deletedAt: new Date() },
    });

    return finish({
      request,
      action: "STORE_DEACTIVATE",
      entityType: "Store",
      entityId: store.id,
      storeId: store.id,
      reason,
      previousData: { code: store.code, name: store.name },
      outcome: {
        removido: "desativado",
        mensagem:
          "Loja removida da operação. Vendas, caixa e ponto dela continuam no histórico — é o que permite explicar o passado.",
      },
    });
  }

  // Sem histórico: some de vez, com a estrutura vazia junto. A ordem segue as
  // chaves estrangeiras — do mais dependente para o menos.
  await prisma.$transaction([
    prisma.userStore.deleteMany({ where: { storeId: store.id } }),
    prisma.paymentTerminal.deleteMany({ where: { storeId: store.id } }),
    prisma.device.deleteMany({ where: { storeId: store.id } }),
    prisma.cashRegister.deleteMany({ where: { posStation: { storeId: store.id } } }),
    prisma.pOSStation.deleteMany({ where: { storeId: store.id } }),
    prisma.storeSetting.deleteMany({ where: { storeId: store.id } }),
    prisma.store.delete({ where: { id: store.id } }),
  ]);

  return finish({
    request,
    action: "STORE_DEACTIVATE",
    entityType: "Store",
    entityId: store.id,
    reason,
    previousData: { code: store.code, name: store.name },
    outcome: { removido: "apagado", mensagem: "Loja apagada. Ela nunca chegou a operar." },
  });
}

/**
 * Remove uma peça do catálogo.
 *
 * A regra é a de sempre, e aqui ela pesa: peça que já foi vendida vira
 * DESATIVADA. O item da venda guarda o nome e o preço do dia, mas aponta para
 * o produto — e apagar o produto deixaria a garantia, a troca e o relatório de
 * margem apontando para o nada.
 *
 * Peça que nunca saiu some de vez, junto com as variações e os saldos zerados
 * que vieram com ela. É o caso do cadastro errado, e da limpeza dos dados de
 * demonstração antes da loja começar de verdade.
 */
export async function removeProduct(params: {
  productId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { productId, reason, request } = params;

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: request.user.companyId, deletedAt: null },
    include: { _count: { select: { saleItems: true, variations: true } } },
  });

  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Peça não encontrada.");
  }

  const [reservada, emOrdem, movimentacoes] = await Promise.all([
    prisma.reservation.count({ where: { productId: product.id, status: "ATIVA" } }),
    prisma.stockItem.aggregate({
      where: { productId: product.id },
      _sum: { quantity: true },
    }),
    /**
     * Entradas, saídas e ajustes lançados nesta peça.
     *
     * É histórico de estoque: diz quantas peças entraram, quando, e quem
     * ajustou. Apagar a peça levaria isso junto — e é justamente o que
     * explica um saldo que não bate na contagem do mês passado.
     */
    prisma.stockMovement.count({ where: { stockItem: { productId: product.id } } }),
  ]);

  if (reservada > 0) {
    throw conflict(
      "HAS_RESERVATION",
      "Esta peça está reservada para um cliente. Cancele a reserva antes de removê-la.",
    );
  }

  const jaVendeu = product._count.saleItems > 0 || movimentacoes > 0;
  const temSaldo = (emOrdem._sum.quantity ?? 0) > 0;

  if (jaVendeu) {
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: false, deletedAt: new Date() },
    });
  } else {
    // Nunca vendeu: some com o que veio junto. A ordem segue as chaves
    // estrangeiras, do mais dependente para o menos.
    await prisma.$transaction([
      prisma.stockItem.deleteMany({ where: { productId: product.id } }),
      prisma.productVariation.deleteMany({ where: { productId: product.id } }),
      prisma.product.delete({ where: { id: product.id } }),
    ]);
  }

  return finish({
    request,
    action: "PRODUCT_UPDATE",
    entityType: "Product",
    entityId: product.id,
    reason,
    previousData: { sku: product.sku, name: product.name },
    outcome: {
      removido: jaVendeu ? "desativado" : "apagado",
      mensagem: jaVendeu
        ? product._count.saleItems > 0
          ? "Peça tirada do catálogo. As vendas antigas dela continuam no histórico — é o que sustenta a garantia e o relatório."
          : "Peça tirada do catálogo. Ela nunca foi vendida, mas tem entradas e ajustes de estoque lançados — e é isso que explica um saldo que não bate na contagem."
        : temSaldo
          ? "Peça apagada, junto com o saldo que estava lançado nela."
          : "Peça apagada.",
    },
  });
}

/**
 * Desliga um funcionário.
 *
 * Aqui não existe apagar, e não é escolha de projeto: é a lei. O registro de
 * ponto tem valor legal e precisa ser guardado por anos depois do
 * desligamento; a venda que a pessoa fez continua sendo dela no relatório e na
 * comissão; e a auditoria de quem fez o quê deixaria de responder a pergunta
 * mais importante que ela existe para responder.
 *
 * Então "excluir" significa: perde o acesso agora, some da lista de quem
 * trabalha na loja, e continua inteiro no histórico. As sessões abertas caem
 * junto — quem foi desligado não continua vendendo no tablet até o token
 * vencer.
 */
export async function removeUser(params: {
  userId: string;
  reason: string;
  request: FastifyRequest;
}): Promise<RemovalOutcome> {
  const { userId, reason, request } = params;

  if (userId === request.user.sub) {
    throw conflict(
      "SELF_REMOVAL",
      "Você não pode desligar a si mesmo. Peça a outro dono, ou o sistema fica sem ninguém no comando.",
    );
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });

  if (!user) {
    throw notFound("USER_NOT_FOUND", "Funcionário não encontrado.");
  }

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono desliga um funcionário.");
  }

  // O último dono não sai: sem ele ninguém cadastra, promove nem desbloqueia
  // ninguém — e a única saída seria mexer no banco à mão.
  if (user.role === "DONO") {
    const outrosDonos = await prisma.user.count({
      where: {
        companyId: request.user.companyId,
        role: "DONO",
        deletedAt: null,
        status: "ACTIVE",
        id: { not: user.id },
      },
    });

    if (outrosDonos === 0) {
      throw conflict(
        "LAST_OWNER",
        "Este é o único dono ativo. Promova outra pessoa a dono antes de desligar este.",
      );
    }
  }

  const turnoAberto = await prisma.cashSession.count({
    where: { openedById: user.id, status: "ABERTO" },
  });

  if (turnoAberto > 0) {
    throw conflict(
      "CASH_OPEN",
      "Esta pessoa tem caixa aberto. Feche o turno dela antes de desligá-la — senão o dinheiro do dia fica sem conferência.",
    );
  }

  /**
   * O que impede apagar de verdade.
   *
   * A regra é a mesma do resto do sistema: quem já foi usado por algo que
   * virou histórico é desativado; quem nunca encostou em nada some de vez.
   *
   * Aqui a lista não é escolha de projeto, é o que a lei e a contabilidade
   * exigem que continue existindo: o ponto tem valor legal por anos depois do
   * desligamento; a venda continua sendo dela no faturamento e na comissão; o
   * caixa que ela conferiu explica o dinheiro daquele dia; e a auditoria
   * responde quem fez o quê — apagar a pessoa faria a resposta apontar para o
   * nada.
   *
   * A auditoria entra na conta por um motivo a mais: o banco não deixa apagar
   * quem ela menciona, e é ela quem existe justamente para não deixar.
   */
  const [ponto, vendas, caixasAbertos, caixasFechados, movimentos, auditoria] = await Promise.all([
    prisma.timeClockEntry.count({ where: { userId: user.id } }),
    prisma.sale.count({ where: { sellerId: user.id } }),
    prisma.cashSession.count({ where: { openedById: user.id } }),
    prisma.cashSession.count({ where: { closedById: user.id } }),
    prisma.stockMovement.count({ where: { userId: user.id } }),
    prisma.auditLog.count({ where: { userId: user.id } }),
  ]);

  const historico =
    ponto + vendas + caixasAbertos + caixasFechados + movimentos + auditoria > 0;

  if (historico) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { status: "INACTIVE", deletedAt: new Date() },
      }),
      // O acesso acaba agora, não quando o token vencer.
      prisma.refreshToken.updateMany({
        where: { session: { userId: user.id }, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "funcionário desligado" },
      }),
      prisma.deviceSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "funcionário desligado" },
      }),
    ]);

    return finish({
      request,
      action: "USER_BLOCK",
      entityType: "User",
      entityId: user.id,
      reason,
      previousData: { name: user.name, employeeCode: user.employeeCode, role: user.role },
      outcome: {
        removido: "desativado",
        mensagem: descreverHistorico({ ponto, vendas, caixas: caixasAbertos + caixasFechados }),
      },
    });
  }

  /**
   * Ninguém encostou em nada: some de vez.
   *
   * É o caso das contas criadas por engano, das de demonstração e das que
   * nunca foram ativadas — que, enquanto existem, são acessos ao sistema real
   * sem dono. Deixá-las apenas "inativas" na lista seria guardar para sempre
   * um cadastro que não conta história nenhuma.
   *
   * A AUDITORIA do ato fica, e é ela que passa a contar: o registro de que
   * esta matrícula existiu e foi apagada, por quem e por quê, sobrevive à
   * pessoa. Por isso ela é gravada DEPOIS — antes, o próprio registro criaria
   * a menção que impede apagar.
   */
  await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { session: { userId: user.id } } }),
    prisma.stepUpToken.deleteMany({ where: { userId: user.id } }),
    prisma.deviceSession.deleteMany({ where: { userId: user.id } }),
    prisma.userPermission.deleteMany({ where: { userId: user.id } }),
    prisma.userPermission.deleteMany({ where: { grantedById: user.id } }),
    prisma.workSchedule.deleteMany({ where: { userId: user.id } }),
    prisma.workSchedule.deleteMany({ where: { createdById: user.id } }),
    prisma.pinResetRequest.deleteMany({ where: { userId: user.id } }),
    prisma.employeeDocument.deleteMany({ where: { userId: user.id } }),
    prisma.twoFactorCredential.deleteMany({ where: { userId: user.id } }),
    prisma.userStore.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  await audit(request, {
    action: "USER_BLOCK",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: { name: user.name, employeeCode: user.employeeCode, role: user.role },
    newData: { removido: "apagado" },
    reason,
  });

  return {
    removido: "apagado",
    mensagem: `${user.name} foi apagado. A matrícula ${user.employeeCode} nunca registrou ponto, venda nem caixa, então não havia histórico a preservar — só o registro de que ela existiu e foi removida.`,
  };
}

/** Diz em português o que impediu de apagar. */
function descreverHistorico(params: { ponto: number; vendas: number; caixas: number }): string {
  const partes: string[] = [];

  if (params.ponto > 0) {
    partes.push(params.ponto === 1 ? "1 marcação de ponto" : `${params.ponto} marcações de ponto`);
  }
  if (params.vendas > 0) {
    partes.push(params.vendas === 1 ? "1 venda" : `${params.vendas} vendas`);
  }
  if (params.caixas > 0) {
    partes.push(params.caixas === 1 ? "1 turno de caixa" : `${params.caixas} turnos de caixa`);
  }

  const historico = partes.length > 0 ? partes.join(", ") : "registros de auditoria";

  return (
    `Funcionário desligado — o acesso acabou agora e as sessões abertas foram encerradas. ` +
    `Não foi apagado de vez porque tem ${historico} no histórico: o ponto tem valor legal por ` +
    `anos depois da saída, e é ele que protege os dois lados numa discussão trabalhista.`
  );
}
