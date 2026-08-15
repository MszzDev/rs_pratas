import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { assertStoreOpen } from "../stores/store-opening.service.js";

/**
 * Caixa: abertura, sangria, suprimento e fechamento CEGO.
 *
 * O fechamento cego é a peça central. Quem fecha digita o que contou na gaveta
 * sem ver quanto o sistema esperava. É o mesmo princípio do inventário cego, e
 * pela mesma razão: mostrar o número esperado antes da contagem faz a
 * diferença desaparecer — a pessoa ajusta a contagem até bater, sem má-fé
 * necessariamente, e o caixa que nunca dá diferença deixa de informar
 * qualquer coisa.
 */

async function nextSessionCode(companyId: string): Promise<string> {
  const count = await prisma.cashSession.count({ where: { companyId } });
  return `CX${String(count + 1).padStart(6, "0")}`;
}

export async function openSession(params: {
  input: { cashRegisterId: string; openingAmount: number; notes?: string | undefined };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const register = await prisma.cashRegister.findFirst({
    where: { id: input.cashRegisterId, deletedAt: null },
    include: { posStation: { include: { store: { select: { id: true, companyId: true } } } } },
  });

  if (!register || register.posStation.store.companyId !== request.user.companyId) {
    throw notFound("CASH_REGISTER_NOT_FOUND", "Caixa não encontrado.");
  }

  const storeId = register.posStation.store.id;
  await assertStoreAccess(request, storeId);

  // Caixa aberto com a loja fechada geraria venda que ninguém consegue
  // explicar depois — e é o padrão que aparece quando o sistema é usado fora
  // do expediente.
  await assertStoreOpen(storeId);

  if (input.openingAmount < 0) {
    throw badRequest("INVALID_AMOUNT", "O fundo de troco não pode ser negativo.");
  }

  const open = await prisma.cashSession.findFirst({
    where: { cashRegisterId: register.id, status: "ABERTO" },
    select: { code: true, openedBy: { select: { name: true } } },
  });
  if (open) {
    throw conflict(
      "SESSION_ALREADY_OPEN",
      `O caixa ${open.code} já está aberto por ${open.openedBy.name}. Feche antes de abrir outro.`,
    );
  }

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.cashSession.create({
      data: {
        companyId: request.user.companyId,
        storeId,
        cashRegisterId: register.id,
        code: await nextSessionCode(request.user.companyId),
        openedById: request.user.sub,
        openingAmount: input.openingAmount,
        notes: input.notes ?? null,
      },
    });

    // O fundo de troco entra como movimento: sem isso o esperado do
    // fechamento começaria em zero e acusaria sobra do valor do fundo.
    await tx.cashMovement.create({
      data: {
        sessionId: created.id,
        companyId: created.companyId,
        storeId,
        type: "ABERTURA",
        amount: input.openingAmount,
        isCash: true,
        reason: "fundo de troco",
        userId: request.user.sub,
      },
    });

    return created;
  });

  await audit(request, {
    action: "CASH_OPEN",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId,
    cashRegisterId: register.id,
    userRoleSnapshot: request.user.role,
    entityType: "CashSession",
    entityId: session.id,
    newData: { code: session.code, openingAmount: input.openingAmount },
  });

  return session;
}

/**
 * Retirada de dinheiro da gaveta durante o turno — o valor vai para o cofre.
 *
 * Existe justamente para o caixa não acumular dinheiro demais no balcão. É
 * movimento de risco, então exige motivo e fica auditado com nome e hora.
 */
export async function registerWithdrawal(params: {
  sessionId: string;
  amount: number;
  reason: string;
  request: FastifyRequest;
}) {
  return registerCashMovement({ ...params, kind: "SANGRIA" });
}

/** Entrada de dinheiro no meio do turno — reforço de troco. */
export async function registerSupply(params: {
  sessionId: string;
  amount: number;
  reason: string;
  request: FastifyRequest;
}) {
  return registerCashMovement({ ...params, kind: "SUPRIMENTO" });
}

