import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { requireRole } from "../../core/rbac/require-role.hook.js";
import { closeStore, getNetworkStatus, openStore } from "./store-opening.service.js";
import {
  removeCashRegister,
  removeCategory,
  removeCommissionRule,
  removeCustomer,
  removeGoal,
  removeLabelTemplate,
  removePOSStation,
  removeProduct,
  removeStore,
  removeSizeGrade,
  removeTerminal,
  removeVariation,
} from "./removals.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

/**
 * O motivo é obrigatório em toda remoção.
 *
 * Não é burocracia: seis meses depois, "quem apagou" sem "por quê" não
 * responde nada. O campo é o que transforma o registro de auditoria em
 * explicação.
 */
const reasonSchema = z.object({
  reason: z.string().min(3, "Diga por que está removendo.").max(500),
});

export async function storeOperationRoutes(app: FastifyInstance) {
  // ------------------------------------------------- abertura e fechamento

  /** Painel do dono: como está cada loja da rede agora. */
  app.get(
    "/stores/network-status",
    { preHandler: [app.requireAuth, requirePermission("STORE_VIEW")] },
    async (request) => getNetworkStatus(request),
  );

  app.post(
    "/stores/:id/open",
    { preHandler: [app.requireAuth, requirePermission("STORE_VIEW")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().max(500).optional() })
        .parse(request.body ?? {});

      return openStore({ storeId: id, reason, request });
    },
  );

  app.post(
    "/stores/:id/close",
    { preHandler: [app.requireAuth, requirePermission("STORE_VIEW")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().max(500).optional() })
        .parse(request.body ?? {});

      return closeStore({ storeId: id, reason, request });
    },
  );

  // ------------------------------------------------------------- remoções

  app.delete(
    "/categories/:id",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeCategory({ categoryId: id, reason, request });
    },
  );

  /**
   * Remover uma peca do catalogo.
   *
   * Peca ja vendida sai do catalogo mas continua no historico: o item da venda
   * aponta para ela, e apagar deixaria garantia, troca e margem apontando para
   * o nada.
   */
  app.delete(
    "/products/:id",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeProduct({ productId: id, reason, request });
    },
  );

  app.delete(
    "/size-grades/:id",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeSizeGrade({ gradeId: id, reason, request });
    },
  );

  app.delete(
    "/product-variations/:id",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeVariation({ variationId: id, reason, request });
    },
  );

  app.delete(
    "/customers/:id",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeCustomer({ customerId: id, reason, request });
    },
  );

  app.delete(
    "/terminals/:id",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_DISABLE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeTerminal({ terminalId: id, reason, request });
    },
  );

  app.delete(
    "/label-templates/:id",
    { preHandler: [app.requireAuth, requirePermission("LABEL_TEMPLATE_MANAGE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeLabelTemplate({ templateId: id, reason, request });
    },
  );

  app.delete(
    "/commission-rules/:id",
    { preHandler: [app.requireAuth, requirePermission("COMMISSION_MANAGE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeCommissionRule({ ruleId: id, reason, request });
    },
  );

  app.delete(
    "/goals/:id",
    { preHandler: [app.requireAuth, requirePermission("GOAL_MANAGE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeGoal({ goalId: id, reason, request });
    },
  );

  /** Estação e caixa são estrutura da loja: só o dono desmonta. */
  app.delete(
    "/pos-stations/:id",
    { preHandler: [app.requireAuth, requireRole("DONO")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removePOSStation({ stationId: id, reason, request });
    },
  );

  app.delete(
    "/cash-registers/:id",
    { preHandler: [app.requireAuth, requireRole("DONO")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeCashRegister({ registerId: id, reason, request });
    },
  );

  /**
   * Remover a loja.
   *
   * Loja que ja vendeu, teve caixa ou registrou ponto e DESATIVADA — apagar
   * levaria junto o faturamento, o espelho de ponto de quem trabalhou ali e a
   * garantia de quem comprou. Loja criada por engano, que nunca operou, some
   * de vez com a estrutura vazia junto.
   */
  app.delete(
    "/stores/:id",
    { preHandler: [app.requireAuth, requireRole("DONO")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = reasonSchema.parse(request.body);
      return removeStore({ storeId: id, reason, request });
    },
  );
}
