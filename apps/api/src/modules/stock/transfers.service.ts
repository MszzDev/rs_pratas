import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { applyMovement, assertProductBelongsToCompany } from "./stock.service.js";

/**
 * Transferência entre lojas em dois atos: enviar e receber.
 *
 * Não é uma operação só porque a peça leva tempo no caminho. Baixar da origem e
 * somar no destino no mesmo instante faria o sistema afirmar que a peça está na
 * loja B enquanto ela ainda está dentro de um carro — e, se sumir no trajeto,
 * nada registraria onde ela estava quando sumiu.
 */

async function nextTransferCode(companyId: string): Promise<string> {
  const count = await prisma.stockTransfer.count({ where: { companyId } });
  return `TR${String(count + 1).padStart(5, "0")}`;
}

export async function createTransfer(params: {
  input: {
    fromStoreId: string;
    toStoreId: string;
    notes?: string | undefined;
    items: Array<{ productId: string; variationId?: string | undefined; quantity: number }>;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  if (input.fromStoreId === input.toStoreId) {
    throw badRequest("SAME_STORE", "A loja de origem e a de destino são a mesma.");
  }
  if (input.items.length === 0) {
    throw badRequest("NO_ITEMS", "Escolha ao menos uma peça para transferir.");
  }

  // Quem envia precisa ter acesso à origem. O destino não: mandar peça para uma
  // loja que não é a sua é justamente o caso normal.
  await assertStoreAccess(request, input.fromStoreId);

  const destination = await prisma.store.findFirst({
    where: { id: input.toStoreId, companyId: request.user.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!destination) {
    throw notFound("STORE_NOT_FOUND", "Loja de destino não encontrada.");
  }

  for (const item of input.items) {
    if (item.quantity <= 0) {
      throw badRequest("INVALID_QUANTITY", "A quantidade precisa ser maior que zero.");
    }
    await assertProductBelongsToCompany(
      item.productId,
      request.user.companyId,
      item.variationId ?? null,
    );
  }

  const transfer = await prisma.stockTransfer.create({
    data: {
      companyId: request.user.companyId,
      fromStoreId: input.fromStoreId,
      toStoreId: input.toStoreId,
      code: await nextTransferCode(request.user.companyId),
      notes: input.notes ?? null,
      createdById: request.user.sub,
      items: {
        create: input.items.map((item) => ({
          productId: item.productId,
          variationId: item.variationId ?? null,
          quantitySent: item.quantity,
        })),
      },
    },
    include: { items: true },
  });

  await audit(request, {
    action: "STOCK_TRANSFER_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.fromStoreId,
    userRoleSnapshot: request.user.role,
    entityType: "StockTransfer",
    entityId: transfer.id,
    newData: { code: transfer.code, toStoreId: input.toStoreId, itens: input.items.length },
  });

  return transfer;
}

/**
 * Despacha a transferência: a peça sai do estoque da origem AGORA.
 *
 * A baixa acontece aqui, não no recebimento. Se esperasse o destino confirmar,
 * a origem continuaria oferecendo para venda uma peça que já está na estrada — e
 * a loja venderia o que não tem.
 */
export async function sendTransfer(params: { transferId: string; request: FastifyRequest }) {
  const { transferId, request } = params;

  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: transferId, companyId: request.user.companyId },
    include: { items: true },
  });
  if (!transfer) {
    throw notFound("TRANSFER_NOT_FOUND", "Transferência não encontrada.");
  }

  await assertStoreAccess(request, transfer.fromStoreId);

  if (transfer.status !== "RASCUNHO") {
    throw badRequest("TRANSFER_ALREADY_SENT", "Esta transferência já saiu da loja de origem.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      await applyMovement(tx, {
        companyId: transfer.companyId,
        storeId: transfer.fromStoreId,
        productId: item.productId,
        variationId: item.variationId,
        type: "TRANSFERENCIA_SAIDA",
        quantity: item.quantitySent,
        userId: request.user.sub,
        reason: `transferência ${transfer.code}`,
        referenceType: "StockTransfer",
        referenceId: transfer.id,
        transferId: transfer.id,
      });
    }

    return tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "EM_TRANSITO", sentAt: new Date(), sentById: request.user.sub },
    });
  });

  await audit(request, {
    action: "STOCK_TRANSFER_SEND",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: transfer.companyId,
    storeId: transfer.fromStoreId,
    userRoleSnapshot: request.user.role,
    entityType: "StockTransfer",
    entityId: transfer.id,
    newData: { code: transfer.code, status: "EM_TRANSITO" },
  });

  return updated;
}

/**
 * Recebe no destino, conferindo peça por peça.
 *
 * O que entra é o que foi CONTADO, não o que foi enviado. Se chegou menos, a
 * diferença fica registrada e visível: é exatamente o número que denuncia peça
 * perdida no caminho. Aceitar o valor enviado sem conferir esconderia isso.
 */