async function registerCashMovement(params: {
  sessionId: string;
  amount: number;
  reason: string;
  kind: "SANGRIA" | "SUPRIMENTO";
  request: FastifyRequest;
}) {
  const { sessionId, amount, reason, kind, request } = params;

  if (amount <= 0) {
    throw badRequest("INVALID_AMOUNT", "O valor precisa ser maior que zero.");
  }

  const session = await loadOpenSession(sessionId, request);

  if (kind === "SANGRIA") {
    const balance = await currentCashBalance(session.id);
    if (balance.lessThan(amount)) {
      throw badRequest(
        "INSUFFICIENT_CASH",
        `Há R$ ${balance.toFixed(2)} em dinheiro na gaveta. Não é possível retirar mais que isso.`,
      );
    }
  }

  const movement = await prisma.cashMovement.create({
    data: {
      sessionId: session.id,
      companyId: session.companyId,
      storeId: session.storeId,
      type: kind,
      // Sangria sai da gaveta, suprimento entra.
      amount: kind === "SANGRIA" ? -amount : amount,
      isCash: true,
      reason,
      userId: request.user.sub,
    },
  });

  await audit(request, {
    action: kind === "SANGRIA" ? "CASH_WITHDRAWAL" : "CASH_SUPPLY",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: session.companyId,
    storeId: session.storeId,
    cashRegisterId: session.cashRegisterId,
    userRoleSnapshot: request.user.role,
    entityType: "CashMovement",
    entityId: movement.id,
    newData: { amount, sessionCode: session.code },
    reason,
  });

  return movement;
}

/**
 * Soma o que deveria estar na gaveta AGORA: só o que é espécie.
 *
 * Venda no cartão é receita da loja, mas não é dinheiro para conferir no
 * fechamento — está na operadora, não na gaveta. Misturar os dois faria toda
 * conferência acusar uma falta do tamanho das vendas em cartão.
 */
export async function currentCashBalance(sessionId: string): Promise<Prisma.Decimal> {
  const result = await prisma.cashMovement.aggregate({
    where: { sessionId, isCash: true },
    _sum: { amount: true },
  });

  return result._sum.amount ?? new Prisma.Decimal(0);
}

/**
 * O que a pessoa que fecha PODE ver: nada de valor esperado.
 *
 * Devolve a lista de vendas e o número delas para a conferência fazer sentido,
 * mas nenhum total em dinheiro. A omissão acontece aqui, no servidor — mandar
 * o número e escondê-lo na tela não esconderia de ninguém.
 */
export async function getSessionForClosing(params: {
  sessionId: string;
  request: FastifyRequest;
}) {
  const session = await loadOpenSession(params.sessionId, params.request);

  const salesCount = await prisma.sale.count({
    where: { sessionId: session.id, status: "CONCLUIDA" },
  });

  return {
    id: session.id,
    code: session.code,
    openedAt: session.openedAt,
    openedByName: session.openedBy.name,
    salesCount,
    /**
     * Ausente de propósito: valor esperado, total de vendas e saldo da gaveta.
     * Quem conta não vê nenhum deles até registrar a contagem.
     */
  };
}

/**
 * Fecha o turno com a contagem informada.
 *
 * A ordem importa: o esperado é calculado DEPOIS de a contagem chegar, na
 * mesma transação. Assim não existe momento em que o sistema tenha mostrado o
 * esperado a quem ainda ia contar.
 */
