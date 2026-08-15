import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors.js";
import { getEffectivePermissions } from "../../core/rbac/permissions.engine.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { applyMovement } from "../stock/stock.service.js";
import { assertSessionOpen } from "../cash/cash.service.js";

/**
 * Troca e devolução.
 *
 * A venda original NUNCA é alterada. A devolução é um fato novo, com data
 * própria, que aponta para ela — o comprovante que o cliente levou continua
 * valendo, e o caixa do dia em que a peça voltou é o que recebe a saída do
 * dinheiro. Mexer na venda de trinta dias atrás reabriria um caixa já
 * conferido e assinado.
 *
 * O valor devolvido é o que foi PAGO por aquele item, não o preço de hoje.
 * Devolver pelo preço atual faria a loja pagar a diferença quando o produto
 * subiu, e o cliente perder quando desceu.
 */

/** Prazo legal de arrependimento e troca. Configurável por empresa depois. */
const DEFAULT_RETURN_WINDOW_DAYS = 30;

async function nextReturnCode(companyId: string): Promise<string> {
  const count = await prisma.saleReturn.count({ where: { companyId } });
  return `DV${String(count + 1).padStart(6, "0")}`;
}

export async function createReturn(params: {
  input: {
    originalSaleId: string;
    sessionId: string;
    type: "DEVOLUCAO" | "TROCA";
    reason: string;
    items: Array<{
      saleItemId: string;
      quantity: number;
      /** Peça danificada não volta para a prateleira. */
      returnedToStock?: boolean | undefined;
      condition?: string | undefined;
    }>;
    authorizedById?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  const companyId = request.user.companyId;

  const sale = await prisma.sale.findFirst({
    where: { id: input.originalSaleId, companyId },
    include: { items: true, returns: { include: { items: true } } },
  });
  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }
  if (sale.status !== "CONCLUIDA") {
    throw badRequest(
      "SALE_NOT_RETURNABLE",
      "Só uma venda concluída pode ser devolvida.",
    );
  }

  await assertStoreAccess(request, sale.storeId);

  // O turno é o de HOJE, não o da venda: é do caixa de hoje que o dinheiro sai.
  const session = await assertSessionOpen(input.sessionId, companyId);
  if (session.storeId !== sale.storeId) {
    throw badRequest(
      "SESSION_WRONG_STORE",
      "Abra o caixa da loja onde a peça está voltando.",
    );
  }

  const daysSinceSale = sale.completedAt
    ? (Date.now() - sale.completedAt.getTime()) / 86_400_000
    : 0;

  if (daysSinceSale > DEFAULT_RETURN_WINDOW_DAYS) {
    // Fora do prazo exige autorização de alguém com poder para isso — a loja
    // pode decidir aceitar, mas a decisão fica com nome.
    await assertRefundAuthorized({
      authorizedById: input.authorizedById,
      request,
      because: `A venda tem ${Math.floor(daysSinceSale)} dias, acima do prazo de ${DEFAULT_RETURN_WINDOW_DAYS}.`,
    });
  }

  // Quanto de cada item já voltou em devoluções anteriores.
  const alreadyReturned = new Map<string, number>();
  for (const previous of sale.returns) {
    for (const item of previous.items) {
      alreadyReturned.set(
        item.saleItemId,
        (alreadyReturned.get(item.saleItemId) ?? 0) + item.quantity,
      );
    }
  }

  const itemsById = new Map(sale.items.map((item) => [item.id, item]));

  const priced: Array<{
    saleItemId: string;
    productId: string;
    variationId: string | null;
    productName: string;
    quantity: number;
    refundAmount: Prisma.Decimal;
    returnedToStock: boolean;
    condition: string | null;
  }> = [];

  let refundTotal = new Prisma.Decimal(0);

  for (const entry of input.items) {
    const saleItem = itemsById.get(entry.saleItemId);
    if (!saleItem) {
      throw badRequest("ITEM_NOT_IN_SALE", "Um dos itens não pertence a esta venda.");
    }
    if (entry.quantity <= 0) {
      throw badRequest("INVALID_QUANTITY", "A quantidade precisa ser maior que zero.");
    }

    const remaining = saleItem.quantity - (alreadyReturned.get(saleItem.id) ?? 0);
    if (entry.quantity > remaining) {
      throw conflict(
        "ALREADY_RETURNED",
        `De ${saleItem.productName}, só restam ${remaining} peça(s) por devolver nesta venda.`,
      );
    }

    // O que foi pago por peça, já descontado o desconto daquele item.
    const paidPerUnit = saleItem.totalAmount.div(saleItem.quantity);
    const refund = paidPerUnit.mul(entry.quantity);
    refundTotal = refundTotal.plus(refund);

    priced.push({
      saleItemId: saleItem.id,
      productId: saleItem.productId,
      variationId: saleItem.variationId,
      productName: saleItem.productName,
      quantity: entry.quantity,
      refundAmount: refund,
      returnedToStock: entry.returnedToStock ?? true,
      condition: entry.condition ?? null,
    });
  }

  const saleReturn = await prisma.$transaction(async (tx) => {
    const created = await tx.saleReturn.create({
      data: {
        companyId,
        storeId: sale.storeId,
        originalSaleId: sale.id,
        sessionId: session.id,
        code: await nextReturnCode(companyId),
        type: input.type,
        status: "CONCLUIDA",
        refundAmount: refundTotal,
        reason: input.reason,
        authorizedById: input.authorizedById ?? null,
        createdById: request.user.sub,
        items: {
          create: priced.map((item) => ({
            saleItemId: item.saleItemId,
            quantity: item.quantity,
            refundAmount: item.refundAmount,
            returnedToStock: item.returnedToStock,
            condition: item.condition,
          })),
        },
      },
      include: { items: true },
    });

    for (const item of priced) {
      const reason = `${input.type.toLowerCase()} ${created.code}`;

      // A peça sempre ENTRA de volta primeiro: ela saiu na venda, e voltou às
      // mãos da loja. O que muda é o que acontece depois.
      await applyMovement(tx, {
        companyId,
        storeId: sale.storeId,
        productId: item.productId,
        variationId: item.variationId,
        type: "DEVOLUCAO",
        quantity: item.quantity,
        userId: request.user.sub,
        reason,
        referenceType: "SaleReturn",
        referenceId: created.id,
      });

      // Danificada, sai de novo como PERDA. O par entrada+perda faz o
      // histórico contar a verdade: a peça voltou e foi descartada. Lançar só
      // a perda subtrairia do saldo uma peça que já tinha saído na venda.
      if (!item.returnedToStock) {
        await applyMovement(tx, {
          companyId,
          storeId: sale.storeId,
          productId: item.productId,
          variationId: item.variationId,
          type: "PERDA",
          quantity: item.quantity,
          userId: request.user.sub,
          reason: `${reason} — devolvida danificada${
            item.condition ? `: ${item.condition}` : ""
          }`,
          referenceType: "SaleReturn",
          referenceId: created.id,
        });
      }
    }

    // Numa DEVOLUÇÃO o dinheiro sai da gaveta agora. Numa TROCA não sai: o
    // valor vira crédito para a venda de substituição, que é registrada
    // separadamente.
    if (input.type === "DEVOLUCAO" && refundTotal.greaterThan(0)) {
      await tx.cashMovement.create({
        data: {
          sessionId: session.id,
          companyId,
          storeId: sale.storeId,
          type: "DEVOLUCAO",
          amount: refundTotal.negated(),
          isCash: true,
          reason: `devolução ${created.code} da venda ${sale.code}`,
          referenceType: "SaleReturn",
          referenceId: created.id,
          userId: request.user.sub,
        },
      });
    }

    return created;
  });

  await audit(request, {
    action: "SALE_RETURN",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    storeId: sale.storeId,
    cashRegisterId: session.cashRegisterId,
    userRoleSnapshot: request.user.role,
    entityType: "SaleReturn",
    entityId: saleReturn.id,
    newData: {
      code: saleReturn.code,
      tipo: input.type,
      vendaOriginal: sale.code,
      refundAmount: refundTotal.toFixed(2),
      itens: priced.length,
      diasDesdeVenda: Math.floor(daysSinceSale),
    },
    reason: input.reason,
    ...(input.authorizedById ? { metadata: { autorizadoPor: input.authorizedById } } : {}),
  });

  return {
    ...saleReturn,
    /** Na troca, é o crédito que o cliente tem para levar outra peça. */
    creditoParaTroca: input.type === "TROCA" ? refundTotal.toFixed(2) : null,
  };
}

/** Devolução fora do prazo precisa de quem tenha SALE_REFUND. */
async function assertRefundAuthorized(params: {
  authorizedById?: string | undefined;
  request: FastifyRequest;
  because: string;
}) {
  const own = await getEffectivePermissions(params.request.user.sub);
  if (own.has("SALE_REFUND")) return;

  if (!params.authorizedById) {
    throw forbidden(
      "REFUND_NEEDS_AUTHORIZATION",
      `${params.because} Chame o responsável da loja para autorizar.`,
    );
  }

  const authorizer = await prisma.user.findFirst({
    where: {
      id: params.authorizedById,
      companyId: params.request.user.companyId,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!authorizer) {
    throw badRequest("AUTHORIZER_NOT_FOUND", "Quem autorizaria não foi encontrado.");
  }

  const permissions = await getEffectivePermissions(authorizer.id);
  if (!permissions.has("SALE_REFUND")) {
    throw forbidden(
      "AUTHORIZER_CANNOT_APPROVE",
      "Esta pessoa não tem permissão para autorizar devolução.",
    );
  }
}

export async function listReturns(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  saleId?: string | undefined;
}) {
  const { request, storeId, saleId } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  return prisma.saleReturn.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(saleId ? { originalSaleId: saleId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      store: { select: { name: true } },
      originalSale: { select: { code: true, completedAt: true, customer: { select: { name: true } } } },
      items: { include: { saleItem: { select: { productName: true, productSku: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/** O que ainda pode ser devolvido de uma venda — o que a tela precisa saber. */
export async function getReturnableItems(params: { saleId: string; request: FastifyRequest }) {
  const sale = await prisma.sale.findFirst({
    where: { id: params.saleId, companyId: params.request.user.companyId },
    include: { items: true, returns: { include: { items: true } } },
  });
  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }

  await assertStoreAccess(params.request, sale.storeId);

  const returned = new Map<string, number>();
  for (const previous of sale.returns) {
    for (const item of previous.items) {
      returned.set(item.saleItemId, (returned.get(item.saleItemId) ?? 0) + item.quantity);
    }
  }

  const daysSinceSale = sale.completedAt
    ? Math.floor((Date.now() - sale.completedAt.getTime()) / 86_400_000)
    : 0;

  return {
    saleId: sale.id,
    code: sale.code,
    completedAt: sale.completedAt,
    diasDesdeVenda: daysSinceSale,
    dentroDoPrazo: daysSinceSale <= DEFAULT_RETURN_WINDOW_DAYS,
    prazoEmDias: DEFAULT_RETURN_WINDOW_DAYS,
    items: sale.items.map((item) => {
      const already = returned.get(item.id) ?? 0;
      return {
        saleItemId: item.id,
        productName: item.productName,
        productSku: item.productSku,
        quantidadeVendida: item.quantity,
        quantidadeDevolvida: already,
        quantidadeDisponivel: item.quantity - already,
        valorPorPeca: item.totalAmount.div(item.quantity).toFixed(2),
      };
    }),
  };
}
