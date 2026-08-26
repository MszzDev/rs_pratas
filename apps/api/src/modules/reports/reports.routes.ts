import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { getMyDay } from "./my-day.service.js";
import {
  cashDifferences,
  paymentBreakdown,
  salesBySeller,
  salesByStore,
  salesSummary,
  salesTrend,
  topProducts,
} from "./reports.service.js";
import {
  calculateCommissions,
  createCommissionRule,
  createGoal,
  listCommissionRules,
  listGoalsWithProgress,
} from "./commissions.service.js";

const rangeSchema = z.object({
  storeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function reportRoutes(app: FastifyInstance) {
  const canView = [app.requireAuth, requirePermission("REPORT_VIEW_STORE")];

  app.get("/reports/sales-summary", { preHandler: canView }, async (request) => {
    const query = rangeSchema.parse(request.query);
    return salesSummary({ request, ...query });
  });

  app.get("/reports/sales-trend", { preHandler: canView }, async (request) => {
    const query = z
      .object({
        storeId: z.string().uuid().optional(),
        days: z.coerce.number().int().optional(),
      })
      .parse(request.query);

    return salesTrend({ request, ...query });
  });

  app.get("/reports/sales-by-store", { preHandler: canView }, async (request) => {
    const query = z
      .object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() })
      .parse(request.query);

    return salesByStore({ request, ...query });
  });

  app.get("/reports/sales-by-seller", { preHandler: canView }, async (request) => {
    const query = rangeSchema.parse(request.query);
    return salesBySeller({ request, ...query });
  });

  app.get("/reports/top-products", { preHandler: canView }, async (request) => {
    const query = rangeSchema.extend({ limit: z.coerce.number().int().optional() }).parse(
      request.query,
    );
    return topProducts({ request, ...query });
  });

  app.get("/reports/payments", { preHandler: canView }, async (request) => {
    const query = rangeSchema.parse(request.query);
    return paymentBreakdown({ request, ...query });
  });

  /**
   * Diferenças de caixa. Fica sob a permissão de fechamento e não sob a de
   * relatório comum: é o resultado da conferência cega, e quem opera o caixa
   * não deveria poder estudar o padrão das próprias diferenças.
   */
  app.get(
    "/reports/cash-differences",
    { preHandler: [app.requireAuth, requirePermission("CASH_CLOSE")] },
    async (request) => {
      const query = rangeSchema.parse(request.query);
      return cashDifferences({ request, ...query });
    },
  );

  // ------------------------------------------------------------ comissões

  app.get(
    "/commission-rules",
    { preHandler: [app.requireAuth, requirePermission("COMMISSION_MANAGE")] },
    async (request) => listCommissionRules(request),
  );

  app.post(
    "/commission-rules",
    { preHandler: [app.requireAuth, requirePermission("COMMISSION_MANAGE")] },
    async (request, reply) => {
      const input = z
        .object({
          name: z.string().min(2).max(80),
          percent: z.number().min(0).max(100),
          basis: z.enum(["FATURAMENTO", "MARGEM"]).optional(),
          storeId: z.string().uuid().optional(),
          userId: z.string().uuid().optional(),
          minimumSalesAmount: z.number().min(0).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await createCommissionRule({ input, request }));
    },
  );

  app.get(
    "/commissions",
    { preHandler: [app.requireAuth, requirePermission("COMMISSION_VIEW")] },
    async (request) => {
      const query = z
        .object({
          from: z.string().datetime(),
          to: z.string().datetime(),
          storeId: z.string().uuid().optional(),
        })
        .parse(request.query);

      return calculateCommissions({ request, ...query });
    },
  );

  /**
   * O dia da própria vendedora.
   *
   * Sem requirePermission de propósito: a permissão aqui é ser você mesma. O
   * serviço não aceita userId — o dono da sessão é quem o token diz, e é só o
   * número dele que sai. Exigir REPORT_VIEW_STORE deixaria de fora justamente
   * quem esta tela existe para atender.
   */
  app.get("/reports/my-day", { preHandler: app.requireAuth }, async (request) => {
    const { storeId } = z.object({ storeId: z.string().uuid() }).parse(request.query);
    await assertStoreAccess(request, storeId);

    return getMyDay({ request, storeId });
  });

  // ---------------------------------------------------------------- metas

  app.get(
    "/goals",
    { preHandler: [app.requireAuth, requirePermission("REPORT_VIEW_STORE")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          activeOnly: z.coerce.boolean().optional(),
        })
        .parse(request.query);

      return listGoalsWithProgress({ request, ...query });
    },
  );

  app.post(
    "/goals",
    { preHandler: [app.requireAuth, requirePermission("GOAL_MANAGE")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          scope: z.enum(["LOJA", "VENDEDOR"]),
          userId: z.string().uuid().optional(),
          period: z.enum(["DIARIA", "SEMANAL", "MENSAL"]),
          periodStart: z.string().datetime(),
          periodEnd: z.string().datetime(),
          targetAmount: z.number().positive().max(99_999_999),
          notes: z.string().max(500).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await createGoal({ input, request }));
    },
  );
}
