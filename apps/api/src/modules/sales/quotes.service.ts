import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Orçamento — aba própria do PDV, sem nenhum efeito sobre o estoque.
 *
 * Não reserva peça de propósito. Orçamento é o cliente pensando; travar
 * mercadoria a cada simulação esvaziaria o disponível da loja sem que nada
 * tivesse sido vendido. Quem quer garantir a peça faz reserva, que é outro
 * ato, com prazo e sinal.
 *
 * O preço fica congelado até `validUntil` porque prata oscila, e prometer um
 * valor por tempo indefinido é prejuízo do lado da loja.
 */

const DEFAULT_VALID_DAYS = 15;

async function nextQuoteCode(companyId: string): Promise<string> {
  const count = await prisma.quote.count({ where: { companyId } });
  return `OR${String(count + 1).padStart(6, "0")}`;
}

export async function createQuote(params: {
  input: {
    storeId: string;
    customerId?: string | undefined;
    customerName?: string | undefined;
    customerPhone?: string | undefined;
    items: Array<{
      productId: string;
      variationId?: string | undefined;
      quantity: number;
    }>;
    discountAmount?: number | undefined;
    validDays?: number | undefined;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  const companyId = request.user.companyId;

  await assertStoreAccess(request, input.storeId);

  if (input.items.length === 0) {
    throw badRequest("EMPTY_QUOTE", "Adicione ao menos uma peça ao orçamento.");
  }
  if (!input.customerId && !input.customerName) {
    throw badRequest("CUSTOMER_REQUIRED", "Informe pelo menos o nome de quem pediu o orçamento.");
  }

  const priced = [];
  let subtotal = new Prisma.Decimal(0);

  for (const item of input.items) {
    if (item.quantity <= 0) {
      throw badRequest("INVALID_QUANTITY", "A quantidade precisa ser maior que zero.");
    }

    const product = await prisma.product.findFirst({
      where: { id: item.productId, companyId, deletedAt: null },
      include: {
        variations: item.variationId ? { where: { id: item.variationId } } : false,
      },
    });
    if (!product) {
      throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
    }

    const variation = item.variationId ? product.variations?.[0] : undefined;
    // Mesma regra da venda: o preço vem do catálogo, no servidor.
    const unitPrice = variation?.salePriceOverride ?? product.salePrice;
    const totalAmount = unitPrice.mul(item.quantity);

    subtotal = subtotal.plus(totalAmount);

    priced.push({
      productId: product.id,
      variationId: variation?.id ?? null,
      productName: product.name,
      productSku: variation?.sku ?? product.sku,
      quantity: item.quantity,
      unitPrice,
      totalAmount,
    });
  }

  const discount = new Prisma.Decimal(input.discountAmount ?? 0);
  if (discount.greaterThan(subtotal)) {
    throw badRequest("DISCOUNT_ABOVE_TOTAL", "O desconto é maior que o valor do orçamento.");
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (input.validDays ?? DEFAULT_VALID_DAYS));

  const quote = await prisma.quote.create({
    data: {
      companyId,
      storeId: input.storeId,
      customerId: input.customerId ?? null,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ? input.customerPhone.replace(/\D/g, "") : null,
      code: await nextQuoteCode(companyId),
      subtotalAmount: subtotal,
      discountAmount: discount,
      totalAmount: subtotal.minus(discount),
      validUntil,
      notes: input.notes ?? null,
      createdById: request.user.sub,
      items: { create: priced },
    },
    include: { items: true },
  });

  await audit(request, {
    action: "QUOTE_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Quote",
    entityId: quote.id,
    newData: { code: quote.code, totalAmount: quote.totalAmount, itens: quote.items.length },
  });

  return quote;
}

export async function listQuotes(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  status?: "ABERTO" | "CONVERTIDO" | "RECUSADO" | "EXPIRADO" | undefined;
}) {
  const { request, storeId, status } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  await expireOverdueQuotes(request.user.companyId);

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  return prisma.quote.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(status ? { status } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: {
      customer: { select: { name: true, phone: true } },
      store: { select: { name: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getQuote(params: { quoteId: string; request: FastifyRequest }) {
  const quote = await prisma.quote.findFirst({
    where: { id: params.quoteId, companyId: params.request.user.companyId },
    include: { customer: true, store: { select: { name: true } }, items: true },
  });

  if (!quote) {
    throw notFound("QUOTE_NOT_FOUND", "Orçamento não encontrado.");
  }

  await assertStoreAccess(params.request, quote.storeId);

  return quote;
}

/**
 * Prepara a conversão em venda: devolve os itens do orçamento para o PDV
 * montar o carrinho.
 *
 * NÃO cria a venda por si. A venda passa pelo caminho normal, com preço
 * recalculado no momento — o orçamento diz o que o cliente escolheu, e o preço
 * vigente é o que vale, exceto se o orçamento ainda estiver dentro do prazo.
 */
export async function prepareQuoteConversion(params: {
  quoteId: string;
  request: FastifyRequest;
}) {
  const quote = await getQuote(params);

  if (quote.status !== "ABERTO") {
    throw badRequest("QUOTE_NOT_OPEN", "Este orçamento não está mais aberto.");
  }

  const expired = quote.validUntil.getTime() < Date.now();

  return {
    quoteId: quote.id,
    code: quote.code,
    customerId: quote.customerId,
    customerName: quote.customer?.name ?? quote.customerName,
    customerPhone: quote.customer?.phone ?? quote.customerPhone,
    items: quote.items.map((item) => ({
      productId: item.productId,
      variationId: item.variationId,
      quantity: item.quantity,
      /** Preço prometido. Se o prazo passou, o PDV vai recalcular. */
      precoDoOrcamento: item.unitPrice,
    })),
    expirado: expired,
    aviso: expired
      ? "O prazo deste orçamento venceu. Os preços serão recalculados pelos valores de hoje."
      : null,
  };
}

export async function markQuoteConverted(params: {
  quoteId: string;
  saleId: string;
  request: FastifyRequest;
}) {
  const quote = await prisma.quote.findFirst({
    where: { id: params.quoteId, companyId: params.request.user.companyId },
  });
  if (!quote) {
    throw notFound("QUOTE_NOT_FOUND", "Orçamento não encontrado.");
  }

  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "CONVERTIDO", convertedSaleId: params.saleId },
  });

  await audit(params.request, {
    action: "QUOTE_CONVERT",
    result: "SUCCESS",
    userId: params.request.user.sub,
    companyId: quote.companyId,
    storeId: quote.storeId,
    userRoleSnapshot: params.request.user.role,
    entityType: "Quote",
    entityId: quote.id,
    newData: { code: quote.code, saleId: params.saleId },
  });

  return updated;
}

/** Marca como vencido o que passou de `validUntil` — mesma abordagem da reserva. */
export async function expireOverdueQuotes(companyId: string): Promise<number> {
  const result = await prisma.quote.updateMany({
    where: { companyId, status: "ABERTO", validUntil: { lt: new Date() } },
    data: { status: "EXPIRADO" },
  });

  return result.count;
}
