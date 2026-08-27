import { Prisma } from "@prisma/client";
import type { PaymentMethod } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors.js";
import { getEffectivePermissions } from "../../core/rbac/permissions.engine.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { applyMovement } from "../stock/stock.service.js";
import { assertSessionOpen } from "../cash/cash.service.js";
import { assertTerminalCanCharge } from "../terminals/terminals.service.js";
import { enviarComprovanteAutomatico } from "./receipt.service.js";

/**
 * Venda.
 *
 * Duas regras governam este arquivo, e ambas vêm da especificação:
 *
 * 1. PREÇO VEM DO SERVIDOR. O aplicativo manda o que o cliente quer levar e
 *    quanto de desconto pediu — nunca quanto custa. Se o preço viesse da tela,
 *    bastaria alterar uma requisição para comprar um anel por um real.
 *
 * 2. A VENDA É UMA TRANSAÇÃO SÓ. Baixar estoque, gravar itens, gravar
 *    pagamentos e lançar o dinheiro na gaveta acontecem juntos ou não
 *    acontecem. Uma falha no meio que deixasse estoque baixado sem venda
 *    registrada faria a peça sumir dos dois lugares.
 */

/** Desconto que um vendedor concede sozinho, sem autorização. */
const SELLER_DISCOUNT_LIMIT_PERCENT = 5;

/** Métodos que exigem maquininha — não há como conciliar cartão sem terminal. */
const CARD_METHODS: PaymentMethod[] = ["DEBITO", "CREDITO", "CREDITO_PARCELADO"];

async function nextSaleCode(companyId: string): Promise<string> {
  const count = await prisma.sale.count({ where: { companyId } });
  return `V${String(count + 1).padStart(7, "0")}`;
}

export interface SaleItemInput {
  productId: string;
  variationId?: string | undefined;
  quantity: number;
  /** Desconto em reais NESTE item. O preço unitário o servidor resolve. */
  discountAmount?: number | undefined;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: number;
  installments?: number | undefined;
  terminalId?: string | undefined;
  authorizationCode?: string | undefined;
  tenderedAmount?: number | undefined;
}

/**
 * Resolve o preço de cada item a partir do catálogo.
 *
 * A variação pode ter preço próprio (anel 30 leva mais prata que o 12); sem
 * ele, vale o preço do produto.
 */
async function priceItems(companyId: string, items: SaleItemInput[]) {
  if (items.length === 0) {
    throw badRequest("EMPTY_SALE", "Adicione ao menos uma peça à venda.");
  }

  const priced = [];

  for (const item of items) {
    if (item.quantity <= 0) {
      throw badRequest("INVALID_QUANTITY", "A quantidade precisa ser maior que zero.");
    }

    const product = await prisma.product.findFirst({
      where: { id: item.productId, companyId, deletedAt: null },
      include: {
        variations: item.variationId
          ? { where: { id: item.variationId, deletedAt: null } }
          : false,
      },
    });

    if (!product) {
      throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
    }
    if (!product.isActive) {
      throw badRequest("PRODUCT_INACTIVE", `${product.name} está inativo e não pode ser vendido.`);
    }
    if (product.hasVariations && !item.variationId) {
      throw badRequest(
        "VARIATION_REQUIRED",
        `Escolha o tamanho de ${product.name} antes de fechar a venda.`,
      );
    }

    const variation = item.variationId ? product.variations?.[0] : undefined;
    if (item.variationId && !variation) {
      throw notFound("VARIATION_NOT_FOUND", "Tamanho não encontrado para este produto.");
    }

    const unitPrice = variation?.salePriceOverride ?? product.salePrice;
    const unitCost = variation?.costPriceOverride ?? product.costPrice;

    const gross = unitPrice.mul(item.quantity);
    const discount = new Prisma.Decimal(item.discountAmount ?? 0);

    if (discount.isNegative()) {
      throw badRequest("INVALID_DISCOUNT", "O desconto não pode ser negativo.");
    }
    if (discount.greaterThan(gross)) {
      throw badRequest(
        "DISCOUNT_ABOVE_TOTAL",
        `O desconto em ${product.name} é maior que o próprio valor da peça.`,
      );
    }

    priced.push({
      productId: product.id,
      variationId: variation?.id ?? null,
      productName: product.name,
      productSku: variation?.sku ?? product.sku,
      quantity: item.quantity,
      unitPrice,
      unitCost,
      discountAmount: discount,
      totalAmount: gross.minus(discount),
    });
  }

  return priced;
}

