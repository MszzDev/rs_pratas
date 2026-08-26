import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import {
  adjustStock,
  findStockAcrossStores,
  listMovements,
  listStock,
  registerEntry,
  setMinQuantity,
} from "./stock.service.js";
import {
  cancelTransfer,
  createTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  sendTransfer,
} from "./transfers.service.js";
import {
  closeInventory,
  getCountSheet,
  listInventories,
  openInventory,
  registerCount,
} from "./inventory.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const entrySchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  variationId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
  reason: z.string().min(3, "Diga de onde veio a mercadoria.").max(500),
  unitCost: z.number().min(0).optional(),
});

const adjustSchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  variationId: z.string().uuid().optional(),
  /** Saldo final contado, não a diferença — ver o comentário no serviço. */
  newQuantity: z.number().int().min(0),
  reason: z.string().min(5, "Descreva o que aconteceu.").max(500),
});

const createTransferSchema = z.object({
  fromStoreId: z.string().uuid(),
  toStoreId: z.string().uuid(),
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variationId: z.string().uuid().optional(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const receiveSchema = z.object({
  counted: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantityReceived: z.number().int().min(0),
      }),
    )
    .min(1),
});

export async function stockRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- saldos

  app.get(
    "/stock",
    { preHandler: [app.requireAuth, requirePermission("STOCK_VIEW")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          search: z.string().max(120).optional(),
          lowStockOnly: z.coerce.boolean().optional(),
        })
        .parse(request.query);

      return listStock({ request, ...query });
    },
  );

  /**
   * "Onde tem essa peça?"
   *
   * Consulta que atravessa as lojas da empresa de propósito — ver a
   * explicação em findStockAcrossStores. Só leitura, e só quantidade e nome
   * de loja.
   */
  app.get(
    "/stock/other-stores",
    { preHandler: [app.requireAuth, requirePermission("STOCK_VIEW")] },
    async (request) => {
      const query = z
        .object({
          search: z.string().min(2).max(120),
          exceptStoreId: z.string().uuid().optional(),
        })
        .parse(request.query);

      return findStockAcrossStores({ request, ...query });
    },
  );

  app.get(
    "/stock/:id/movements",
    { preHandler: [app.requireAuth, requirePermission("STOCK_VIEW")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { limit } = z.object({ limit: z.coerce.number().int().optional() }).parse(request.query);

      return listMovements({ stockItemId: id, request, limit });
    },
  );

  app.post(
    "/stock/entries",
    { preHandler: [app.requireAuth, requirePermission("STOCK_ADJUST")] },
    async (request, reply) => {
      const input = entrySchema.parse(request.body);
      return reply.status(201).send(await registerEntry({ input, request }));
    },
  );

  app.post(
    "/stock/adjustments",
    { preHandler: [app.requireAuth, requirePermission("STOCK_ADJUST")] },
    async (request, reply) => {
      const input = adjustSchema.parse(request.body);
      return reply.status(201).send(await adjustStock({ input, request }));
    },
  );

  app.patch(
    "/stock/:id/min-quantity",
    { preHandler: [app.requireAuth, requirePermission("STOCK_ADJUST")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { minQuantity } = z
        .object({ minQuantity: z.number().int().min(0).max(9999) })
        .parse(request.body);

      return setMinQuantity({ stockItemId: id, minQuantity, request });
    },
  );

  // -------------------------------------------------------- transferências

  app.get(
    "/stock/transfers",
    { preHandler: [app.requireAuth, requirePermission("STOCK_VIEW")] },
    async (request) => {
      const { storeId } = z.object({ storeId: z.string().uuid().optional() }).parse(request.query);
      return listTransfers({ request, storeId });
    },
  );

  app.get(
    "/stock/transfers/:id",
    { preHandler: [app.requireAuth, requirePermission("STOCK_VIEW")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getTransfer({ transferId: id, request });
    },
  );

  app.post(
    "/stock/transfers",
    { preHandler: [app.requireAuth, requirePermission("STOCK_TRANSFER")] },
    async (request, reply) => {
      const input = createTransferSchema.parse(request.body);
      return reply.status(201).send(await createTransfer({ input, request }));
    },
  );

  app.post(
    "/stock/transfers/:id/send",
    { preHandler: [app.requireAuth, requirePermission("STOCK_TRANSFER")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return sendTransfer({ transferId: id, request });
    },
  );

  app.post(
    "/stock/transfers/:id/receive",
    { preHandler: [app.requireAuth, requirePermission("STOCK_TRANSFER")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { counted } = receiveSchema.parse(request.body);
      return receiveTransfer({ transferId: id, counted, request });
    },
  );

  app.post(
    "/stock/transfers/:id/cancel",
    { preHandler: [app.requireAuth, requirePermission("STOCK_TRANSFER")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(3, "Informe o motivo.").max(500) })
        .parse(request.body);

      return cancelTransfer({ transferId: id, reason, request });
    },
  );

  // ------------------------------------------------------------ inventário

  app.get(
    "/stock/inventories",
    { preHandler: [app.requireAuth, requirePermission("STOCK_VIEW")] },
    async (request) => {
      const { storeId } = z.object({ storeId: z.string().uuid().optional() }).parse(request.query);
      return listInventories({ request, storeId });
    },
  );

  app.post(
    "/stock/inventories",
    { preHandler: [app.requireAuth, requirePermission("STOCK_INVENTORY")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          isBlind: z.boolean().optional(),
          notes: z.string().max(500).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await openInventory({ input, request }));
    },
  );

  app.get(
    "/stock/inventories/:id",
    { preHandler: [app.requireAuth, requirePermission("STOCK_INVENTORY")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getCountSheet({ inventoryId: id, request });
    },
  );

  app.post(
    "/stock/inventories/:id/counts",
    { preHandler: [app.requireAuth, requirePermission("STOCK_INVENTORY")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          productId: z.string().uuid(),
          variationId: z.string().uuid().optional(),
          countedQuantity: z.number().int().min(0),
        })
        .parse(request.body);

      return reply.status(201).send(await registerCount({ inventoryId: id, input, request }));
    },
  );

  app.post(
    "/stock/inventories/:id/close",
    { preHandler: [app.requireAuth, requirePermission("STOCK_INVENTORY")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return closeInventory({ inventoryId: id, request });
    },
  );
}
