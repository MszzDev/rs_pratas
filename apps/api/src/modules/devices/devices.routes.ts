import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  claimDeviceSchema,
  createCashRegisterSchema,
  createDeviceSchema,
  createPOSStationSchema,
} from "@rs-pratas/shared";
import { blockWriteForDeveloper, requireRole } from "../../core/rbac/require-role.hook.js";
import {
  claimDevice,
  createCashRegister,
  createDevice,
  createPOSStation,
  listDevices,
  unlinkDevice,
} from "./devices.service.js";

export async function deviceRoutes(app: FastifyInstance) {
  const managerOrOwner = [app.requireAuth, blockWriteForDeveloper, requireRole("DONO", "GERENTE")];
  const ownerOnly = [app.requireAuth, blockWriteForDeveloper, requireRole("DONO")];

  app.post("/pos-stations", { preHandler: ownerOnly }, async (request, reply) => {
    const input = createPOSStationSchema.parse(request.body);
    const station = await createPOSStation({ input, request });
    return reply.status(201).send(station);
  });

  app.post("/cash-registers", { preHandler: ownerOnly }, async (request, reply) => {
    const input = createCashRegisterSchema.parse(request.body);
    const cashRegister = await createCashRegister({ input, request });
    return reply.status(201).send(cashRegister);
  });

  app.post("/devices", { preHandler: managerOrOwner }, async (request, reply) => {
    const input = createDeviceSchema.parse(request.body);
    const result = await createDevice({ input, request });
    return reply.status(201).send({
      device: result.device,
      pairingCode: result.pairingCode,
      expiresAt: result.expiresAt,
    });
  });

  /**
   * Sem autenticação por natureza: é o tablet virgem se apresentando. A
   * autorização é o próprio código de pareamento, que expira e é de uso único.
   * Rate limit apertado para não permitir varredura de códigos.
   */
  app.post(
    "/devices/claim",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = claimDeviceSchema.parse(request.body);
      const device = await claimDevice({ input, request });
      return reply.status(200).send({
        id: device.id,
        name: device.name,
        storeId: device.storeId,
        cashRegisterId: device.cashRegisterId,
        status: device.status,
        isKioskEnabled: device.isKioskEnabled,
      });
    },
  );

  app.get("/devices", { preHandler: app.requireAuth }, async (request) => {
    const query = z.object({ storeId: z.string().uuid().optional() }).parse(request.query);
    return listDevices({ request, ...(query.storeId ? { storeId: query.storeId } : {}) });
  });

  app.post("/devices/:id/unlink", { preHandler: ownerOnly }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { reason } = z
      .object({ reason: z.string().min(3, "Informe o motivo do desvínculo.").max(500) })
      .parse(request.body);

    const device = await unlinkDevice({ deviceId: id, request, reason });
    return reply.status(200).send(device);
  });
}
