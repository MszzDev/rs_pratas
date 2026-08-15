import type { UserRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { ChangeUserRoleInput, CreateUserInput, UpdateUserInput } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { hashSecret } from "../../core/security/password.service.js";
import { invalidatePermissionCache } from "../../core/rbac/permissions.engine.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { sendEmail } from "../../core/email/index.js";
import { credentialsEmail, credentialsResetEmail } from "../../core/email/templates.js";
import { generateEmployeeCode, generateTemporaryPassword } from "./credentials.js";

/**
 * O que pode sair do servidor sobre um usuário.
 *
 * Existe porque devolver o objeto do Prisma inteiro entrega `passwordHash` e
 * `pinHash` na resposta. Eles não servem para nada na tela e, uma vez fora do
 * servidor, passam a existir no histórico do navegador, em log de proxy e em
 * qualquer ferramenta de rede aberta no balcão. Hash de senha não sai daqui.
 */
/** Recorta o usuário para o que pode ser exibido. */
function toPublicUser(user: {
  id: string;
  name: string;
  employeeCode: string;
  email: string | null;
  role: string;
  status: string;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    employeeCode: user.employeeCode,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

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
}) {
  const { input, request } = params;
  assertCanAssignRole(request.user.role, input.role);

  const companyId = request.user.companyId;

  for (const storeId of input.storeIds) {
    await assertStoreAccess(request, storeId);
  }

  const employeeCode = await generateEmployeeCode(companyId);
  const temporaryPassword = generateTemporaryPassword();

  // Argon2id é caro de propósito (~100ms). Fora da transação, para não segurar
  // uma conexão do pool durante o hash.
  const passwordHash = await hashSecret(temporaryPassword);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId,
        employeeCode,
        name: input.name,
        email: input.email ?? null,
        role: input.role,
        status: "PENDING_FIRST_ACCESS",
        passwordHash,
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

  const emailSent = user.email
    ? await sendEmail(
        credentialsEmail({
          to: user.email,
          name: user.name,
          employeeCode: user.employeeCode,
          temporaryPassword,
          companyName: company.tradeName,
        }),
      )
    : false;

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
      employeeCode: user.employeeCode,
      email: user.email,
      role: user.role,
      storeIds: input.storeIds,
      credentialsEmailSent: emailSent,
    },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      employeeCode: user.employeeCode,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    /**
     * Única vez que a senha em claro existe fora do hash.
     *
     * Vai para a tela mesmo quando o e-mail é enviado: e-mail cai em spam,
     * atrasa, ou o endereço está errado — e o dono precisa poder entregar a
     * credencial em mãos ali mesmo. Não fica guardada em lugar nenhum: se
     * sumir, o caminho é gerar outra, que invalida esta.
     */
    temporaryPassword,
    /** A tela avisa se a entrega por e-mail funcionou. */
    emailSent,
  };
}

/**
 * Gera uma senha temporária nova para quem ainda não concluiu o primeiro
 * acesso — o caminho quando o funcionário perde o papel com a credencial.
 */
export async function regenerateTemporaryPassword(params: {
  userId: string;
  request: FastifyRequest;
}) {
  const { userId, request } = params;

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

  // A senha nova invalida a anterior: gerar outra nunca ressuscita a que já
  // circulou no papel.
  const temporaryPassword = generateTemporaryPassword();

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashSecret(temporaryPassword), mustChangePassword: true },
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: user.companyId },
    select: { tradeName: true },
  });

  const emailSent = user.email
    ? await sendEmail(
        credentialsResetEmail({
          to: user.email,
          name: user.name,
          employeeCode: user.employeeCode,
          temporaryPassword,
          companyName: company.tradeName,
        }),
      )
    : false;

  await audit(request, {
    action: "PASSWORD_CHANGE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    reason: "nova senha temporária gerada pelo dono",
    newData: { credentialsEmailSent: emailSent },
  });

  return { employeeCode: user.employeeCode, temporaryPassword, emailSent };
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

  // Quem está liberado a entrar fora dos tablets — a tela precisa mostrar isso
  // ao lado de cada matrícula para o dono saber o que já concedeu.
  const offDeviceGrants = await prisma.userPermission.findMany({
    where: {
      userId: { in: users.map((user) => user.id) },
      permission: { code: "AUTH_LOGIN_OFF_DEVICE" },
      effect: "ALLOW",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { userId: true, expiresAt: true },
  });

  const grantByUser = new Map(offDeviceGrants.map((grant) => [grant.userId, grant.expiresAt]));

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    employeeCode: user.employeeCode,
    email: user.email,
    role: user.role,
    status: user.status,
    storeIds: user.userStores.map((link) => link.storeId),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    /** Perfis com alcance global não dependem de liberação nominal. */
    offDeviceAllowed:
      user.role === "DONO" || user.role === "DESENVOLVEDOR" || grantByUser.has(user.id),
    offDeviceExpiresAt: grantByUser.get(user.id) ?? null,
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
        // String vazia é o gesto de "apagar o e-mail", distinto de "não mexer".
        ...(input.email !== undefined ? { email: input.email || null } : {}),
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
    newData: {
      name: updated.name,
      email: updated.email,
      storeIds: input.storeIds ?? undefined,
    },
  });

  return toPublicUser(updated);
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

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: user.id },
      data: { role: input.role },
    });

    // O perfil viaja dentro do access token, então uma sessão aberta continuaria
    // valendo com o perfil ANTIGO até o token expirar. Num rebaixamento isso
    // significaria manter privilégio elevado por mais 15 minutos. Derrubar as
    // sessões força o novo perfil a valer imediatamente.
    const now = new Date();
    await tx.refreshToken.updateMany({
      where: { session: { userId: user.id }, revokedAt: null },
      data: { revokedAt: now, revokedReason: "perfil alterado" },
    });
    await tx.deviceSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: "perfil alterado" },
    });

    return result;
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

  return toPublicUser(updated);
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

  return toPublicUser(updated);
}