export async function receiveTransfer(params: {
  transferId: string;
  counted: Array<{ itemId: string; quantityReceived: number }>;
  request: FastifyRequest;
}) {
  const { transferId, counted, request } = params;

  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: transferId, companyId: request.user.companyId },
    include: { items: true },
  });
  if (!transfer) {
    throw notFound("TRANSFER_NOT_FOUND", "Transferência não encontrada.");
  }

  await assertStoreAccess(request, transfer.toStoreId);

  if (transfer.status !== "EM_TRANSITO") {
    throw badRequest(
      "TRANSFER_NOT_IN_TRANSIT",
      "Só é possível receber uma transferência que está a caminho.",
    );
  }

  const countedById = new Map(counted.map((row) => [row.itemId, row.quantityReceived]));

  for (const item of transfer.items) {
    if (!countedById.has(item.id)) {
      throw badRequest(
        "MISSING_COUNT",
        "Confira todas as peças da lista antes de concluir o recebimento.",
      );
    }
    const quantity = countedById.get(item.id) ?? 0;
    if (quantity < 0 || quantity > item.quantitySent) {
      throw badRequest(
        "INVALID_COUNT",
        "A quantidade recebida não pode ser negativa nem maior que a enviada.",
      );
    }
  }

  const divergences: Array<{ itemId: string; enviado: number; recebido: number }> = [];

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      const received = countedById.get(item.id) ?? 0;

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { quantityReceived: received },
      });

      if (received !== item.quantitySent) {
        divergences.push({
          itemId: item.id,
          enviado: item.quantitySent,
          recebido: received,
        });
      }

      if (received > 0) {
        await applyMovement(tx, {
          companyId: transfer.companyId,
          storeId: transfer.toStoreId,
          productId: item.productId,
          variationId: item.variationId,
          type: "TRANSFERENCIA_ENTRADA",
          quantity: received,
          userId: request.user.sub,
          reason: `transferência ${transfer.code}`,
          referenceType: "StockTransfer",
          referenceId: transfer.id,
          transferId: transfer.id,
        });
      }
    }

    return tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "RECEBIDA", receivedAt: new Date(), receivedById: request.user.sub },
    });
  });

  await audit(request, {
    action: "STOCK_TRANSFER_RECEIVE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: transfer.companyId,
    storeId: transfer.toStoreId,
    userRoleSnapshot: request.user.role,
    entityType: "StockTransfer",
    entityId: transfer.id,
    newData: { code: transfer.code, status: "RECEBIDA" },
    // A divergência vai para a auditoria mesmo quando não há: registrar o
    // "conferido e bateu" é o que dá valor ao registro de quando não bate.
    metadata: { divergencias: divergences },
  });

  return { transfer: updated, divergencias: divergences };
}

/**
 * Cancela — só antes de sair. Depois de despachada, o caminho é receber (mesmo
 * que zero peças) para que a diferença apareça, em vez de a transferência
 * sumir levando o rastro da peça junto.
 */
export async function cancelTransfer(params: {
  transferId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { transferId, reason, request } = params;

  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: transferId, companyId: request.user.companyId },
  });
  if (!transfer) {
    throw notFound("TRANSFER_NOT_FOUND", "Transferência não encontrada.");
  }

  await assertStoreAccess(request, transfer.fromStoreId);

  if (transfer.status !== "RASCUNHO") {
    throw badRequest(
      "TRANSFER_ALREADY_SENT",
      "A transferência já saiu da loja. Registre o recebimento, mesmo que não tenha chegado nada.",
    );
  }

  const updated = await prisma.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "CANCELADA", cancelledAt: new Date(), cancelReason: reason },
  });

  await audit(request, {
    action: "STOCK_TRANSFER_CANCEL",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: transfer.companyId,
    storeId: transfer.fromStoreId,
    userRoleSnapshot: request.user.role,
    entityType: "StockTransfer",
    entityId: transfer.id,
    reason,
  });

  return updated;
}

export async function listTransfers(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
}) {
  const { request, storeId } = params;

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";
  const reachable = seesEverything ? undefined : request.user.storeIds;

  return prisma.stockTransfer.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId
        ? { OR: [{ fromStoreId: storeId }, { toStoreId: storeId }] }
        : reachable
          ? { OR: [{ fromStoreId: { in: reachable } }, { toStoreId: { in: reachable } }] }
          : {}),
    },
    include: {
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getTransfer(params: { transferId: string; request: FastifyRequest }) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: params.transferId, companyId: params.request.user.companyId },
    include: {
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
      items: true,
    },
  });

  if (!transfer) {
    throw notFound("TRANSFER_NOT_FOUND", "Transferência não encontrada.");
  }

  // Ver a transferência exige acesso a uma das pontas — nem origem nem destino
  // significa que ela não é assunto de quem perguntou.
  const seesEverything =
    params.request.user.role === "DONO" || params.request.user.role === "DESENVOLVEDOR";
  const reachable = params.request.user.storeIds;

  if (
    !seesEverything &&
    !reachable.includes(transfer.fromStoreId) &&
    !reachable.includes(transfer.toStoreId)
  ) {
    throw notFound("TRANSFER_NOT_FOUND", "Transferência não encontrada.");
  }

  return transfer;
}

/** Só o dono move peça para fora das lojas que o usuário alcança. */
export function assertCanTransferAcrossStores(request: FastifyRequest): void {
  if (request.user.role === "DESENVOLVEDOR") {
    throw forbidden("DEVELOPER_READ_ONLY", "O perfil desenvolvedor não altera estoque.");
  }
}