/**
 * Confere se quem está vendendo pode dar o desconto pedido.
 *
 * Acima do limite exige alguém com SALE_AUTHORIZE_DISCOUNT — e a autorização
 * fica gravada na venda com o nome de quem autorizou, não como um "ok" que
 * some.
 */
async function assertDiscountAllowed(params: {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  authorizedById?: string | undefined;
  request: FastifyRequest;
}) {
  const { subtotal, discount, authorizedById, request } = params;

  if (discount.isZero() || subtotal.isZero()) return null;

  const percent = discount.div(subtotal).mul(100);
  if (percent.lessThanOrEqualTo(SELLER_DISCOUNT_LIMIT_PERCENT)) return null;

  const ownPermissions = await getEffectivePermissions(request.user.sub);
  if (ownPermissions.has("SALE_AUTHORIZE_DISCOUNT")) {
    return request.user.sub;
  }

  if (!authorizedById) {
    throw forbidden(
      "DISCOUNT_NEEDS_AUTHORIZATION",
      `Desconto de ${percent.toFixed(1)}% passa do seu limite de ${SELLER_DISCOUNT_LIMIT_PERCENT}%. Chame o responsável da loja para autorizar.`,
    );
  }

  const authorizer = await prisma.user.findFirst({
    where: { id: authorizedById, companyId: request.user.companyId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!authorizer) {
    throw badRequest("AUTHORIZER_NOT_FOUND", "Quem autorizaria o desconto não foi encontrado.");
  }

  const permissions = await getEffectivePermissions(authorizer.id);
  if (!permissions.has("SALE_AUTHORIZE_DISCOUNT")) {
    throw forbidden(
      "AUTHORIZER_CANNOT_APPROVE",
      "Esta pessoa não tem permissão para autorizar desconto.",
    );
  }

  return authorizer.id;
}

/** Os pagamentos precisam somar exatamente o total. Nem um centavo a menos. */
function assertPaymentsCoverTotal(payments: SalePaymentInput[], total: Prisma.Decimal) {
  if (payments.length === 0) {
    throw badRequest("NO_PAYMENT", "Informe como o cliente vai pagar.");
  }

  const paid = payments.reduce(
    (sum, payment) => sum.plus(new Prisma.Decimal(payment.amount)),
    new Prisma.Decimal(0),
  );

  if (!paid.equals(total)) {
    throw badRequest(
      "PAYMENT_MISMATCH",
      `Os pagamentos somam R$ ${paid.toFixed(2)}, e a venda é de R$ ${total.toFixed(2)}.`,
      { pago: paid.toFixed(2), total: total.toFixed(2) },
    );
  }
}

/**
 * Conclui a venda inteira numa transação.
 *
 * Não existe "venda em rascunho" persistida de propósito: o carrinho vive na
 * tela do tablet até o cliente pagar. Rascunho no banco criaria a pergunta de
 * quando liberar o estoque de um carrinho abandonado, e a resposta errada
 * trava peça que ninguém comprou.
 */
export async function completeSale(params: {
  input: {
    storeId: string;
    sessionId: string;
    deviceId?: string | undefined;
    customerId?: string | undefined;
    items: SaleItemInput[];
    payments: SalePaymentInput[];
    /** Desconto aplicado sobre o total, além dos descontos por item. */
    discountAmount?: number | undefined;
    discountAuthorizedById?: string | undefined;
    discountReason?: string | undefined;
    notes?: string | undefined;
    /** Reserva sendo convertida, se houver. */
    reservationId?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  const companyId = request.user.companyId;

  await assertStoreAccess(request, input.storeId);

  const session = await assertSessionOpen(input.sessionId, companyId);
  if (session.storeId !== input.storeId) {
    throw badRequest(
      "SESSION_WRONG_STORE",
      "O caixa aberto é de outra loja. Abra o caixa desta loja para vender aqui.",
    );
  }

  const priced = await priceItems(companyId, input.items);

  const subtotal = priced.reduce(
    (sum, item) => sum.plus(item.unitPrice.mul(item.quantity)),
    new Prisma.Decimal(0),
  );
  const itemDiscounts = priced.reduce(
    (sum, item) => sum.plus(item.discountAmount),
    new Prisma.Decimal(0),
  );
  const globalDiscount = new Prisma.Decimal(input.discountAmount ?? 0);
  const totalDiscount = itemDiscounts.plus(globalDiscount);
  const total = subtotal.minus(totalDiscount);

  if (total.isNegative()) {
    throw badRequest("DISCOUNT_ABOVE_TOTAL", "O desconto é maior que o valor da venda.");
  }

  const discountAuthorizedById = await assertDiscountAllowed({
    subtotal,
    discount: totalDiscount,
    authorizedById: input.discountAuthorizedById,
    request,
  });

  assertPaymentsCoverTotal(input.payments, total);

  // Cartão sem maquininha vinculada não fecha com a operadora depois.
  for (const payment of input.payments) {
    if (CARD_METHODS.includes(payment.method)) {
      if (!payment.terminalId) {
        throw badRequest(
          "TERMINAL_REQUIRED",
          "Escolha a maquininha usada na cobrança do cartão.",
        );
      }
      if (!input.deviceId) {
        throw badRequest(
          "DEVICE_REQUIRED",
          "Venda no cartão precisa ser feita no tablet vinculado à maquininha.",
        );
      }

      await assertTerminalCanCharge({
        terminalId: payment.terminalId,
        storeId: input.storeId,
        cashRegisterId: session.cashRegisterId,
        deviceId: input.deviceId,
      });
    }

    if (payment.method === "CREDITO_PARCELADO" && (payment.installments ?? 1) < 2) {
      throw badRequest("INVALID_INSTALLMENTS", "Parcelado precisa de ao menos 2 parcelas.");
    }
  }

  // Só o que é espécie entra na gaveta. Cartão é receita, mas está na
  // operadora — misturar faria o fechamento acusar falta do valor do cartão.
  const cashAmount = input.payments
    .filter((payment) => payment.method === "DINHEIRO")
    .reduce((sum, payment) => sum.plus(new Prisma.Decimal(payment.amount)), new Prisma.Decimal(0));

  const sale = await prisma.$transaction(async (tx) => {
    const created = await tx.sale.create({
      data: {
        companyId,
        storeId: input.storeId,
        sessionId: session.id,
        deviceId: input.deviceId ?? null,
        sellerId: request.user.sub,
        customerId: input.customerId ?? null,
        code: await nextSaleCode(companyId),
        status: "CONCLUIDA",
        subtotalAmount: subtotal,
        discountAmount: totalDiscount,
        totalAmount: total,
        discountAuthorizedById,
        discountReason: input.discountReason ?? null,
        notes: input.notes ?? null,
        completedAt: new Date(),
        items: {
          create: priced.map((item) => ({
            productId: item.productId,
            variationId: item.variationId,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount,
            totalAmount: item.totalAmount,
            unitCostSnapshot: item.unitCost,
          })),
        },
        payments: {
          create: input.payments.map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            installments: payment.installments ?? 1,
            terminalId: payment.terminalId ?? null,
            authorizationCode: payment.authorizationCode ?? null,
            tenderedAmount: payment.tenderedAmount ?? null,
            changeAmount:
              payment.method === "DINHEIRO" && payment.tenderedAmount
                ? new Prisma.Decimal(payment.tenderedAmount).minus(payment.amount)
                : null,
          })),
        },
      },
      include: { items: true, payments: true },
    });

    // A reserva libera a peça ANTES da baixa de venda: o estoque reservado
    // seria contado como indisponível e a própria venda bateria na trava.
    if (input.reservationId) {
      await releaseReservationWithin(tx, {
        reservationId: input.reservationId,
        companyId,
        saleId: created.id,
      });
    }

    for (const item of priced) {
      await applyMovement(tx, {
        companyId,
        storeId: input.storeId,
        productId: item.productId,
        variationId: item.variationId,
        type: "VENDA",
        quantity: item.quantity,
        userId: request.user.sub,
        reason: `venda ${created.code}`,
        referenceType: "Sale",
        referenceId: created.id,
      });
    }

    if (cashAmount.greaterThan(0)) {
      await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          companyId,
          storeId: input.storeId,
          type: "VENDA",
          amount: cashAmount,
          isCash: true,
          reason: `venda ${created.code}`,
          referenceType: "Sale",
          referenceId: created.id,
          userId: request.user.sub,
        },
      });
    }

    return created;
  });

  await audit(request, {
    action: "SALE_COMPLETE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    storeId: input.storeId,
    ...(input.deviceId ? { deviceId: input.deviceId } : {}),
    cashRegisterId: session.cashRegisterId,
    userRoleSnapshot: request.user.role,
    entityType: "Sale",
    entityId: sale.id,
    newData: {
      code: sale.code,
      totalAmount: sale.totalAmount,
      discountAmount: sale.discountAmount,
      itens: sale.items.length,
      customerId: input.customerId ?? null,
    },
    ...(input.discountReason ? { reason: input.discountReason } : {}),
  });

  if (discountAuthorizedById && discountAuthorizedById !== request.user.sub) {
    // Autorização de desconto tem registro próprio: é o que se procura quando
    // a margem de um vendedor destoa da dos outros.
    await audit(request, {
      action: "SALE_DISCOUNT_AUTHORIZED",
      result: "SUCCESS",
      userId: discountAuthorizedById,
      companyId,
      storeId: input.storeId,
      userRoleSnapshot: request.user.role,
      entityType: "Sale",
      entityId: sale.id,
      newData: { code: sale.code, discountAmount: sale.discountAmount, vendedor: request.user.sub },
      ...(input.discountReason ? { reason: input.discountReason } : {}),
    });
  }

  /**
   * O comprovante sai sozinho, por trás, sem prender a tela.
   *
   * Sem `await` de propósito: a vendedora já pode começar a próxima venda
   * enquanto o e-mail sai. Se o envio falhar, ele registra e cala — a venda
   * está gravada, e o reenvio manual continua na tela.
   */
  void enviarComprovanteAutomatico({ saleId: sale.id, request });

  return sale;
}

