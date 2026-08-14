import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import {
  createCustomer,
  findOrCreateByPhone,
  getCustomer,
  listCustomers,
  updateCustomer,
} from "./customers.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const customerBodySchema = z.object({
  name: z.string().min(2, "Informe o nome do cliente.").max(120),
  phone: z.string().min(10, "Informe o telefone com DDD.").max(20),
  cpf: z.string().max(20).optional(),
  email: z.string().email().max(160).optional(),
  birthDate: z.string().datetime().optional(),
  ringSize: z.string().max(10).optional(),
  notes: z.string().max(1000).optional(),
});

export async function customerRoutes(app: FastifyInstance) {
  app.get(
    "/customers",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_CREATE")] },
    async (request) => {
      const { search } = z.object({ search: z.string().max(120).optional() }).parse(request.query);
      return listCustomers({ request, search });
    },
  );

  app.get(
    "/customers/:id",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getCustomer({ customerId: id, request });
    },
  );

  app.post(
    "/customers",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_CREATE")] },
    async (request, reply) => {
      const input = customerBodySchema.parse(request.body);
      return reply.status(201).send(await createCustomer({ input, request }));
    },
  );

  app.patch(
    "/customers/:id",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = customerBodySchema.partial().parse(request.body);
      return updateCustomer({ customerId: id, input, request });
    },
  );

  /**
   * Caminho do balcão: o vendedor digita telefone e nome na aba de venda.
   * Se o cliente já existe, devolve o cadastro dele — histórico espalhado em
   * dois cadastros não é histórico de ninguém.
   */
  app.post(
    "/customers/quick",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({
          name: z.string().min(2).max(120),
          phone: z.string().min(10).max(20),
        })
        .parse(request.body);

      return reply.status(201).send(await findOrCreateByPhone({ ...input, request }));
    },
  );
}
