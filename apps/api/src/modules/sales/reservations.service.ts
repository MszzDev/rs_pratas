import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { assertProductBelongsToCompany } from "../stock/stock.service.js";

/**
 * Reserva: a peça continua na loja, mas some do saldo disponível.
 *
 * Não é baixa de estoque — a peça não saiu. É `reservedQuantity` subindo, e o
 * disponível para venda passa a ser `quantity - reservedQuantity`. É isso que
 * impede vender na terça a aliança que alguém já veio separar na segunda.
 *
 * Toda reserva tem prazo. Sem prazo, uma peça fica travada para sempre por um
 * cliente que nunca voltou, e o estoque mente ao contrário: diz que não tem o
 * que está ali na gaveta.
 */

const DEFAULT_RESERVATION_DAYS = 7;

async function nextReservationCode(companyId: string): Promise<string> {
  const count = await prisma.reservation.count({ where: { companyId } });
  return `RS${String(count + 1).padStart(6, "0")}`;
}

export async function createReservation(params: {
  input: {
    storeId: string;
    customerId: string;
    productId: string;
    variationId?: string | undefined;
    quantity?: number | undefined;
    depositAmount?: number | undefined;
    days?: number | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  const companyId = request.user.companyId;

  await assertStoreAccess(request, input.storeId);
  await assertProductBelongsToCompany(input.productId, companyId, input.variationId ?? null);

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, companyId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    throw notFound("CUSTOMER_NOT_FOUND", "Cliente não encontrado.");
  }

  const quantity = input.quantity ?? 1;
  const days = input.days ?? DEFAULT_RESERVATION_DAYS;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  const reservation = await prisma.$transaction(async (tx) => {
    const item = await tx.stockItem.findFirst({
      where: {
        storeId: input.storeId,
        productId: input.productId,
        variationId: input.variationId ?? null,
      },
    });

    const available = (item?.quantity ?? 0) - (item?.reservedQuantity ?? 0);
    if (available < quantity) {
      throw conflict(
        "INSUFFICIENT_STOCK",
        `Só há ${available} peça(s) disponível(is) nesta loja para reservar.`,
      );
    }

    await tx.stockItem.update({
      where: { id: item!.id },
      data: { reservedQuantity: item!.reservedQuantity + quantity },
    });

    return tx.reservation.create({
      data: {
        companyId,
        storeId: input.storeId,
        customerId: input.customerId,
        code: await nextReservationCode(companyId),
        productId: input.productId,
        variationId: input.variationId ?? null,
        quantity,
        depositAmount: input.depositAmount ?? 0,
        expiresAt,
        createdById: request.user.sub,
      },
    });
  });

  await audit(request, {
    action: "RESERVATION_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Reservation",
    entityId: reservation.id,
    newData: {
      code: reservation.code,
      customerId: input.customerId,
      quantity,
      depositAmount: reservation.depositAmount,
      expiresAt: reservation.expiresAt,
    },
  });

  return reservation;
}

export async function cancelReservation(params: {
  reservationId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { reservationId, reason, request } = params;

  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, companyId: request.user.companyId },
  });
  if (!reservation) {
    throw notFound("RESERVATION_NOT_FOUND", "Reserva não encontrada.");
  }

  await assertStoreAccess(request, reservation.storeId);

  if (reservation.status !== "ATIVA") {
    throw badRequest("RESERVATION_NOT_ACTIVE", "Esta reserva não está mais ativa.");
  }

  await prisma.$transaction(async (tx) => {
    await releaseReserved(tx, reservation);

    await tx.reservation.update({
      where: { id: reservation.id },
      data: { status: "CANCELADA", cancelReason: reason },
    });
  });

  await audit(request, {
    action: "RESERVATION_CANCEL",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: reservation.companyId,
    storeId: reservation.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Reservation",
    entityId: reservation.id,
    previousData: { status: "ATIVA" },
    newData: { status: "CANCELADA" },
    reason,
    // O sinal pago não é devolvido automaticamente — quem cancela precisa
    // resolver isso com o cliente, e o registro deixa o valor visível.
    ...(reservation.depositAmount.greaterThan(0)
      ? { metadata: { sinalAPagarDeVolta: reservation.depositAmount.toFixed(2) } }
      : {}),
  });

  return { id: reservation.id, code: reservation.code, status: "CANCELADA" as const };
}

/**
 * Devolve à prateleira o que passou do prazo.
 *
 * Chamado sob demanda ao listar, e não por um job: a rede tem três lojas, o
 * volume é pequeno, e uma tarefa agendada seria mais uma peça para manter no ar
 * sem ganho real. Se o volume crescer, isto vira job — a lógica já está isolada.
 */
export async function expireOverdueReservations(companyId: string): Promise<number> {
  const overdue = await prisma.reservation.findMany({
    where: { companyId, status: "ATIVA", expiresAt: { lt: new Date() } },
  });

  if (overdue.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    for (const reservation of overdue) {
      await releaseReserved(tx, reservation);
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "EXPIRADA" },
      });
    }
  });

  return overdue.length;
}

export async function listReservations(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  status?: "ATIVA" | "CONVERTIDA" | "CANCELADA" | "EXPIRADA" | undefined;
}) {
  const { request, storeId, status } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  // Expira antes de listar, para a tela nunca mostrar como ativa uma reserva
  // cujo prazo passou ontem.
  await expireOverdueReservations(request.user.companyId);

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const reservations = await prisma.reservation.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(status ? { status } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      customer: { select: { name: true, phone: true } },
      store: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
    take: 200,
  });

  const now = Date.now();

  return reservations.map((reservation) => ({
    ...reservation,
    /**
     * Dias restantes — é o que o PDV mostra como notificação de andamento,
     * conforme pedido: a reserva aparece na tela de venda como aviso, não como
     * uma aba própria.
     */
    diasRestantes:
      reservation.status === "ATIVA"
        ? Math.ceil((reservation.expiresAt.getTime() - now) / 86_400_000)
        : null,
  }));
}

/** Devolve a quantidade reservada ao saldo disponível. */
async function releaseReserved(
  tx: Prisma.TransactionClient,
  reservation: { storeId: string; productId: string; variationId: string | null; quantity: number },
) {
  const item = await tx.stockItem.findFirst({
    where: {
      storeId: reservation.storeId,
      productId: reservation.productId,
      variationId: reservation.variationId,
    },
  });

  if (!item) return;

  await tx.stockItem.update({
    where: { id: item.id },
    // Math.max protege contra reserva liberada duas vezes: o CHECK do banco
    // recusaria um valor negativo e derrubaria a transação inteira, o que
    // seria pior que absorver a inconsistência aqui.
    data: { reservedQuantity: Math.max(0, item.reservedQuantity - reservation.quantity) },
  });
}
