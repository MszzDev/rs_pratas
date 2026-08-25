import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import {
  createTerminal,
  listTerminals,
  moveTerminal,
  replaceTerminal,
  setPrimaryTerminal,
  setTerminalStatus,
} from "./terminals.service.js";
import {
  clearTerminalCredentials,
  setTerminalCredentials,
} from "./terminal-credentials.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createSchema = z.object({
  deviceId: z.string().uuid(),
  provider: z.string().max(60).optional(),
  serialNumber: z.string().max(60).optional(),
});

const moveSchema = z.object({
  targetDeviceId: z.string().uuid(),
  reason: z.string().min(3, "Informe o motivo da mudança.").max(500),
});

const replaceSchema = z.object({
  newSerialNumber: z.string().min(1).max(60),
  reason: z.string().min(3, "Informe o motivo da troca.").max(500),
});

const credentialsSchema = z.object({
  accessToken: z
    .string()
    .min(20, "Cole o access token inteiro, começando por APP_USR-.")
    .max(300),
  publicKey: z.string().max(300).optional(),
  /** Como esta conta é chamada na loja. Vazio: usa o apelido da conta no MP. */
  label: z.string().max(60).optional(),
});

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]),
  reason: z.string().min(3, "Informe o motivo.").max(500),
});

export async function terminalRoutes(app: FastifyInstance) {
  app.get("/terminals", { preHandler: app.requireAuth }, async (request) => {
    const query = z.object({ storeId: z.string().uuid().optional() }).parse(request.query);

    return listTerminals({
      request,
      ...(query.storeId ? { storeId: query.storeId } : {}),
    });
  });

  app.post(
    "/terminals",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_CREATE")] },
    async (request, reply) => {
      const input = createSchema.parse(request.body);
      const terminal = await createTerminal({ input, request });
      return reply.status(201).send(terminal);
    },
  );

  app.post(
    "/terminals/:id/move",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_MOVE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = moveSchema.parse(request.body);

      return moveTerminal({
        terminalId: id,
        targetDeviceId: input.targetDeviceId,
        reason: input.reason,
        request,
      });
    },
  );

  app.post(
    "/terminals/:id/replace",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_REPLACE")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const input = replaceSchema.parse(request.body);

      const result = await replaceTerminal({
        terminalId: id,
        newSerialNumber: input.newSerialNumber,
        reason: input.reason,
        request,
      });

      return reply.status(201).send(result);
    },
  );

  app.post(
    "/terminals/:id/primary",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return setPrimaryTerminal({ terminalId: id, request });
    },
  );

  /**
   * A conta do Mercado Pago desta maquininha.
   *
   * Cada aparelho está numa conta própria — foi assim que a loja contratou.
   * Guardar uma credencial só da empresa faria o sistema consultar a conta
   * errada e dizer que um pagamento que existe não foi encontrado.
   */
  app.put(
    "/terminals/:id/mercadopago",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = credentialsSchema.parse(request.body);

      return setTerminalCredentials({ terminalId: id, ...input, request });
    },
  );

  app.delete(
    "/terminals/:id/mercadopago",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return clearTerminalCredentials({ terminalId: id, request });
    },
  );

  app.patch(
    "/terminals/:id/status",
    { preHandler: [app.requireAuth, requirePermission("TERMINAL_DISABLE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = statusSchema.parse(request.body);

      return setTerminalStatus({
        terminalId: id,
        status: input.status,
        reason: input.reason,
        request,
      });
    },
  );
}
