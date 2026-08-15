import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { createReturn, getReturnableItems, listReturns } from "./returns.service.js";
import {
  decideClaim,
  findCertificate,
  findWarranty,
  issueCertificate,
  issueWarranty,
  openClaim,
  reissueCertificate,
} from "./warranties.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

export async function afterSalesRoutes(app: FastifyInstance) {
  // ------------------------------------------------- trocas e devoluções

  app.get(
    "/returns",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          saleId: z.string().uuid().optional(),
        })
        .parse(request.query);

      return listReturns({ request, ...query });
    },
  );

  /** O que ainda pode ser devolvido de uma venda — a tela pergunta antes. */
  app.get(
    "/sales/:id/returnable",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getReturnableItems({ saleId: id, request });
    },
  );

  app.post(
    "/returns",
    { preHandler: [app.requireAuth, requirePermission("SALE_REFUND")] },
    async (request, reply) => {
      const input = z
        .object({
          originalSaleId: z.string().uuid(),
          sessionId: z.string().uuid(),
          type: z.enum(["DEVOLUCAO", "TROCA"]),
          reason: z.string().min(5, "Descreva o motivo da devolução.").max(500),
          items: z
            .array(
              z.object({
                saleItemId: z.string().uuid(),
                quantity: z.number().int().positive(),
                returnedToStock: z.boolean().optional(),
                condition: z.string().max(200).optional(),
              }),
            )
            .min(1),
          authorizedById: z.string().uuid().optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await createReturn({ input, request }));
    },
  );

  // ------------------------------------------------------------ garantias

  app.get(
    "/warranties/:code",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { code } = z.object({ code: z.string().max(30) }).parse(request.params);
      return findWarranty({ code, request });
    },
  );

  app.post(
    "/warranties",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({
          saleItemId: z.string().uuid(),
          months: z.number().int().min(1).max(120),
          terms: z.string().max(4000).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await issueWarranty({ input, request }));
    },
  );

  app.post(
    "/warranties/:id/claims",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const { description } = z
        .object({ description: z.string().min(5, "Descreva o defeito.").max(1000) })
        .parse(request.body);

      return reply
        .status(201)
        .send(await openClaim({ input: { warrantyId: id, description }, request }));
    },
  );

  /** Decidir se o defeito estava coberto é do responsável, não do vendedor. */
  app.post(
    "/warranty-claims/:id/decide",
    { preHandler: [app.requireAuth, requirePermission("SALE_REFUND")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          approved: z.boolean(),
          reason: z.string().min(5, "Explique a decisão.").max(500),
        })
        .parse(request.body);

      return decideClaim({ claimId: id, ...input, request });
    },
  );

  // --------------------------------------------------------- certificados

  app.get(
    "/certificates/:code",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { code } = z.object({ code: z.string().max(30) }).parse(request.params);
      return findCertificate({ code, request });
    },
  );

  app.post(
    "/certificates",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({
          saleItemId: z.string().uuid(),
          details: z.string().max(1000).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await issueCertificate({ input, request }));
    },
  );

  app.post(
    "/certificates/:id/reissue",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return reissueCertificate({ certificateId: id, request });
    },
  );
}