export async function closeSession(params: {
  sessionId: string;
  countedAmount: number;
  differenceReason?: string | undefined;
  request: FastifyRequest;
}) {
  const { sessionId, countedAmount, differenceReason, request } = params;

  if (countedAmount < 0) {
    throw badRequest("INVALID_AMOUNT", "O valor contado não pode ser negativo.");
  }

  const session = await loadOpenSession(sessionId, request);

  const expected = await currentCashBalance(session.id);
  const counted = new Prisma.Decimal(countedAmount);
  const difference = counted.minus(expected);

  // Caixa que não bate precisa de explicação escrita. Sem isso, a diferença
  // vira um número solto que ninguém consegue investigar meses depois.
  if (!difference.isZero() && !differenceReason) {
    throw badRequest(
      "DIFFERENCE_REASON_REQUIRED",
      `A contagem não bateu com o esperado (diferença de R$ ${difference.toFixed(2)}). Explique o que aconteceu para concluir o fechamento.`,
      { differenceAmount: difference.toFixed(2) },
    );
  }

  const closed = await prisma.$transaction(async (tx) => {
    const result = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: "FECHADO",
        closedById: request.user.sub,
        closedAt: new Date(),
        countedAmount: counted,
        expectedAmount: expected,
        differenceAmount: difference,
        differenceReason: differenceReason ?? null,
      },
    });

    // Movimento de fechamento zera a gaveta: o dinheiro sai para o cofre e o
    // próximo turno começa do próprio fundo de troco.
    await tx.cashMovement.create({
      data: {
        sessionId: session.id,
        companyId: session.companyId,
        storeId: session.storeId,
        type: "FECHAMENTO",
        amount: counted.negated(),
        isCash: true,
        reason: "fechamento do caixa",
        userId: request.user.sub,
      },
    });

    return result;
  });

  await audit(request, {
    action: "CASH_CLOSE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: session.companyId,
    storeId: session.storeId,
    cashRegisterId: session.cashRegisterId,
    userRoleSnapshot: request.user.role,
    entityType: "CashSession",
    entityId: session.id,
    newData: {
      code: session.code,
      countedAmount: counted.toFixed(2),
      expectedAmount: expected.toFixed(2),
      differenceAmount: difference.toFixed(2),
    },
    ...(differenceReason ? { reason: differenceReason } : {}),
  });

  /**
   * Fechar o último caixa fecha a loja.
   *
   * O fechamento do caixa É o fim do expediente: não faz sentido conferir a
   * gaveta, guardar o dinheiro e deixar a loja marcada como aberta. Deixar
   * isso para um segundo botão significa que alguém vai esquecer, e a loja
   * amanhece "aberta" desde ontem — o que apagaria justamente o sinal do
   * tablet que ficou ligado a noite toda.
   */
  const aindaAbertos = await prisma.cashSession.count({
    where: { storeId: session.storeId, status: "ABERTO" },
  });

  let lojaFechada = false;
  if (aindaAbertos === 0) {
    const store = await prisma.store.findUnique({
      where: { id: session.storeId },
      select: { isOpen: true },
    });

    if (store?.isOpen) {
      await prisma.store.update({
        where: { id: session.storeId },
        data: { isOpen: false, closedAt: new Date(), closedById: request.user.sub },
      });

      await audit(request, {
        action: "STORE_CLOSE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: session.companyId,
        storeId: session.storeId,
        userRoleSnapshot: request.user.role,
        entityType: "Store",
        entityId: session.storeId,
        newData: { isOpen: false },
        reason: `loja fechada junto com o último caixa (${session.code})`,
      });

      lojaFechada = true;
    }
  }

  return {
    id: closed.id,
    code: closed.code,
    countedAmount: closed.countedAmount,
    expectedAmount: closed.expectedAmount,
    differenceAmount: closed.differenceAmount,
    /** Só agora, com a contagem já gravada, o número aparece. */
    conferido: difference.isZero(),
    lojaFechada,
    caixasAindaAbertos: aindaAbertos,
  };
}

/**
 * Turnos que passaram do dia sem fechar.
 *
 * O fechamento é diário: um caixa aberto desde ontem não tem como ser
 * conferido — o dinheiro de dois dias está misturado na mesma gaveta, e a
 * diferença, se houver, não se sabe de qual dia veio.
 *
 * O sistema não fecha sozinho: fechar sem alguém contar inventaria um número.
 * O que ele faz é não deixar passar despercebido.
 */
