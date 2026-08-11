import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { StepUpPurpose } from "@prisma/client";
import {
  blockUserSchema,
  changeUserRoleSchema,
  createUserSchema,
  updateUserSchema,
} from "@rs-pratas/shared";
import { requireRole } from "../../core/rbac/require-role.hook.js";
import { requireStepUp } from "../auth/step-up.service.js";
import { createEmailProvider } from "../../core/email/index.js";
import {
  changeUserRole,
  createUser,
  listUsers,
  resendWelcomeEmail,
  setUserBlocked,
  updateUser,
} from "./users.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

export async function userRoutes(app: FastifyInstance) {
  const emailProvider = createEmailProvider(app.log);
  const ownerOnly = [app.requireAuth, requireRole("DONO")];

  app.get("/users", { preHandler: app.requireAuth }, async (request) => {
    return listUsers(request);
  });

  app.post("/users", { preHandler: ownerOnly }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const result = await createUser({ input, request, emailProvider });
    return reply.status(201).send(result);
  });

  app.post("/users/:id/resend-credentials", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return resendWelcomeEmail({ userId: id, request, emailProvider });
  });

  app.patch("/users/:id", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const input = updateUserSchema.parse(request.body);
    return updateUser({ userId: id, input, request });
  });

  /**
   * Mudar perfil exige reautenticação: promover alguém a dono entrega acesso a
   * custo, lucro e credenciais de integração, e é exatamente o que alguém faria
   * com uma sessão de dono deixada aberta no balcão.
   */
  app.patch(
    "/users/:id/role",
    { preHandler: [...ownerOnly, requireStepUp(StepUpPurpose.CREATE_OR_PROMOTE_OWNER)] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = changeUserRoleSchema.parse(request.body);
      return changeUserRole({ userId: id, input, request });
    },
  );

  app.post("/users/:id/block", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { reason } = blockUserSchema.parse(request.body);
    return setUserBlocked({ userId: id, blocked: true, reason, request });
  });

  app.post("/users/:id/unblock", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { reason } = blockUserSchema.parse(request.body);
    return setUserBlocked({ userId: id, blocked: false, reason, request });
  });
}
