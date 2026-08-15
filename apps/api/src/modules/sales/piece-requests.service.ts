import type { PieceRequestStatus } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { normalizePhone } from "../customers/customers.service.js";

/**
 * Solicitação de peça.
 *
 * É o pedido que hoje vira bilhete no caderno e some: o cliente entra
 * procurando uma peça que a loja não tem, o vendedor promete avisar, e ninguém
 * avisa. Registrado, o cliente é chamado quando a peça chega.
 *
 * O outro valor é para a loja: a lista do que as pessoas procuram e ela não
 * tem é a informação que decide a próxima compra do fornecedor — e é
 * exatamente a que nenhum sistema costuma guardar, porque a venda que não
 * aconteceu não deixa rastro.
 */

async function nextCode(companyId: string): Promise<string> {
  const count = await prisma.pieceRequest.count({ where: { companyId } });
  return `SP${String(count + 1).padStart(6, "0")}`;
}

export async function createPieceRequest(params: {
  input: {
    storeId: string;
    customerName: string;
    customerPhone: string;
    description: string;
    customerId?: string | undefined;
    productId?: string | undefined;
    size?: string | undefined;
    budgetAmount?: number | undefined;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  const phone = normalizePhone(input.customerPhone);
  if (phone.length < 10) {
    throw badRequest("INVALID_PHONE", "Informe o telefone com DDD — é por ele que vamos avisar.");
  }

  // Se a pessoa já é cliente, aproveita o cadastro. Não obriga: quem pede uma
  // peça muitas vezes ainda não comprou nada, e exigir cadastro completo trava
  // o atendimento no momento em que ele está indo bem.
  const existente = input.customerId
    ? null
    : await prisma.customer.findFirst({
        where: { companyId: request.user.companyId, phone, deletedAt: null },
        select: { id: true },
      });

  const pedido = await prisma.pieceRequest.create({
    data: {
      companyId: request.user.companyId,
      storeId: input.storeId,
      code: await nextCode(request.user.companyId),
      customerId: input.customerId ?? existente?.id ?? null,
      customerName: input.customerName,
      customerPhone: phone,
      description: input.description,
      productId: input.productId ?? null,
      size: input.size ?? null,
      budgetAmount: input.budgetAmount ?? null,
      notes: input.notes ?? null,
      createdById: request.user.sub,
    },
  });

  await audit(request, {
    action: "PIECE_REQUEST_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PieceRequest",
    entityId: pedido.id,
    newData: { code: pedido.code, cliente: pedido.customerName },
    reason: input.description,
  });

  return pedido;
}

export async function listPieceRequests(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  status?: PieceRequestStatus | undefined;
  /** Só o que ainda espera resposta — o padrão de quem abre a tela. */
  emAberto?: boolean | undefined;
}) {
  const { request, storeId, status, emAberto } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const pedidos = await prisma.pieceRequest.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(status ? { status } : {}),
      ...(emAberto
        ? { status: { in: ["ABERTA", "PROCURANDO", "ENCONTRADA", "AVISADO"] } }
        : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      store: { select: { name: true } },
      customer: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const agora = Date.now();

  return pedidos.map((pedido) => ({
    ...pedido,
    /**
     * Há quantos dias a pessoa está esperando. É o número que a tela ordena
     * por cima: pedido de três semanas sem resposta é cliente perdido, e sem
     * isso ele fica no meio da lista igual ao de ontem.
     */
    diasEsperando: Math.floor((agora - pedido.createdAt.getTime()) / 86_400_000),
  }));
}

/**
 * Avança o pedido: procurando, encontrada, cliente avisado, concluída.
 *
 * Cada passo fica com data própria porque a pergunta que aparece depois é
 * sempre "quando avisamos?" — e "o vendedor disse que avisou" não responde.
 */
export async function updatePieceRequest(params: {
  requestId: string;
  input: { status?: PieceRequestStatus | undefined; notes?: string | undefined };
  request: FastifyRequest;
}) {
  const { requestId, input, request } = params;

  const pedido = await prisma.pieceRequest.findFirst({
    where: { id: requestId, companyId: request.user.companyId },
  });
  if (!pedido) {
    throw notFound("PIECE_REQUEST_NOT_FOUND", "Solicitação não encontrada.");
  }

  await assertStoreAccess(request, pedido.storeId);

  if (pedido.status === "CONCLUIDA" || pedido.status === "CANCELADA") {
    throw badRequest("REQUEST_CLOSED", "Esta solicitação já foi encerrada.");
  }

  const atualizado = await prisma.pieceRequest.update({
    where: { id: pedido.id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      // Carimba o momento do aviso: é a data que responde "quando avisamos?".
      ...(input.status === "AVISADO" && !pedido.notifiedAt ? { notifiedAt: new Date() } : {}),
    },
  });

  await audit(request, {
    action: "PIECE_REQUEST_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: pedido.companyId,
    storeId: pedido.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PieceRequest",
    entityId: pedido.id,
    previousData: { status: pedido.status },
    newData: { status: atualizado.status },
    ...(input.notes ? { reason: input.notes } : {}),
  });

  return atualizado;
}

export async function cancelPieceRequest(params: {
  requestId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { requestId, reason, request } = params;

  const pedido = await prisma.pieceRequest.findFirst({
    where: { id: requestId, companyId: request.user.companyId },
  });
  if (!pedido) {
    throw notFound("PIECE_REQUEST_NOT_FOUND", "Solicitação não encontrada.");
  }

  await assertStoreAccess(request, pedido.storeId);

  if (pedido.status === "CONCLUIDA") {
    throw badRequest("ALREADY_DONE", "Esta solicitação já foi concluída.");
  }

  const atualizado = await prisma.pieceRequest.update({
    where: { id: pedido.id },
    data: { status: "CANCELADA", cancelReason: reason },
  });

  await audit(request, {
    action: "PIECE_REQUEST_CANCEL",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: pedido.companyId,
    storeId: pedido.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PieceRequest",
    entityId: pedido.id,
    previousData: { status: pedido.status },
    newData: { status: "CANCELADA" },
    reason,
  });

  return atualizado;
}

/**
 * O que as pessoas pedem e a loja não tem.
 *
 * Agrupa os pedidos abertos por descrição parecida para o dono ver o padrão —
 * cinco pessoas pedindo pulseira masculina no mesmo mês é uma compra a fazer,
 * não cinco bilhetes soltos.
 */
export async function demandSummary(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
}) {
  const { request, storeId } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";
  const noventaDias = new Date(Date.now() - 90 * 86_400_000);

  const pedidos = await prisma.pieceRequest.findMany({
    where: {
      companyId: request.user.companyId,
      createdAt: { gte: noventaDias },
      ...(storeId ? { storeId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    select: { description: true, status: true, budgetAmount: true },
  });

  // Agrupa pelas palavras significativas da descrição. É aproximação, e é o
  // suficiente: quem lê a lista é uma pessoa decidindo o que comprar, não um
  // relatório que precisa fechar centavo.
  const porTermo = new Map<string, { pedidos: number; atendidos: number }>();

  for (const pedido of pedidos) {
    const palavras = pedido.description
      .toLowerCase()
      .split(/\s+/)
      .filter((palavra) => palavra.length > 3);

    for (const palavra of new Set(palavras)) {
      const atual = porTermo.get(palavra) ?? { pedidos: 0, atendidos: 0 };
      atual.pedidos += 1;
      if (pedido.status === "CONCLUIDA") atual.atendidos += 1;
      porTermo.set(palavra, atual);
    }
  }

  return [...porTermo.entries()]
    .filter(([, dados]) => dados.pedidos >= 2)
    .map(([termo, dados]) => ({ termo, ...dados }))
    .sort((a, b) => b.pedidos - a.pedidos)
    .slice(0, 20);
}
