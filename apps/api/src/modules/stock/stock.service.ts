import type { Prisma, StockMovementType } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/** Movimentos que somam ao saldo. Os demais subtraem. */
const INBOUND: StockMovementType[] = [
  "ENTRADA",
  "TRANSFERENCIA_ENTRADA",
  "DEVOLUCAO",
];

/**
 * Encontra o saldo do item na loja, criando a linha zerada se for a primeira vez.
 *
 * Não usa `upsert` porque `variationId` é nulo em produto sem tamanho, e o
 * Prisma não aceita nulo dentro de uma chave composta. A corrida entre duas
 * primeiras entradas simultâneas é resolvida pelo banco: os dois índices
 * únicos (o composto e o parcial para variação nula) fazem a segunda falhar
 * com P2002, e aí basta reler a linha que a outra acabou de criar.
 */
async function findOrCreateStockItem(
  tx: Prisma.TransactionClient,
  params: { companyId: string; storeId: string; productId: string; variationId: string | null },
) {
  const where = {
    storeId: params.storeId,
    productId: params.productId,
    variationId: params.variationId,
  };

  const existing = await tx.stockItem.findFirst({ where });
  if (existing) return existing;

  try {
    return await tx.stockItem.create({ data: { companyId: params.companyId, ...where } });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    return tx.stockItem.findFirstOrThrow({ where });
  }
}

/**
 * Aplica um movimento e atualiza o saldo na MESMA transação.
 *
 * As duas escritas são inseparáveis: gravar o movimento sem mexer no saldo
 * deixa o estoque mentindo, e mexer no saldo sem gravar o movimento apaga a
 * explicação de por que ele mudou. Por isso esta função é o único caminho —
 * nenhum outro lugar do sistema escreve em `stock_items` diretamente.
 *
 * Recebe `tx` para poder participar de uma transação maior (uma venda move
 * vários itens, e ou move todos ou nenhum).
 */
export async function applyMovement(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    storeId: string;
    productId: string;
    variationId?: string | null;
    type: StockMovementType;
    /** Sempre positivo — o sinal sai do `type`, não de quem chama. */
    quantity: number;
    userId?: string | undefined;
    reason?: string | undefined;
    unitCost?: Prisma.Decimal | number | undefined;
    referenceType?: string | undefined;
    referenceId?: string | undefined;
    transferId?: string | undefined;
  },
) {
  if (params.quantity <= 0) {
    throw badRequest("INVALID_QUANTITY", "A quantidade precisa ser maior que zero.");
  }

  const variationId = params.variationId ?? null;

  const item = await findOrCreateStockItem(tx, {
    companyId: params.companyId,
    storeId: params.storeId,
    productId: params.productId,
    variationId,
  });

  const delta = INBOUND.includes(params.type) ? params.quantity : -params.quantity;
  const quantityAfter = item.quantity + delta;

  if (quantityAfter < 0) {
    throw conflict(
      "INSUFFICIENT_STOCK",
      `Só há ${item.quantity} em estoque nesta loja. Confira a peça ou faça a transferência antes.`,
    );
  }

  // Saída não pode comer o que está reservado para um cliente: a peça já tem
  // dono, ainda que não tenha saído da loja.
  if (delta < 0 && quantityAfter < item.reservedQuantity) {
    throw conflict(
      "RESERVED_STOCK",
      `Há ${item.reservedQuantity} peça(s) reservada(s) para cliente. Cancele a reserva antes.`,
    );
  }

  const updated = await tx.stockItem.update({
    where: { id: item.id },
    data: { quantity: quantityAfter },
  });

  await tx.stockMovement.create({
    data: {
      companyId: params.companyId,
      storeId: params.storeId,
      stockItemId: item.id,
      type: params.type,
      quantity: delta,
      quantityBefore: item.quantity,
      quantityAfter,
      unitCost: params.unitCost ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      reason: params.reason ?? null,
      userId: params.userId ?? null,
      transferId: params.transferId ?? null,
    },
  });

  return updated;
}

/**
 * Entrada de mercadoria — compra do fornecedor, acerto de sobra.
 * Exige motivo: entrada sem origem declarada é como peça aparece do nada.
 */
export async function registerEntry(params: {
  input: {
    storeId: string;
    productId: string;
    variationId?: string | undefined;
    quantity: number;
    reason: string;
    unitCost?: number | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);
  await assertProductBelongsToCompany(input.productId, request.user.companyId, input.variationId);

  const item = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      companyId: request.user.companyId,
      storeId: input.storeId,
      productId: input.productId,
      variationId: input.variationId ?? null,
      type: "ENTRADA",
      quantity: input.quantity,
      userId: request.user.sub,
      reason: input.reason,
      unitCost: input.unitCost,
    }),
  );

  await audit(request, {
    action: "STOCK_MOVEMENT",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "StockItem",
    entityId: item.id,
    newData: { type: "ENTRADA", quantity: input.quantity, saldo: item.quantity },
    reason: input.reason,
  });

  return item;
}

/**
 * Ajuste de saldo — quebra, perda, correção de contagem.
 *
 * Recebe o saldo FINAL desejado, não a diferença. Quem ajusta contou a
 * gaveta e sabe quantas peças existem; obrigá-lo a calcular a diferença é
 * convite a erro de sinal, e erro de sinal aqui some com peça.
 */
