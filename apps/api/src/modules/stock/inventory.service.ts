import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { applyMovement } from "./stock.service.js";

/**
 * Inventário cego.
 *
 * Quem conta não vê o saldo do sistema. Isso não é rigor decorativo: ver o
 * número esperado antes de contar enviesa a contagem — a tendência humana é
 * "achar" exatamente o que o sistema diz, e a diferença que deveria aparecer
 * some. Um inventário que sempre bate não prova que o estoque está certo,
 * prova que ninguém contou de verdade.
 */

async function nextInventoryCode(companyId: string): Promise<string> {
  const count = await prisma.inventory.count({ where: { companyId } });
  return `INV${String(count + 1).padStart(5, "0")}`;
}

export async function openInventory(params: {
  input: { storeId: string; isBlind?: boolean | undefined; notes?: string | undefined };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  // Abrir contagem aberta (não-cega) é decisão do dono e fica registrada.
  const isBlind = input.isBlind ?? true;
  if (!isBlind && request.user.role !== "DONO") {
    throw forbidden(
      "BLIND_INVENTORY_REQUIRED",
      "Só o dono pode abrir uma contagem com o saldo do sistema à vista.",
    );
  }

  const open = await prisma.inventory.findFirst({
    where: { storeId: input.storeId, status: { in: ["ABERTO", "CONTANDO"] } },
    select: { id: true, code: true },
  });
  if (open) {
    throw badRequest(
      "INVENTORY_ALREADY_OPEN",
      `A contagem ${open.code} ainda está aberta nesta loja. Feche antes de abrir outra.`,
    );
  }

  const inventory = await prisma.inventory.create({
    data: {
      companyId: request.user.companyId,
      storeId: input.storeId,
      code: await nextInventoryCode(request.user.companyId),
      isBlind,
      startedById: request.user.sub,
      notes: input.notes ?? null,
    },
  });

  await audit(request, {
    action: "INVENTORY_OPEN",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Inventory",
    entityId: inventory.id,
    newData: { code: inventory.code, isBlind },
    ...(isBlind ? {} : { reason: "contagem aberta autorizada pelo dono" }),
  });

  return inventory;
}

/**
 * Lista o que há para contar SEM revelar o saldo quando a contagem é cega.
 *
 * A omissão acontece aqui, no servidor. Mandar o número e confiar na tela para
 * escondê-lo seria inútil: quem quisesse veria pelo próprio navegador.
 */
export async function getCountSheet(params: { inventoryId: string; request: FastifyRequest }) {
  const inventory = await prisma.inventory.findFirst({
    where: { id: params.inventoryId, companyId: params.request.user.companyId },
  });
  if (!inventory) {
    throw notFound("INVENTORY_NOT_FOUND", "Contagem não encontrada.");
  }

  await assertStoreAccess(params.request, inventory.storeId);

  const items = await prisma.stockItem.findMany({
    // Peça fora do catálogo não entra na contagem: mandar alguém procurar na
    // gaveta um produto que a loja não vende mais é fazer a conferência
    // fechar errada por um item que não deveria estar na lista.
    where: { storeId: inventory.storeId, product: { deletedAt: null } },
    include: {
      product: { select: { sku: true, name: true } },
      variation: { select: { sku: true, size: true } },
    },
    orderBy: { product: { name: "asc" } },
  });

  const counts = await prisma.inventoryCount.findMany({
    where: { inventoryId: inventory.id },
  });

  const countedByKey = new Map(
    counts.map((count) => [`${count.productId}:${count.variationId ?? ""}`, count.countedQuantity]),
  );

  const revealSystemQuantity = !inventory.isBlind || inventory.status === "FECHADO";

  return {
    inventory: {
      id: inventory.id,
      code: inventory.code,
      status: inventory.status,
      isBlind: inventory.isBlind,
      storeId: inventory.storeId,
    },
    items: items.map((item) => ({
      productId: item.productId,
      variationId: item.variationId,
      sku: item.variation?.sku ?? item.product.sku,
      name: item.product.name,
      size: item.variation?.size ?? null,
      countedQuantity: countedByKey.get(`${item.productId}:${item.variationId ?? ""}`) ?? null,
      systemQuantity: revealSystemQuantity ? item.quantity : null,
    })),
  };
}

export async function registerCount(params: {
  inventoryId: string;
  input: { productId: string; variationId?: string | undefined; countedQuantity: number };
  request: FastifyRequest;
}) {
  const { inventoryId, input, request } = params;

  const inventory = await prisma.inventory.findFirst({
    where: { id: inventoryId, companyId: request.user.companyId },
  });
  if (!inventory) {
    throw notFound("INVENTORY_NOT_FOUND", "Contagem não encontrada.");
  }

  await assertStoreAccess(request, inventory.storeId);

  if (inventory.status === "FECHADO" || inventory.status === "CANCELADO") {
    throw badRequest("INVENTORY_CLOSED", "Esta contagem já foi encerrada.");
  }

  if (input.countedQuantity < 0) {
    throw badRequest("INVALID_COUNT", "A quantidade contada não pode ser negativa.");
  }

  // Recontar sobrescreve: enquanto a contagem está aberta, o último número
  // dito pelo contador é o que vale. O que não se apaga é a contagem fechada.
  //
  // findFirst + update/create em vez de `upsert` porque `variationId` é nulo em
  // produto sem tamanho, e o Prisma não aceita nulo dentro de chave composta.
  const where = {
    inventoryId: inventory.id,
    productId: input.productId,
    variationId: input.variationId ?? null,
  };

  const existing = await prisma.inventoryCount.findFirst({ where });

  const count = existing
    ? await prisma.inventoryCount.update({
        where: { id: existing.id },
        data: { countedQuantity: input.countedQuantity, countedById: request.user.sub },
      })
    : await prisma.inventoryCount.create({
        data: { ...where, countedQuantity: input.countedQuantity, countedById: request.user.sub },
      });

  if (inventory.status === "ABERTO") {
    await prisma.inventory.update({
      where: { id: inventory.id },
      data: { status: "CONTANDO" },
    });
  }

  return count;
}

/**
 * Fecha a contagem e ajusta o estoque para o que foi contado.
 *
 * Cada diferença vira um movimento de INVENTARIO com o motivo — não um "acerto"
 * silencioso. Peça que sumiu precisa aparecer no histórico como sumida, senão o
 * inventário serve para esconder perda em vez de revelá-la.
 */
export async function closeInventory(params: {
  inventoryId: string;
  request: FastifyRequest;
}) {
  const { inventoryId, request } = params;

  const inventory = await prisma.inventory.findFirst({
    where: { id: inventoryId, companyId: request.user.companyId },
    include: { counts: true },
  });
  if (!inventory) {
    throw notFound("INVENTORY_NOT_FOUND", "Contagem não encontrada.");
  }

  await assertStoreAccess(request, inventory.storeId);

  if (inventory.status === "FECHADO") {
    throw badRequest("INVENTORY_CLOSED", "Esta contagem já foi encerrada.");
  }
  if (inventory.counts.length === 0) {
    throw badRequest("NOTHING_COUNTED", "Nenhuma peça foi contada ainda.");
  }

  // Quem conta não fecha. São duas responsabilidades diferentes: contar sozinho
  // e homologar a própria contagem permitiria acobertar a peça que levou.
  const soleCounter =
    inventory.counts.every((count) => count.countedById === request.user.sub) &&
    request.user.role !== "DONO";
  if (soleCounter) {
    throw forbidden(
      "COUNTER_CANNOT_CLOSE",
      "Quem contou não encerra a própria contagem. Peça ao responsável da loja.",
    );
  }

  const divergences: Array<{
    productId: string;
    variationId: string | null;
    sistema: number;
    contado: number;
    diferenca: number;
  }> = [];

  await prisma.$transaction(async (tx) => {
    for (const count of inventory.counts) {
      const item = await tx.stockItem.findFirst({
        where: {
          storeId: inventory.storeId,
          productId: count.productId,
          variationId: count.variationId,
        },
      });

      const systemQuantity = item?.quantity ?? 0;
      const difference = count.countedQuantity - systemQuantity;

      // Congela o saldo do sistema na linha da contagem: depois do ajuste o
      // número original não existiria mais em lugar nenhum.
      await tx.inventoryCount.update({
        where: { id: count.id },
        data: { systemQuantity },
      });

      if (difference === 0) continue;

      divergences.push({
        productId: count.productId,
        variationId: count.variationId,
        sistema: systemQuantity,
        contado: count.countedQuantity,
        diferenca: difference,
      });

      await applyMovement(tx, {
        companyId: inventory.companyId,
        storeId: inventory.storeId,
        productId: count.productId,
        variationId: count.variationId,
        // Diferença positiva entra como INVENTARIO; negativa sai como PERDA,
        // que é o nome honesto do que aconteceu.
        type: difference > 0 ? "INVENTARIO" : "PERDA",
        quantity: Math.abs(difference),
        userId: request.user.sub,
        reason: `inventário ${inventory.code}`,
        referenceType: "Inventory",
        referenceId: inventory.id,
      });
    }

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { status: "FECHADO", closedAt: new Date(), closedById: request.user.sub },
    });
  });

  await audit(request, {
    action: "INVENTORY_CLOSE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: inventory.companyId,
    storeId: inventory.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Inventory",
    entityId: inventory.id,
    newData: { code: inventory.code, itensContados: inventory.counts.length },
    metadata: { divergencias: divergences },
  });

  return { inventoryId: inventory.id, divergencias: divergences };
}

export async function listInventories(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
}) {
  const { request, storeId } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  return prisma.inventory.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: { store: { select: { name: true } }, _count: { select: { counts: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
