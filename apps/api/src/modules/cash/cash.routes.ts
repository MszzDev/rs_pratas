import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import {
  closeSession,
  getOpenSessionForRegister,
  getSession,
  getSessionForClosing,
  listOverdueSessions,
  listSessions,
  openSession,
  registerSupply,
  registerWithdrawal,
} from "./cash.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const moneySchema = z.number().min(0).max(9_999_999).multipleOf(0.01);

export async function cashRoutes(app: FastifyInstance) {
  app.get(
    "/cash/sessions",
    { preHandler: [app.requireAuth, requirePermission("CASH_OPEN")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          status: z.enum(["ABERTO", "FECHADO"]).optional(),
        })
        .parse(request.query);

      return listSessions({ request, ...query });
    },
  );

  /**
   * Caixas que passaram do dia sem fechar. O painel mostra isso em destaque:
   * o fechamento é diário, e um turno de ontem ainda aberto significa que o
   * dinheiro de dois dias está na mesma gaveta.
   */
  app.get(
    "/cash/sessions/overdue",
    { preHandler: [app.requireAuth, requirePermission("CASH_CLOSE")] },
    async (request) => listOverdueSessions(request),
  );

  /** Chamado pelo PDV antes de vender: existe turno aberto neste caixa? */
  app.get(
    "/cash/registers/:id/open-session",
    { preHandler: [app.requireAuth, requirePermission("CASH_OPEN")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getOpenSessionForRegister({ cashRegisterId: id, request });
    },
  );

  app.get(
    "/cash/sessions/:id",
    { preHandler: [app.requireAuth, requirePermission("CASH_OPEN")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getSession({ sessionId: id, request });
    },
  );

  /**
   * Tela de fechamento. Devolve de propósito o mínimo: quem vai contar a
   * gaveta não pode ver quanto o sistema espera encontrar nela.
   */
  app.get(
    "/cash/sessions/:id/closing",
    { preHandler: [app.requireAuth, requirePermission("CASH_CLOSE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getSessionForClosing({ sessionId: id, request });
    },
  );

  app.post(
    "/cash/sessions",
    { preHandler: [app.requireAuth, requirePermission("CASH_OPEN")] },
    async (request, reply) => {
      const input = z
        .object({
          cashRegisterId: z.string().uuid(),
          openingAmount: moneySchema,
          notes: z.string().max(500).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await openSession({ input, request }));
    },
  );

  app.post(
    "/cash/sessions/:id/withdrawal",
    { preHandler: [app.requireAuth, requirePermission("CASH_WITHDRAW")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          amount: moneySchema,
          reason: z.string().min(3, "Diga para onde vai o dinheiro.").max(500),
        })
        .parse(request.body);

      return reply
        .status(201)
        .send(await registerWithdrawal({ sessionId: id, ...input, request }));
    },
  );

  app.post(
    "/cash/sessions/:id/supply",
    { preHandler: [app.requireAuth, requirePermission("CASH_SUPPLY")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          amount: moneySchema,
          reason: z.string().min(3, "Diga de onde veio o dinheiro.").max(500),
        })
        .parse(request.body);

      return reply.status(201).send(await registerSupply({ sessionId: id, ...input, request }));
    },
  );

  app.post(
    "/cash/sessions/:id/close",
    { preHandler: [app.requireAuth, requirePermission("CASH_CLOSE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          countedAmount: moneySchema,
          differenceReason: z.string().max(500).optional(),
        })
        .parse(request.body);

      return closeSession({ sessionId: id, ...input, request });
    },
  );
}
