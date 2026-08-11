import type { UserRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { ChangeUserRoleInput, CreateUserInput, UpdateUserInput } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors.js";
import { hashSecret } from "../../core/security/password.service.js";
import { invalidatePermissionCache } from "../../core/rbac/permissions.engine.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { buildWelcomeEmail, type EmailProvider } from "../../core/email/index.js";
import { generateEmployeeCode, generateTemporaryPassword } from "./credentials.js";

/**
 * Só o DONO cria usuários — o GERENTE nunca, conforme a especificação. E entre
 * os perfis, DONO e DESENVOLVEDOR são os que dão visão irrestrita da empresa,
 * então sua criação exige reautenticação (step-up) na camada de rota.
 */
function assertCanAssignRole(actorRole: string, targetRole: UserRole): void {
  if (actorRole !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode criar ou alterar usuários.");
  }

  // Mantido explícito para o dia em que a criação for delegada a outro perfil.
  if ((targetRole === "DONO" || targetRole === "DESENVOLVEDOR") && actorRole !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode criar esse tipo de usuário.");
  }
}

export async function createUser(params: {
  input: CreateUserInput;
  request: FastifyRequest;
  emailProvider: EmailProvider;
}) {
  const { input, request, emailProvider } = params;
  assertCanAssignRole(request.user.role, input.role);

  const companyId = request.user.companyId;

  const emailTaken = await prisma.user.findFirst({
    where: { companyId, email: input.email, deletedAt: null },
    select: { id: true },
  });
  if (emailTaken) {
    throw conflict("EMAIL_TAKEN", "Já existe um usuário com este e-mail.");
  }

  for (const storeId of input.storeIds) {
    await assertStoreAccess(request, storeId);
  }

  const employeeCode = await generateEmployeeCode(companyId);
  const temporaryPassword = generateTemporaryPassword();

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId,
        employeeCode,
        email: input.email,
        name: input.name,
        role: input.role,
        status: "PENDING_FIRST_ACCESS",
        passwordHash: await hashSecret(temporaryPassword),
        mustChangePassword: true,
        mustCreatePin: true,
        createdById: request.user.sub,
      },
    });

    if (input.storeIds.length > 0) {
      await tx.userStore.createMany({
        data: input.storeIds.map((storeId, index) => ({
          userId: created.id,
          storeId,
          isPrimary: index === 0,
        })),
      });
    }

    return created;
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { tradeName: true },
  });

  const delivery = await emailProvider.send(
    buildWelcomeEmail({
      name: user.name,
      email: input.email,
      employeeCode,
      temporaryPassword,
      companyName: company.tradeName,
      loginUrl: env.APP_LOGIN_URL,
    }),
  );

  if (!delivery.delivered) {
    // O usuário foi criado; só a entrega falhou. Derrubar a criação aqui
    // deixaria o dono sem saber se o cadastro existe ou não. O estado fica
    // visível e o reenvio resolve.
    request.log.error({ userId: user.id, error: delivery.error }, "falha ao enviar e-mail de boas-vindas");
  }

  await audit(request, {
    action: "USER_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    newData: {
      name: user.name,
      email: user.email,
      employeeCode: user.employeeCode,
      role: user.role,
      storeIds: input.storeIds,
    },
    metadata: { welcomeEmailDelivered: delivery.delivered },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      employeeCode: user.employeeCode,
      role: user.role,
      status: user.status,
    },
    welcomeEmailDelivered: delivery.delivered,
  };
}

export async function resendWelcomeEmail(params: {
  userId: string;
  request: FastifyRequest;
  emailProvider: EmailProvider;
}) {
  const { userId, request, emailProvider } = params;

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (user.status !== "PENDING_FIRST_ACCESS") {
    throw badRequest(
      "FIRST_ACCESS_ALREADY_DONE",
      "Este usuário já concluiu o primeiro acesso. Reenviar credenciais não se aplica.",
    );
  }

  // Uma senha nova invalida a anterior — o reenvio nunca ressuscita uma senha
  // que já circulou.
  const temporaryPassword = generateTemporaryPassword();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashSecret(temporaryPassword), mustChangePassword: true },
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: user.companyId },
    select: { tradeName: true },
  });

  const delivery = await emailProvider.send(
    buildWelcomeEmail({
      name: user.name,
      email: user.email!,
      employeeCode: user.employeeCode,
      temporaryPassword,
      companyName: company.tradeName,
      loginUrl: env.APP_LOGIN_URL,
    }),
  );

  await audit(request, {
    action: "PASSWORD_CHANGE",
    result: delivery.delivered ? "SUCCESS" : "FAILURE",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    reason: "reenvio de credenciais de primeiro acesso",
  });

  return { delivered: delivery.delivered };
}