/**
 * Cancela uma venda concluída, devolvendo as peças ao estoque.
 *
 * A venda NÃO é apagada — muda de status e ganha motivo. O comprovante que o
 * cliente levou continua existindo, e o histórico precisa poder explicar por
 * que aquele dinheiro entrou e depois saiu.
 */
export async function cancelSale(params: {
  saleId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { saleId, reason, request } = params;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: request.user.companyId },
    include: { items: true, payments: true },
  });
  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }

  await assertStoreAccess(request, sale.storeId);

  if (sale.status !== "CONCLUIDA") {
    throw badRequest("SALE_NOT_CANCELLABLE", "Esta venda não está em condição de ser cancelada.");
  }

  // Cancelar depois do fechamento mexeria num caixa já conferido e
  // assinado. O caminho, aí, é a devolução — que é outro fato, com data
  // própria e dinheiro saindo do turno de hoje.
  if (sale.sessionId) {
    const session = await prisma.cashSession.findUnique({ where: { id: sale.sessionId } });
    if (session?.status === "FECHADO") {
      throw conflict(
        "SESSION_ALREADY_CLOSED",
        "O caixa desta venda já foi fechado. Registre uma devolução em vez de cancelar.",
      );
    }
  }

  const cashPaid = sale.payments
    .filter((payment) => payment.method === "DINHEIRO")
    .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));

  await prisma.$transaction(async (tx) => {
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: "CANCELADA",
        cancelledAt: new Date(),
        cancelledById: request.user.sub,
        cancelReason: reason,
      },
    });

    for (const item of sale.items) {
      await applyMovement(tx, {
        companyId: sale.companyId,
        storeId: sale.storeId,
        productId: item.productId,
        variationId: item.variationId,
        type: "DEVOLUCAO",
        quantity: item.quantity,
        userId: request.user.sub,
        reason: `cancelamento da venda ${sale.code}`,
        referenceType: "Sale",
        referenceId: sale.id,
      });
    }

    if (cashPaid.greaterThan(0) && sale.sessionId) {
      await tx.cashMovement.create({
        data: {
          sessionId: sale.sessionId,
          companyId: sale.companyId,
          storeId: sale.storeId,
          type: "DEVOLUCAO",
          amount: cashPaid.negated(),
          isCash: true,
          reason: `cancelamento da venda ${sale.code}`,
          referenceType: "Sale",
          referenceId: sale.id,
          userId: request.user.sub,
        },
      });
    }
  });

  await audit(request, {
    action: "SALE_CANCEL",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: sale.companyId,
    storeId: sale.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Sale",
    entityId: sale.id,
    previousData: { status: "CONCLUIDA", totalAmount: sale.totalAmount },
    newData: { status: "CANCELADA" },
    reason,
  });

  return { id: sale.id, code: sale.code, status: "CANCELADA" as const };
}