export async function listOverdueSessions(request: FastifyRequest) {
  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const inicioDeHoje = new Date();
  inicioDeHoje.setHours(0, 0, 0, 0);

  const sessions = await prisma.cashSession.findMany({
    where: {
      companyId: request.user.companyId,
      status: "ABERTO",
      openedAt: { lt: inicioDeHoje },
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      store: { select: { name: true } },
      cashRegister: { select: { name: true } },
      openedBy: { select: { name: true } },
      _count: { select: { sales: true } },
    },
    orderBy: { openedAt: "asc" },
  });

  return sessions.map((session) => ({
    id: session.id,
    code: session.code,
    loja: session.store.name,
    caixa: session.cashRegister.name,
    abertoPor: session.openedBy.name,
    abertoEm: session.openedAt,
    diasEmAberto: Math.floor((Date.now() - session.openedAt.getTime()) / 86_400_000),
    vendas: session._count.sales,
  }));
}

export async function listSessions(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  status?: "ABERTO" | "FECHADO" | undefined;
}) {
  const { request, storeId, status } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  return prisma.cashSession.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(status ? { status } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      store: { select: { name: true } },
      cashRegister: { select: { name: true } },
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      _count: { select: { sales: true } },
    },
    orderBy: { openedAt: "desc" },
    take: 100,
  });
}

/** Detalhe de um turno já fechado — aqui os valores podem aparecer. */
export async function getSession(params: { sessionId: string; request: FastifyRequest }) {
  const session = await prisma.cashSession.findFirst({
    where: { id: params.sessionId, companyId: params.request.user.companyId },
    include: {
      store: { select: { name: true } },
      cashRegister: { select: { name: true } },
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      movements: {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    throw notFound("SESSION_NOT_FOUND", "Turno de caixa não encontrado.");
  }

  await assertStoreAccess(params.request, session.storeId);

  // Enquanto está aberto, o saldo continua escondido: alguém poderia abrir
  // esta tela logo antes de contar.
  if (session.status === "ABERTO") {
    return {
      ...session,
      openingAmount: null,
      movements: session.movements.map((movement) => ({ ...movement, amount: null })),
      avisoFechamentoCego:
        "Os valores só aparecem depois do fechamento. Conte a gaveta primeiro.",
    };
  }

  return session;
}

/** Turno aberto do caixa, se houver — o PDV precisa saber antes de vender. */
export async function getOpenSessionForRegister(params: {
  cashRegisterId: string;
  request: FastifyRequest;
}) {
  const session = await prisma.cashSession.findFirst({
    where: {
      cashRegisterId: params.cashRegisterId,
      status: "ABERTO",
      companyId: params.request.user.companyId,
    },
    select: { id: true, code: true, openedAt: true, openedBy: { select: { name: true } } },
  });

  return session;
}

async function loadOpenSession(sessionId: string, request: FastifyRequest) {
  const session = await prisma.cashSession.findFirst({
    where: { id: sessionId, companyId: request.user.companyId },
    include: { openedBy: { select: { name: true } } },
  });

  if (!session) {
    throw notFound("SESSION_NOT_FOUND", "Turno de caixa não encontrado.");
  }

  await assertStoreAccess(request, session.storeId);

  if (session.status !== "ABERTO") {
    throw badRequest("SESSION_CLOSED", "Este turno de caixa já foi fechado.");
  }

  return session;
}

/**
 * Impede vender sem caixa aberto.
 *
 * Uma venda fora de turno não entra em fechamento nenhum: o dinheiro dela não
 * seria cobrado de ninguém na conferência.
 */
export async function assertSessionOpen(sessionId: string, companyId: string) {
  const session = await prisma.cashSession.findFirst({
    where: { id: sessionId, companyId },
  });

  if (!session) {
    throw notFound("SESSION_NOT_FOUND", "Turno de caixa não encontrado.");
  }
  if (session.status !== "ABERTO") {
    throw forbidden(
      "SESSION_CLOSED",
      "O caixa está fechado. Abra o caixa antes de registrar a venda.",
    );
  }

  return session;
}
