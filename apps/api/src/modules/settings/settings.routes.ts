import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { notFound } from "../../core/errors.js";
import { assertStoreAccess, requireRole } from "../../core/rbac/require-role.hook.js";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";

const settingBodySchema = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
  description: z.string().max(500).optional(),
});

/**
 * Configurações em três níveis, do mais amplo ao mais específico: empresa, loja
 * e dispositivo. O tablet lê a configuração efetiva combinando os três, com o
 * nível mais específico prevalecendo — assim uma loja pode ter tempo de
 * bloqueio por inatividade diferente do padrão da empresa, e um tablet
 * específico pode diferir da sua loja.
 */
export async function settingsRoutes(app: FastifyInstance) {
  const ownerOnly = [app.requireAuth, requireRole("DONO")];

  app.get(
    "/settings/app",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => {
      return prisma.appSetting.findMany({
        where: { companyId: request.user.companyId },
        orderBy: { key: "asc" },
      });
    },
  );

  app.put("/settings/app", { preHandler: ownerOnly }, async (request) => {
    const input = settingBodySchema.parse(request.body);

    const previous = await prisma.appSetting.findUnique({
      where: { companyId_key: { companyId: request.user.companyId, key: input.key } },
    });

    const setting = await prisma.appSetting.upsert({
      where: { companyId_key: { companyId: request.user.companyId, key: input.key } },
      update: {
        value: input.value as never,
        description: input.description ?? null,
        updatedById: request.user.sub,
      },
      create: {
        companyId: request.user.companyId,
        key: input.key,
        value: input.value as never,
        description: input.description ?? null,
        updatedById: request.user.sub,
      },
    });

    await audit(request, {
      action: "SETTING_UPDATE",
      result: "SUCCESS",
      userId: request.user.sub,
      companyId: request.user.companyId,
      userRoleSnapshot: request.user.role,
      entityType: "AppSetting",
      entityId: setting.id,
      ...(previous ? { previousData: { key: previous.key, value: previous.value as never } } : {}),
      newData: { key: setting.key, value: setting.value as never },
    });

    return setting;
  });

  app.get("/settings/stores/:storeId", { preHandler: app.requireAuth }, async (request) => {
    const { storeId } = z.object({ storeId: z.string().uuid() }).parse(request.params);
    await assertStoreAccess(request, storeId);

    return prisma.storeSetting.findMany({ where: { storeId }, orderBy: { key: "asc" } });
  });

  app.put(
    "/settings/stores/:storeId",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_STORE")] },
    async (request) => {
      const { storeId } = z.object({ storeId: z.string().uuid() }).parse(request.params);
      const input = settingBodySchema.parse(request.body);
      await assertStoreAccess(request, storeId);

      const setting = await prisma.storeSetting.upsert({
        where: { storeId_key: { storeId, key: input.key } },
        update: { value: input.value as never, updatedById: request.user.sub },
        create: {
          storeId,
          key: input.key,
          value: input.value as never,
          updatedById: request.user.sub,
        },
      });

      await audit(request, {
        action: "SETTING_UPDATE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: request.user.companyId,
        storeId,
        userRoleSnapshot: request.user.role,
        entityType: "StoreSetting",
        entityId: setting.id,
        newData: { key: setting.key, value: setting.value as never },
      });

      return setting;
    },
  );

  app.get("/settings/devices/:deviceId", { preHandler: app.requireAuth }, async (request) => {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, companyId: request.user.companyId, deletedAt: null },
      select: { storeId: true },
    });
    if (!device) {
      throw notFound("DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
    }
    await assertStoreAccess(request, device.storeId);

    return prisma.deviceSetting.findMany({ where: { deviceId }, orderBy: { key: "asc" } });
  });

  app.put(
    "/settings/devices/:deviceId",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_DEVICE")] },
    async (request) => {
      const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
      const input = settingBodySchema.parse(request.body);

      const device = await prisma.device.findFirst({
        where: { id: deviceId, companyId: request.user.companyId, deletedAt: null },
        select: { storeId: true },
      });
      if (!device) {
        throw notFound("DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
      }
      await assertStoreAccess(request, device.storeId);

      const setting = await prisma.deviceSetting.upsert({
        where: { deviceId_key: { deviceId, key: input.key } },
        update: { value: input.value as never, updatedById: request.user.sub },
        create: {
          deviceId,
          key: input.key,
          value: input.value as never,
          updatedById: request.user.sub,
        },
      });

      await audit(request, {
        action: "SETTING_UPDATE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: request.user.companyId,
        storeId: device.storeId,
        deviceId,
        userRoleSnapshot: request.user.role,
        entityType: "DeviceSetting",
        entityId: setting.id,
        newData: { key: setting.key, value: setting.value as never },
      });

      return setting;
    },
  );
}