export async function listSales(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  sessionId?: string | undefined;
  customerId?: string | undefined;
}) {
  const { request, storeId, sessionId, customerId } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  return prisma.sale.findMany({
    where: {
      companyId: request.user.companyId,
      // Venda de loja removida sai da lista pelo mesmo motivo do caixa e do
      // estoque: a loja não existe mais, e a linha só confunde quem procura.
      store: { deletedAt: null },
      ...(storeId ? { storeId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      customer: { select: { name: true, phone: true } },
      seller: { select: { name: true } },
      store: { select: { name: true } },
      items: { select: { productName: true, quantity: true } },
      payments: { select: { method: true, amount: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getSale(params: { saleId: string; request: FastifyRequest }) {
  const sale = await prisma.sale.findFirst({
    where: { id: params.saleId, companyId: params.request.user.companyId },
    include: {
      customer: true,
      seller: { select: { name: true, employeeCode: true } },
      store: { select: { name: true } },
      items: true,
      payments: true,
    },
  });

  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }

  await assertStoreAccess(params.request, sale.storeId);

  return sale;
}

/**
 * Libera a reserva dentro da transação da venda.
 *
 * Fica aqui, e não no módulo de reservas, para não haver importação circular
 * entre venda e reserva — as duas se conhecem, mas em direção única.
 */
async function releaseReservationWithin(
  tx: Prisma.TransactionClient,
  params: { reservationId: string; companyId: string; saleId: string },
) {
  const reservation = await tx.reservation.findFirst({
    where: { id: params.reservationId, companyId: params.companyId },
  });

  if (!reservation) {
    throw notFound("RESERVATION_NOT_FOUND", "Reserva não encontrada.");
  }
  if (reservation.status !== "ATIVA") {
    throw badRequest("RESERVATION_NOT_ACTIVE", "Esta reserva não está mais ativa.");
  }

  const item = await tx.stockItem.findFirst({
    where: {
      storeId: reservation.storeId,
      productId: reservation.productId,
      variationId: reservation.variationId,
    },
  });

  if (item) {
    await tx.stockItem.update({
      where: { id: item.id },
      data: { reservedQuantity: Math.max(0, item.reservedQuantity - reservation.quantity) },
    });
  }

  await tx.reservation.update({
    where: { id: reservation.id },
    data: { status: "CONVERTIDA", convertedSaleId: params.saleId },
  });
}