export async function adjustStock(params: {
  input: {
    storeId: string;
    productId: string;
    variationId?: string | undefined;
    newQuantity: number;
    reason: string;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);
  await assertProductBelongsToCompany(input.productId, request.user.companyId, input.variationId);

  const current = await prisma.stockItem.findFirst({
    where: {
      storeId: input.storeId,
      productId: input.productId,
      variationId: input.variationId ?? null,
    },
  });

  const before = current?.quantity ?? 0;
  const difference = input.newQuantity - before;

  if (difference === 0) {
    throw badRequest(
      "NO_CHANGE",
      "O saldo informado é o mesmo que já está no sistema. Nada a ajustar.",
    );
  }

  const item = await prisma.$transaction((tx) =>
    applyMovement(tx, {
      companyId: request.user.companyId,
      storeId: input.storeId,
      productId: input.productId,
      variationId: input.variationId ?? null,
      type: difference > 0 ? "AJUSTE" : "PERDA",
      quantity: Math.abs(difference),
      userId: request.user.sub,
      reason: input.reason,
    }),
  );

  await audit(request, {
    action: "STOCK_ADJUST",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "StockItem",
    entityId: item.id,
    previousData: { quantity: before },
    newData: { quantity: item.quantity },
    reason: input.reason,
  });

  return item;
}

export async function listStock(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  search?: string | undefined;
  lowStockOnly?: boolean | undefined;
}) {
  const { request, storeId, search, lowStockOnly } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const items = await prisma.stockItem.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
      ...(search
        ? {
            product: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { sku: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      product: { select: { sku: true, name: true, salePrice: true, imageChecksum: true, imageExternalUrl: true } },
      variation: { select: { sku: true, size: true } },
      store: { select: { name: true } },
    },
    orderBy: [{ store: { name: "asc" } }, { product: { name: "asc" } }],
    take: 500,
  });

  // Filtro de estoque baixo fica aqui e não no banco porque compara duas
  // colunas da mesma linha, o que o Prisma ainda não expressa em `where`.
  const filtered = lowStockOnly
    ? items.filter((item) => item.minQuantity > 0 && item.quantity <= item.minQuantity)
    : items;

  return filtered.map((item) => ({
    id: item.id,
    storeId: item.storeId,
    storeName: item.store.name,
    productId: item.productId,
    variationId: item.variationId,
    sku: item.variation?.sku ?? item.product.sku,
    name: item.product.name,
    size: item.variation?.size ?? null,
    quantity: item.quantity,
    reservedQuantity: item.reservedQuantity,
    /** O que o vendedor pode de fato vender agora. */
    availableQuantity: item.quantity - item.reservedQuantity,
    minQuantity: item.minQuantity,
    lowStock: item.minQuantity > 0 && item.quantity <= item.minQuantity,
    salePrice: item.product.salePrice,
    /** Nulo = sem foto. O valor serve de chave de cache na tela. */
    imageChecksum: item.product.imageChecksum,
    imageExternalUrl: item.product.imageExternalUrl,
  }));
}

/** Histórico de um item — a explicação de por que o saldo é o que é. */
export async function listMovements(params: {
  stockItemId: string;
  request: FastifyRequest;
  limit?: number | undefined;
}) {
  const { stockItemId, request, limit } = params;

  const item = await prisma.stockItem.findFirst({
    where: { id: stockItemId, companyId: request.user.companyId },
  });
  if (!item) {
    throw notFound("STOCK_ITEM_NOT_FOUND", "Item de estoque não encontrado.");
  }

  await assertStoreAccess(request, item.storeId);

  return prisma.stockMovement.findMany({
    where: { stockItemId },
    include: { user: { select: { name: true, employeeCode: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit ?? 100, 200),
  });
}

export async function setMinQuantity(params: {
  stockItemId: string;
  minQuantity: number;
  request: FastifyRequest;
}) {
  const { stockItemId, minQuantity, request } = params;

  const item = await prisma.stockItem.findFirst({
    where: { id: stockItemId, companyId: request.user.companyId },
  });
  if (!item) {
    throw notFound("STOCK_ITEM_NOT_FOUND", "Item de estoque não encontrado.");
  }

  await assertStoreAccess(request, item.storeId);

  return prisma.stockItem.update({
    where: { id: item.id },
    data: { minQuantity },
  });
}

/**
 * Barra produto de outra empresa antes de qualquer escrita.
 *
 * Sem isso, um id de produto vazado permitiria mexer no estoque de outra
 * empresa — o `storeId` é checado, mas nada ligaria os dois.
 */
export async function assertProductBelongsToCompany(
  productId: string,
  companyId: string,
  variationId?: string | null,
): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: productId, companyId, deletedAt: null },
    select: { id: true, hasVariations: true },
  });

  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }

  if (product.hasVariations && !variationId) {
    throw badRequest(
      "VARIATION_REQUIRED",
      "Este produto tem tamanhos. Escolha qual deles está entrando ou saindo.",
    );
  }

  if (variationId) {
    const variation = await prisma.productVariation.findFirst({
      where: { id: variationId, productId, deletedAt: null },
      select: { id: true },
    });
    if (!variation) {
      throw notFound("VARIATION_NOT_FOUND", "Variação não encontrada para este produto.");
    }
  }
}
