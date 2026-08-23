import type { Prisma, ServiceOrderStatus } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Ordem de serviço — o conserto.
 *
 * A cliente traz a aliança para soldar e a peça FICA na loja. A partir daí a
 * loja é responsável por um objeto que não é dela, e três perguntas passam a
 * existir todo dia: de quem é, em que estado chegou e quando fica pronta.
 * Sem registro, a resposta mora na memória de quem atendeu — e some na folga.
 *
 * O estado de entrada é obrigatório de propósito: é a única defesa da loja
 * quando, na retirada, o cliente aponta um risco que já vinha na peça.
 */

/** Ordem que ainda não saiu da loja aceita mudança; entregue e cancelada, não. */
const ENCERRADAS: ServiceOrderStatus[] = ["ENTREGUE", "CANCELADA"];

/**
 * Transições possíveis a partir de cada situação.
 *
 * Existe para a ordem não pular etapa nem voltar do túmulo: uma peça entregue
 * não volta a estar "em reparo", e o histórico da oficina precisa fazer
 * sentido quando alguém for conferir semanas depois.
 */
const TRANSICOES: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  ABERTA: ["EM_ANALISE", "AGUARDANDO_CLIENTE", "EM_REPARO", "CANCELADA"],
  EM_ANALISE: ["AGUARDANDO_CLIENTE", "EM_REPARO", "CANCELADA"],
  AGUARDANDO_CLIENTE: ["EM_REPARO", "CANCELADA"],
  EM_REPARO: ["PRONTA", "AGUARDANDO_CLIENTE", "CANCELADA"],
  PRONTA: ["ENTREGUE", "EM_REPARO"],
  ENTREGUE: [],
  CANCELADA: [],
};

/**
 * Tupla `as const` de propósito: o Zod da rota precisa dos literais para
 * devolver `ServiceOrderStatus` em vez de `string`. Com `string[]` o tipo se
 * perde na fronteira e volta como cast na rota, que é onde ele deixa de valer.
 */
export const SERVICE_ORDER_STATUSES = [
  "ABERTA",
  "EM_ANALISE",
  "AGUARDANDO_CLIENTE",
  "EM_REPARO",
  "PRONTA",
  "ENTREGUE",
  "CANCELADA",
] as const satisfies readonly ServiceOrderStatus[];

/**
 * Próximo código da empresa.
 *
 * Procura o maior número já usado em vez de contar quantas ordens existem: com
 * uma ordem apagada no meio, a contagem devolveria um código que já foi de
 * outra peça — e duas ordens com o mesmo número numa oficina é exatamente como
 * se troca a peça de dois clientes.
 */
