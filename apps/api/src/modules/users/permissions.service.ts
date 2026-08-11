import type { FastifyRequest } from "fastify";
import type { PermissionCode } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { invalidatePermissionCache } from "../../core/rbac/permissions.engine.js";

/**
 * Permissões cuja revogação precisa derrubar as sessões existentes.
 *
 * AUTH_LOGIN_OFF_DEVICE é verificada no momento do login, não a cada
 * requisição. Sem esta limpeza, tirar a liberação de alguém não teria efeito
 * até a sessão dele expirar — o funcionário continuaria acessando de casa por
 * mais um mês, exatamente o que o dono acabou de proibir.
 */
const REVOKE_KILLS_SESSIONS: readonly string[] = ["AUTH_LOGIN_OFF_DEVICE"];

async function loadTargetUser(userId: string, request: FastifyRequest) {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });

  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  return user;
}

export async function grantPermission(params: {
  userId: string;
  code: PermissionCode;
  effect: "ALLOW" | "DENY";
  reason: string;
  expiresAt?: Date;
  request: FastifyRequest;
}) {
  const { userId, code, effect, reason, expiresAt, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode alterar permissões.");
  }

  const user = await loadTargetUser(userId, request);
  const permission = await prisma.permission.findUnique({ where: { code } });

  if (!permission) {
    throw badRequest("PERMISSION_UNKNOWN", "Permissão desconhecida.");
  }

  if (expiresAt && expiresAt <= new Date()) {
    throw badRequest("EXPIRES_IN_PAST", "A validade precisa ser uma data futura.");
  }

  const granted = await prisma.userPermission.upsert({
    where: { userId_permissionId: { userId: user.id, permissionId: permission.id } },
    update: {
      effect,
      reason,
      expiresAt: expiresAt ?? null,
      grantedById: request.user.sub,
      revokedAt: null,
      revokedById: null,
    },
    create: {
      userId: user.id,
      permissionId: permission.id,
      effect,
      reason,
      expiresAt: expiresAt ?? null,
      grantedById: request.user.sub,
    },
  });

  await invalidatePermissionCache(user.id);

  await audit(request, {
    action: "PERMISSION_GRANT",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "UserPermission",
    entityId: granted.id,
    newData: {
      targetUserId: user.id,
      targetEmployeeCode: user.employeeCode,
      permission: code,
      effect,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
    reason,
  });

  return granted;
}

export async function revokePermission(params: {
  userId: string;
  code: PermissionCode;
  reason: string;
  request: FastifyRequest;
}) {
  const { userId, code, reason, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode alterar permissões.");
  }

  const user = await loadTargetUser(userId, request);
  const permission = await prisma.permission.findUnique({ where: { code } });

  if (!permission) {
    throw badRequest("PERMISSION_UNKNOWN", "Permissão desconhecida.");
  }

  const existing = await prisma.userPermission.findUnique({
    where: { userId_permissionId: { userId: user.id, permissionId: permission.id } },
  });

  if (!existing || existing.revokedAt) {
    throw notFound("PERMISSION_NOT_GRANTED", "Esta permissão não está concedida a este usuário.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.userPermission.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedById: request.user.sub },
    });

    if (REVOKE_KILLS_SESSIONS.includes(code)) {
      const now = new Date();

      // Só as sessões abertas FORA de um tablet: o funcionário continua
      // trabalhando normalmente na loja, perde apenas o acesso remoto.
      await tx.refreshToken.updateMany({
        where: { session: { userId: user.id, deviceId: null }, revokedAt: null },
        data: { revokedAt: now, revokedReason: "liberação de acesso remoto revogada" },
      });
      await tx.deviceSession.updateMany({
        where: { userId: user.id, deviceId: null, revokedAt: null },
        data: { revokedAt: now, revokedReason: "liberação de acesso remoto revogada" },
      });
    }
  });

  await invalidatePermissionCache(user.id);

  await audit(request, {
    action: "PERMISSION_REVOKE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "UserPermission",
    entityId: existing.id,
    previousData: { permission: code, effect: existing.effect },
    reason,
  });
}

export async function listUserPermissions(params: { userId: string; request: FastifyRequest }) {
  const { userId, request } = params;
  const user = await loadTargetUser(userId, request);

  const overrides = await prisma.userPermission.findMany({
    where: { userId: user.id, revokedAt: null },
    include: { permission: { select: { code: true, description: true, category: true } } },
    orderBy: { createdAt: "desc" },
  });

  return overrides.map((entry) => ({
    code: entry.permission.code,
    description: entry.permission.description,
    category: entry.permission.category,
    effect: entry.effect,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
    expired: entry.expiresAt !== null && entry.expiresAt <= new Date(),
    createdAt: entry.createdAt,
  }));
}
