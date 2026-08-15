import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { StepUpPurpose } from "@prisma/client";
import { createStoreSchema, updateStoreSchema } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { conflict, notFound } from "../../core/errors.js";
import { assertStoreAccess, requireRole } from "../../core/rbac/require-role.hook.js";
import { requireStepUp } from "../auth/step-up.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

export async function storeRoutes(app: FastifyInstance) {
  const ownerOnly = [app.requireAuth, requireRole("DONO")];

  app.get("/stores", { preHandler: app.requireAuth }, async (request) => {
    const isGlobalRole = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

    return prisma.store.findMany({
      where: {
        companyId: request.user.companyId,
        deletedAt: null,
        ...(isGlobalRole ? {} : { id: { in: request.user.storeIds } }),
      },
      orderBy: { name: "asc" },
    });
  });

  app.get("/stores/:id", { preHandler: app.requireAuth }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await assertStoreAccess(request, id);

    return prisma.store.findFirstOrThrow({
      where: { id, companyId: request.user.companyId, deletedAt: null },
    });
  });

  app.post("/stores", { preHandler: ownerOnly }, async (request, reply) => {
    const input = createStoreSchema.parse(request.body);

    const taken = await prisma.store.findFirst({
      where: { companyId: request.user.companyId, code: input.code, deletedAt: null },
      select: { id: true },
    });
    if (taken) {
      throw conflict("STORE_CODE_TAKEN", `Já existe uma loja com o código ${input.code}.`);
    }

    const store = await prisma.store.create({
      data: {
        companyId: request.user.companyId,
        code: input.code,
        name: input.name,
        timezone: input.timezone,
        cnpj: input.cnpj ?? null,
        phone: input.phone ?? null,
      },
    });

    await audit(request, {
      action: "STORE_CREATE",
      result: "SUCCESS",
      userId: request.user.sub,
      companyId: request.user.companyId,
      storeId: store.id,
      userRoleSnapshot: request.user.role,
      entityType: "Store",
      entityId: store.id,
      newData: { code: store.code, name: store.name },
    });

    return reply.status(201).send(store);
  });

  app.patch("/stores/:id", { preHandler: ownerOnly }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const input = updateStoreSchema.parse(request.body);

    const store = await prisma.store.findFirst({
      where: { id, companyId: request.user.companyId, deletedAt: null },
    });
    if (!store) {
      throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        // O endereço vai inteiro: substituir o bloco é mais previsível que
        // mesclar campo a campo, e é assim que a tela manda.
        ...(input.address !== undefined ? { addressJson: input.address } : {}),
      },
    });

    await audit(request, {
      action: "STORE_UPDATE",
      result: "SUCCESS",
      userId: request.user.sub,
      companyId: request.user.companyId,
      storeId: store.id,
      userRoleSnapshot: request.user.role,
      entityType: "Store",
      entityId: store.id,
      previousData: { code: store.code, name: store.name, phone: store.phone },
      newData: input,
    });

    return updated;
  });

  /**
   * Desativar loja é soft delete e exige reautenticação e motivo: a loja carrega
   * histórico de vendas, caixa e ponto que nunca pode sumir do banco.
   */
  app.post(
    "/stores/:id/deactivate",
    { preHandler: [...ownerOnly, requireStepUp(StepUpPurpose.DEACTIVATE_STORE)] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(3, "Informe o motivo.").max(500) })
        .parse(request.body);

      const store = await prisma.store.findFirst({
        where: { id, companyId: request.user.companyId, deletedAt: null },
      });
      if (!store) {
        throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
      }

      const updated = await prisma.store.update({
        where: { id: store.id },
        data: { isActive: false, deletedAt: new Date() },
      });

      await audit(request, {
        action: "STORE_DEACTIVATE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: request.user.companyId,
        storeId: store.id,
        userRoleSnapshot: request.user.role,
        entityType: "Store",
        entityId: store.id,
        reason,
      });

      return updated;
    },
  );
}
