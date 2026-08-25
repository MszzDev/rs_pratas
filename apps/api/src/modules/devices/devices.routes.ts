import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  claimDeviceSchema,
  createCashRegisterSchema,
  createDeviceSchema,
  createPOSStationSchema,
} from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { assertStoreAccess, requireRole } from "../../core/rbac/require-role.hook.js";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { requireStepUp } from "../auth/step-up.service.js";
import { StepUpPurpose } from "@prisma/client";
import {
  claimDevice,
  createCashRegister,
  createDevice,
  createPOSStation,
  listDevices,
  registerKioskExit,
  unlinkDevice,
} from "./devices.service.js";
import {
  announceDevice,
  assignDevice,
  dismissAnnouncement,
  listPendingDevices,
} from "./announcement.service.js";

export async function deviceRoutes(app: FastifyInstance) {
  // A guarda de somente-leitura do DESENVOLVEDOR já vive dentro do requireAuth.
  const managerOrOwner = [app.requireAuth, requireRole("DONO", "GERENTE")];
  const ownerOnly = [app.requireAuth, requireRole("DONO")];

  app.get("/pos-stations", { preHandler: app.requireAuth }, async (request) => {
    const { storeId } = z.object({ storeId: z.string().uuid() }).parse(request.query);
    await assertStoreAccess(request, storeId);

    return prisma.pOSStation.findMany({
      where: { storeId, deletedAt: null },
      include: {
        cashRegisters: {
          where: { deletedAt: null },
          orderBy: { code: "asc" },
        },
      },
      orderBy: { code: "asc" },
    });
  });

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

  /**
   * Saida do modo quiosque.
   *
   * Tres barreiras, e cada uma cobre um buraco da outra: a PERMISSAO diz quem
   * pode em tese; o STEP-UP prova que e a pessoa agora, e nao um tablet
   * deixado destravado no balcao; o MOTIVO obriga a dizer para que.
   *
   * O motivo tem minimo de 5 caracteres de proposito — "ok" nao explica nada
   * a quem for ler a auditoria daqui a tres meses.
   */
  app.post(
    "/devices/:id/kiosk-exit",
    {
      preHandler: [
        app.requireAuth,
        requirePermission("DEVICE_EXIT_KIOSK"),
        requireStepUp(StepUpPurpose.EXIT_KIOSK),
      ],
    },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { reason } = z
        .object({
          reason: z
            .string()
            .min(5, "Explique por que o tablet esta saindo do modo quiosque.")
            .max(500),
        })
        .parse(request.body);

      return registerKioskExit({ deviceId: id, reason, request });
    },
  );

  /**
   * O tablet se apresenta ao abrir.
   *
   * Sem autenticacao de sessao: o aparelho ainda nao tem quem o autentique —
   * e justamente o problema que ele veio resolver. A defesa e outra: o
   * anuncio SOZINHO nao da nada. Aparelho anunciado e nao vinculado nao abre
   * login, nao ve preco e nao vende. O pior que um estranho consegue e
   * aparecer numa fila que o dono ignora.
   */
  app.post("/devices/announce", async (request) => {
    const input = z
      .object({
        hardwareId: z.string().min(4).max(120),
        model: z.string().max(80).optional(),
        osVersion: z.string().max(40).optional(),
        appVersion: z.string().max(40).optional(),
      })
      .parse(request.body);

    return announceDevice(input);
  });

  /** A fila de aparelhos esperando uma loja. */
  app.get("/devices/pending", { preHandler: managerOrOwner }, async () => listPendingDevices());

  app.post("/devices/pending/:id/assign", { preHandler: managerOrOwner }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        storeId: z.string().uuid(),
        name: z.string().min(2, "De um nome ao tablet, como Balcao 1.").max(60),
        cashRegisterId: z.string().uuid().optional(),
      })
      .parse(request.body);

    return assignDevice({ announcementId: id, ...body, request });
  });

  /** Tira da fila um aparelho que nao e da loja. */
  app.delete("/devices/pending/:id", { preHandler: managerOrOwner }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return dismissAnnouncement({ announcementId: id, request });
  });
}