export async function listUsers(request: FastifyRequest) {
  const isGlobalRole = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const users = await prisma.user.findMany({
    where: {
      companyId: request.user.companyId,
      deletedAt: null,
      ...(isGlobalRole
        ? {}
        : { userStores: { some: { storeId: { in: request.user.storeIds } } } }),
    },
    include: { userStores: { select: { storeId: true } } },
    orderBy: { name: "asc" },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    employeeCode: user.employeeCode,
    role: user.role,
    status: user.status,
    storeIds: user.userStores.map((link) => link.storeId),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  }));
}

export async function updateUser(params: {
  userId: string;
  input: UpdateUserInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode editar usuários.");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
    include: { userStores: { select: { storeId: true } } },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (input.storeIds) {
    for (const storeId of input.storeIds) {
      await assertStoreAccess(request, storeId);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: user.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.email ? { email: input.email } : {}),
      },
    });

    if (input.storeIds) {
      await tx.userStore.deleteMany({ where: { userId: user.id } });
      if (input.storeIds.length > 0) {
        await tx.userStore.createMany({
          data: input.storeIds.map((storeId, index) => ({
            userId: user.id,
            storeId,
            isPrimary: index === 0,
          })),
        });
      }
    }

    return result;
  });

  await audit(request, {
    action: "USER_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: {
      name: user.name,
      email: user.email,
      storeIds: user.userStores.map((link) => link.storeId),
    },
    newData: { name: updated.name, email: updated.email, storeIds: input.storeIds ?? undefined },
  });

  return updated;
}

export async function changeUserRole(params: {
  userId: string;
  input: ChangeUserRoleInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;
  assertCanAssignRole(request.user.role, input.role);

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (user.id === request.user.sub && input.role !== user.role) {
    throw badRequest(
      "CANNOT_CHANGE_OWN_ROLE",
      "Você não pode alterar o seu próprio perfil de acesso.",
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: input.role },
  });

  // A troca de perfil muda as permissões efetivas na hora, não no fim do TTL.
  await invalidatePermissionCache(user.id);

  await audit(request, {
    action: input.role === "DONO" ? "USER_PROMOTE_TO_OWNER" : "USER_ROLE_CHANGE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: { role: user.role },
    newData: { role: updated.role },
    reason: input.reason,
  });

  return updated;
}

export async function setUserBlocked(params: {
  userId: string;
  blocked: boolean;
  reason: string;
  request: FastifyRequest;
}) {
  const { userId, blocked, reason, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode bloquear ou desbloquear usuários.");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (user.id === request.user.sub) {
    throw badRequest("CANNOT_BLOCK_SELF", "Você não pode bloquear a si mesmo.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: user.id },
      data: { status: blocked ? "BLOCKED" : "ACTIVE" },
    });

    // Bloquear precisa cortar o acesso imediatamente: uma sessão viva
    // sobreviveria ao bloqueio até o refresh token expirar.
    if (blocked) {
      const now = new Date();
      await tx.refreshToken.updateMany({
        where: { session: { userId: user.id }, revokedAt: null },
        data: { revokedAt: now, revokedReason: "usuário bloqueado" },
      });
      await tx.deviceSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: "usuário bloqueado" },
      });
    }

    return result;
  });

  await invalidatePermissionCache(user.id);

  await audit(request, {
    action: blocked ? "USER_BLOCK" : "USER_UNBLOCK",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: { status: user.status },
    newData: { status: updated.status },
    reason,
  });

  return updated;
}
