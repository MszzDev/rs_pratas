import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditResult } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";

const querySchema = z.object({
  action: z.nativeEnum(AuditAction).optional(),
  result: z.nativeEnum(AuditResult).optional(),
  userId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Paginação por cursor: o histórico cresce sem parar. */
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function auditRoutes(app: FastifyInstance) {
  /**
   * Consulta do histórico. Somente leitura por definição — não existe endpoint
   * de escrita nem de exclusão, e o banco recusaria de qualquer forma.
   *
   * O gerente enxerga a própria loja; dono e desenvolvedor, a empresa toda —
   * a mesma regra do espelho de ponto.
   */
  app.get(
    "/audit",
    { preHandler: [app.requireAuth, requirePermission("AUDIT_VIEW_STORE")] },
    async (request) => {
      const query = querySchema.parse(request.query);
      const seesEverything =
        request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

      const entries = await prisma.auditLog.findMany({
        where: {
          companyId: request.user.companyId,
          ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
          ...(query.action ? { action: query.action } : {}),
          ...(query.result ? { result: query.result } : {}),
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.storeId ? { storeId: query.storeId } : {}),
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
        include: { user: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "desc" },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const hasMore = entries.length > query.limit;
      const page = hasMore ? entries.slice(0, query.limit) : entries;

      return {
        entries: page.map((entry) => ({
          id: entry.id,
          action: entry.action,
          result: entry.result,
          entityType: entry.entityType,
          entityId: entry.entityId,
          reason: entry.reason,
          ipAddress: entry.ipAddress,
          createdAt: entry.createdAt,
          userRoleSnapshot: entry.userRoleSnapshot,
          user: entry.user,
          storeId: entry.storeId,
          deviceId: entry.deviceId,
        })),
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      };
    },
  );
}
