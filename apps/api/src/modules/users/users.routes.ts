import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { StepUpPurpose } from "@prisma/client";
import {
  blockUserSchema,
  changeUserRoleSchema,
  createUserSchema,
  grantPermissionSchema,
  revokePermissionSchema,
  updateUserSchema,
  type PermissionCode,
} from "@rs-pratas/shared";
import { requireRole } from "../../core/rbac/require-role.hook.js";
import { requireStepUp } from "../auth/step-up.service.js";
import {
  changeUserRole,
  createUser,
  listUsers,
  regenerateTemporaryPassword,
  setUserBlocked,
  updateUser,
} from "./users.service.js";
import { removeUser } from "../stores/removals.service.js";
import {
  grantPermission,
  listUserPermissions,
  revokePermission,
} from "./permissions.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

export async function userRoutes(app: FastifyInstance) {
  const ownerOnly = [app.requireAuth, requireRole("DONO")];

  app.get("/users", { preHandler: app.requireAuth }, async (request) => {
    return listUsers(request);
  });

  app.post("/users", { preHandler: ownerOnly }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const result = await createUser({ input, request });
    return reply.status(201).send(result);
  });

  /**
   * Gera uma senha temporária nova e a devolve na resposta. Sem e-mail no
   * sistema, é assim que o dono recupera o acesso de quem perdeu o papel com a
   * credencial — e a senha anterior deixa de valer no mesmo instante.
   */
  app.post("/users/:id/regenerate-password", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return regenerateTemporaryPassword({ userId: id, request });
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

  app.get("/users/:id/permissions", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return listUserPermissions({ userId: id, request });
  });

  /**
   * Conceder ou revogar permissão exige reautenticação: é por aqui que se
   * libera um funcionário a entrar fora do tablet da loja, e a especificação
   * trata alteração de permissão como ação sensível.
   */
  app.post(
    "/users/:id/permissions",
    { preHandler: [...ownerOnly, requireStepUp(StepUpPurpose.CHANGE_PERMISSIONS)] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const input = grantPermissionSchema.parse(request.body);

      const granted = await grantPermission({
        userId: id,
        code: input.code as PermissionCode,
        effect: input.effect,
        reason: input.reason,
        request,
        ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
      });

      return reply.status(201).send({ id: granted.id, code: input.code, effect: granted.effect });
    },
  );

  app.delete(
    "/users/:id/permissions/:code",
    { preHandler: [...ownerOnly, requireStepUp(StepUpPurpose.CHANGE_PERMISSIONS)] },
    async (request, reply) => {
      const { id, code } = z
        .object({ id: z.string().uuid(), code: z.string().min(1).max(60) })
        .parse(request.params);
      const { reason } = revokePermissionSchema.parse(request.body);

      await revokePermission({ userId: id, code: code as PermissionCode, reason, request });
      return reply.status(204).send();
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

  /**
   * Desligar um funcionário.
   *
   * O nome no botão é "Desligar", e não "Excluir", porque é o que de fato
   * acontece: o acesso acaba na hora, a pessoa sai da lista de quem trabalha
   * na loja, e o ponto, as vendas e a auditoria dela continuam guardados — a
   * lei do ponto exige, e é o que protege os dois lados numa discussão
   * trabalhista.
   */
  app.delete("/users/:id", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { reason } = blockUserSchema.parse(request.body);
    return removeUser({ userId: id, reason, request });
  });
}