async function nextCode(companyId: string): Promise<string> {
  const ultima = await prisma.serviceOrder.findFirst({
    where: { companyId, code: { startsWith: "OS" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  const numero = ultima ? Number(ultima.code.replace("OS", "")) : 0;
  return `OS${String((Number.isFinite(numero) ? numero : 0) + 1).padStart(6, "0")}`;
}

export async function createServiceOrder(params: {
  input: {
    storeId: string;
    customerId: string;
    description: string;
    intakeCondition: string;
    productId?: string | undefined;
    estimatedAmount?: number | undefined;
    underWarranty?: boolean | undefined;
    promisedFor?: string | undefined;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, companyId: request.user.companyId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!customer) {
    throw notFound("CUSTOMER_NOT_FOUND", "Cliente não encontrado.");
  }

  const order = await prisma.serviceOrder.create({
    data: {
      companyId: request.user.companyId,
      storeId: input.storeId,
      customerId: customer.id,
      code: await nextCode(request.user.companyId),
      description: input.description.trim(),
      intakeCondition: input.intakeCondition.trim(),
      productId: input.productId ?? null,
      estimatedAmount: input.estimatedAmount ?? null,
      underWarranty: input.underWarranty ?? false,
      promisedFor: input.promisedFor ? new Date(input.promisedFor) : null,
      notes: input.notes?.trim() ?? null,
      createdById: request.user.sub,
    },
    include: { customer: { select: { name: true, phone: true } } },
  });

  await audit(request, {
    action: "SERVICE_ORDER_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "ServiceOrder",
    entityId: order.id,
    newData: {
      code: order.code,
      customerId: customer.id,
      description: order.description,
      underWarranty: order.underWarranty,
    },
  });

  return order;
}

export async function listServiceOrders(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  status?: ServiceOrderStatus | undefined;
  emAberto?: boolean | undefined;
}) {
  const { request, storeId, status, emAberto } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const where: Prisma.ServiceOrderWhereInput = {
    companyId: request.user.companyId,
    ...(storeId ? { storeId } : {}),
    ...(status ? { status } : {}),
    // "Em aberto" é o que ainda ocupa espaço na gaveta da oficina.
    ...(emAberto ? { status: { notIn: ENCERRADAS } } : {}),
  };

  // Gerente e vendedor só enxergam as ordens das lojas em que atuam.
  if (!storeId && request.user.role !== "DONO" && request.user.role !== "DESENVOLVEDOR") {
    where.storeId = { in: request.user.storeIds };
  }

  const orders = await prisma.serviceOrder.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      store: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { promisedFor: "asc" }, { createdAt: "desc" }],
    take: 300,
  });

  const agora = Date.now();

  return orders.map((order) => ({
    ...order,
    /** Prometida para antes de hoje e ainda não entregue. */
    atrasada:
      order.promisedFor !== null &&
      !ENCERRADAS.includes(order.status) &&
      order.promisedFor.getTime() < agora,
    diasNaLoja: Math.floor((agora - order.createdAt.getTime()) / 86_400_000),
  }));
}

export async function updateServiceOrder(params: {
  orderId: string;
  input: {
    status?: ServiceOrderStatus | undefined;
    estimatedAmount?: number | undefined;
    finalAmount?: number | undefined;
    promisedFor?: string | undefined;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { orderId, input, request } = params;

  const order = await prisma.serviceOrder.findFirst({
    where: { id: orderId, companyId: request.user.companyId },
  });
  if (!order) {
    throw notFound("SERVICE_ORDER_NOT_FOUND", "Ordem de serviço não encontrada.");
  }

  await assertStoreAccess(request, order.storeId);

  if (ENCERRADAS.includes(order.status)) {
    throw badRequest(
      "SERVICE_ORDER_CLOSED",
      `Esta ordem já está ${order.status === "ENTREGUE" ? "entregue" : "cancelada"} e não muda mais.`,
    );
  }

  if (input.status && input.status !== order.status) {
    const permitidas = TRANSICOES[order.status];

    if (!permitidas.includes(input.status)) {
      throw badRequest(
        "INVALID_TRANSITION",
        `Uma ordem ${order.status.toLowerCase().replace("_", " ")} não pode passar para ${input.status
          .toLowerCase()
          .replace("_", " ")}.`,
      );
    }
  }

  // Entregar sem dizer quanto ficou deixaria a oficina sem faturamento no
  // relatório — e o valor combinado só existe na cabeça de quem atendeu.
  if (input.status === "ENTREGUE") {
    const valor = input.finalAmount ?? Number(order.finalAmount ?? Number.NaN);

    if (!order.underWarranty && !Number.isFinite(valor)) {
      throw badRequest(
        "FINAL_AMOUNT_REQUIRED",
        "Informe quanto foi cobrado antes de entregar. Se for garantia, marque a ordem como coberta.",
      );
    }
  }

  const updated = await prisma.serviceOrder.update({
    where: { id: order.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.estimatedAmount !== undefined ? { estimatedAmount: input.estimatedAmount } : {}),
      ...(input.finalAmount !== undefined ? { finalAmount: input.finalAmount } : {}),
      ...(input.promisedFor ? { promisedFor: new Date(input.promisedFor) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      ...(input.status === "ENTREGUE" ? { deliveredAt: new Date() } : {}),
    },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });

  await audit(request, {
    action: "SERVICE_ORDER_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: order.companyId,
    storeId: order.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "ServiceOrder",
    entityId: order.id,
    previousData: {
      status: order.status,
      finalAmount: order.finalAmount?.toString() ?? null,
      promisedFor: order.promisedFor?.toISOString() ?? null,
    },
    newData: {
      status: updated.status,
      finalAmount: updated.finalAmount?.toString() ?? null,
      promisedFor: updated.promisedFor?.toISOString() ?? null,
    },
  });

  return updated;
}

export async function cancelServiceOrder(params: {
  orderId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { orderId, reason, request } = params;

  const order = await prisma.serviceOrder.findFirst({
    where: { id: orderId, companyId: request.user.companyId },
  });
  if (!order) {
    throw notFound("SERVICE_ORDER_NOT_FOUND", "Ordem de serviço não encontrada.");
  }

  await assertStoreAccess(request, order.storeId);

  if (order.status === "ENTREGUE") {
    throw badRequest(
      "ALREADY_DELIVERED",
      "A peça já foi entregue ao cliente — não há o que cancelar.",
    );
  }

  const updated = await prisma.serviceOrder.update({
    where: { id: order.id },
    data: {
      status: "CANCELADA",
      // O motivo entra nas observações porque a ordem é o documento que fica
      // com a peça: quem abrir depois precisa ler ali por que parou.
      notes: [order.notes, `Cancelada: ${reason}`].filter(Boolean).join("\n"),
    },
  });

  await audit(request, {
    action: "SERVICE_ORDER_CANCEL",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: order.companyId,
    storeId: order.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "ServiceOrder",
    entityId: order.id,
    previousData: { status: order.status },
    newData: { status: "CANCELADA" },
    reason,
  });

  return updated;
}
