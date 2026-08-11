import type { DeviceSession, User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { LoginPasswordInput } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound, tooManyRequests, unauthorized } from "../../core/errors.js";
import { burnVerificationTime, verifySecret } from "../../core/security/password.service.js";
import { getEffectivePermissions } from "../../core/rbac/permissions.engine.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  parseDuration,
} from "../../core/security/token.service.js";

export interface AccessTokenPayload {
  sub: string;
  companyId: string;
  role: string;
  storeIds: string[];
  sessionId: string;
  deviceId: string | null;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    name: string;
    email: string | null;
    employeeCode: string;
    role: string;
    companyId: string;
    storeIds: string[];
    mustChangePassword: boolean;
    mustCreatePin: boolean;
    /**
     * O perfil exige 2FA e ele ainda não foi confirmado. O app usa isto para
     * levar direto à configuração, em vez de deixar o usuário esbarrar num 403
     * em cada tela que tentar abrir.
     */
    twoFactorPending: boolean;
  };
}

/** Só o DONO é obrigado a usar segundo fator (item 19 da especificação). */
async function isTwoFactorPending(user: { id: string; role: string }): Promise<boolean> {
  if (user.role !== "DONO") return false;

  const credential = await prisma.twoFactorCredential.findUnique({
    where: { userId: user.id },
    select: { confirmedAt: true },
  });

  return !credential?.confirmedAt;
}

/** Assina o access token. Injetado pelas rotas (vem do plugin @fastify/jwt). */
export type SignAccessToken = (payload: AccessTokenPayload) => string;

async function loadStoreIds(userId: string): Promise<string[]> {
  const links = await prisma.userStore.findMany({
    where: { userId },
    select: { storeId: true },
  });
  return links.map((link) => link.storeId);
}

/**
 * Cria a sessão e o primeiro refresh token. `storeId` fica null quando o login
 * não parte de um tablet de loja (notebook do dono, por exemplo).
 *
 * `resetCounters` diz quais contadores de bloqueio zerar: um login por PIN
 * bem-sucedido não deve limpar as tentativas falhas de senha (e vice-versa) —
 * são credenciais independentes, e zerar a outra daria ao atacante um jeito
 * fácil de resetar o contador que ele está atacando.
 */
export async function issueSessionForUser(params: {
  user: User;
  deviceId: string | null;
  storeId: string | null;
  request: FastifyRequest;
  signAccessToken: SignAccessToken;
  resetCounters: "PASSWORD" | "PIN";
}): Promise<IssuedSession> {
  const { user, deviceId, storeId, request, signAccessToken, resetCounters } = params;

  const refreshTtlMs = parseDuration(env.JWT_REFRESH_TTL);
  const accessTtlMs = parseDuration(env.JWT_ACCESS_TTL);
  const now = Date.now();

  const plainRefreshToken = generateRefreshToken();
  const storeIds = await loadStoreIds(user.id);

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.deviceSession.create({
      data: {
        userId: user.id,
        deviceId,
        companyId: user.companyId,
        storeId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        expiresAt: new Date(now + refreshTtlMs),
      },
    });

    await tx.refreshToken.create({
      data: {
        sessionId: created.id,
        tokenHash: hashRefreshToken(plainRefreshToken),
        expiresAt: new Date(now + refreshTtlMs),
        createdByIp: request.ip,
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(resetCounters === "PASSWORD"
          ? { passwordFailedAttempts: 0, passwordLockedUntil: null }
          : { pinFailedAttempts: 0, pinLockedUntil: null }),
      },
    });

    return created;
  });

  const accessToken = signAccessToken({
    sub: user.id,
    companyId: user.companyId,
    role: user.role,
    storeIds,
    sessionId: session.id,
    deviceId,
  });

  return {
    accessToken,
    refreshToken: plainRefreshToken,
    expiresIn: Math.floor(accessTtlMs / 1000),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      employeeCode: user.employeeCode,
      role: user.role,
      companyId: user.companyId,
      storeIds,
      mustChangePassword: user.mustChangePassword,
      mustCreatePin: user.mustCreatePin,
      twoFactorPending: await isTwoFactorPending(user),
    },
  };
}

/**
 * Quem pode entrar fora de um tablet pareado.
 *
 * O DONO sempre — ele precisa alcançar a empresa de qualquer lugar, e é a conta
 * mais protegida do sistema (2FA obrigatório).
 *
 * O DESENVOLVEDOR também, porque é um perfil de suporte remoto por natureza:
 * exigir presença física num tablet o tornaria inútil. O risco é baixo — ele
 * não escreve nada e não enxerga valor em dinheiro.
 *
 * Todos os demais precisam da liberação nominal AUTH_LOGIN_OFF_DEVICE.
 */
async function canLoginWithoutDevice(user: User): Promise<boolean> {
  if (user.role === "DONO" || user.role === "DESENVOLVEDOR") {
    return true;
  }

  const permissions = await getEffectivePermissions(user.id);
  return permissions.has("AUTH_LOGIN_OFF_DEVICE");
}

async function registerFailedPasswordAttempt(user: User): Promise<void> {
  const attempts = user.passwordFailedAttempts + 1;
  const shouldLock = attempts >= env.LOGIN_MAX_ATTEMPTS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordFailedAttempts: shouldLock ? 0 : attempts,
      passwordLockedUntil: shouldLock
        ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000)
        : user.passwordLockedUntil,
    },
  });
}

export async function loginWithPassword(params: {
  input: LoginPasswordInput;
  request: FastifyRequest;
  signAccessToken: SignAccessToken;
}): Promise<IssuedSession> {
  const { input, request, signAccessToken } = params;

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      OR: [{ email: input.identifier }, { employeeCode: input.identifier }],
    },
  });

  // Usuário inexistente: gasta o mesmo tempo de CPU de uma verificação real e
  // devolve a mesma mensagem de senha errada — não confirma se a conta existe.
  if (!user || !user.passwordHash) {
    await burnVerificationTime();
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "FAILURE",
      reason: "identificador não encontrado",
      metadata: { identifier: input.identifier },
    });
    throw unauthorized("INVALID_CREDENTIALS", "E-mail/matrícula ou senha incorretos.");
  }

  if (user.passwordLockedUntil && user.passwordLockedUntil > new Date()) {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "conta temporariamente bloqueada por tentativas incorretas",
    });
    throw tooManyRequests(
      "ACCOUNT_LOCKED",
      "Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.",
    );
  }

  const passwordMatches = await verifySecret(user.passwordHash, input.password);

  if (!passwordMatches) {
    await registerFailedPasswordAttempt(user);
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "senha incorreta",
    });
    throw unauthorized("INVALID_CREDENTIALS", "E-mail/matrícula ou senha incorretos.");
  }

  if (user.status === "BLOCKED" || user.status === "INACTIVE") {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: `usuário com status ${user.status}`,
    });
    throw forbidden("USER_BLOCKED", "Seu acesso está bloqueado. Procure o responsável pela loja.");
  }

  // Senha correta, mas a conta ainda não passou pelo primeiro acesso: o cliente
  // deve seguir para o fluxo de definir senha própria e PIN.
  if (user.status === "PENDING_FIRST_ACCESS") {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "primeiro acesso pendente",
    });
    throw badRequest(
      "FIRST_ACCESS_REQUIRED",
      "Primeiro acesso pendente. Você precisa criar sua senha e seu PIN.",
    );
  }

  const device = input.deviceId
    ? await prisma.device.findFirst({
        where: { id: input.deviceId, deletedAt: null },
      })
    : null;

  if (input.deviceId && !device) {
    throw badRequest("DEVICE_NOT_FOUND", "Dispositivo não encontrado ou não autorizado.");
  }

  if (device && device.status !== "ACTIVE") {
    throw forbidden("DEVICE_NOT_ACTIVE", "Este dispositivo não está ativo para uso.");
  }

  if (device && device.companyId !== user.companyId) {
    throw forbidden("DEVICE_WRONG_COMPANY", "Dispositivo não pertence à sua empresa.");
  }

  // Mesma regra do login por PIN: entrar num tablet exige acesso àquela loja.
  // Sem isto, o login por senha seria a porta dos fundos para operar o caixa de
  // uma loja à qual o funcionário não pertence.
  if (
    device &&
    user.role !== "DONO" &&
    user.role !== "DESENVOLVEDOR" &&
    !(await prisma.userStore.findUnique({
      where: { userId_storeId: { userId: user.id, storeId: device.storeId } },
      select: { id: true },
    }))
  ) {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      storeId: device.storeId,
      deviceId: device.id,
      userRoleSnapshot: user.role,
      reason: "usuário sem acesso à loja deste dispositivo",
    });
    throw forbidden("STORE_ACCESS_DENIED", "Você não tem acesso a esta loja.");
  }

  // Sem tablet, o acesso é a exceção e não a regra: funcionário opera pelo
  // aparelho da loja. Fora dele, só entra quem o dono autorizou nominalmente —
  // ou o próprio dono, que precisa alcançar o sistema de qualquer lugar.
  if (!device && !(await canLoginWithoutDevice(user))) {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "acesso fora do tablet da loja não autorizado para esta matrícula",
    });
    throw forbidden(
      "DEVICE_REQUIRED",
      "Seu acesso é permitido apenas nos tablets da loja. Peça ao dono para liberar sua matrícula em outros aparelhos.",
    );
  }

  const issued = await issueSessionForUser({
    user,
    deviceId: device?.id ?? null,
    storeId: device?.storeId ?? null,
    request,
    signAccessToken,
    resetCounters: "PASSWORD",
  });

  await audit(request, {
    action: "LOGIN_SUCCESS",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    storeId: device?.storeId ?? null,
    deviceId: device?.id ?? null,
    userRoleSnapshot: user.role,
    metadata: { method: "PASSWORD" },
  });

  return issued;
}

/**
 * Revoga a sessão inteira e todos os seus refresh tokens.
 * Usado no logout e, principalmente, quando detectamos reuso de token.
 */
async function revokeSession(session: DeviceSession, reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { sessionId: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
    prisma.deviceSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: reason },
    }),
  ]);
}

export async function refreshSession(params: {
  refreshToken: string;
  request: FastifyRequest;
  signAccessToken: SignAccessToken;
}): Promise<IssuedSession> {
  const { refreshToken, request, signAccessToken } = params;

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    include: { session: { include: { user: true, device: true } } },
  });

  if (!stored) {
    throw unauthorized("INVALID_REFRESH_TOKEN", "Sessão inválida. Entre novamente.");
  }

  const { session } = stored;

  // Token já rotacionado sendo reapresentado: ou é um cliente com estado velho,
  // ou alguém roubou o token. Não dá para distinguir, então tratamos como roubo
  // e derrubamos a sessão inteira — o legítimo refaz o login.
  if (stored.revokedAt) {
    await revokeSession(session, "reuso de refresh token detectado");
    await audit(request, {
      action: "SESSION_REUSE_DETECTED",
      result: "FAILURE",
      userId: session.userId,
      companyId: session.companyId,
      storeId: session.storeId,
      deviceId: session.deviceId,
      sessionId: session.id,
      userRoleSnapshot: session.user.role,
      reason: "refresh token revogado foi reapresentado",
    });
    throw unauthorized(
      "REFRESH_TOKEN_REUSED",
      "Detectamos um problema de segurança na sua sessão. Entre novamente.",
    );
  }

  const now = new Date();

  if (stored.expiresAt < now || session.revokedAt || session.expiresAt < now) {
    throw unauthorized("SESSION_EXPIRED", "Sua sessão expirou. Entre novamente.");
  }

  if (session.user.status !== "ACTIVE" || session.user.deletedAt) {
    await revokeSession(session, "usuário inativo ou removido");
    throw forbidden("USER_BLOCKED", "Seu acesso está bloqueado. Procure o responsável pela loja.");
  }

  const refreshTtlMs = parseDuration(env.JWT_REFRESH_TTL);
  const accessTtlMs = parseDuration(env.JWT_ACCESS_TTL);
  const newPlainToken = generateRefreshToken();

  await prisma.$transaction(async (tx) => {
    // UPDATE condicional em vez de update direto: duas requisições paralelas
    // com o mesmo token disputam esta linha e só uma consegue marcá-la. Sem a
    // condição, ambas rotacionariam e criariam duas cadeias válidas — o que
    // anularia a detecção de reuso justamente no cenário que ela existe para
    // pegar. É comum o cliente disparar várias chamadas ao expirar o access
    // token, então a corrida não é hipotética.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: "rotated" },
    });

    if (claimed.count === 0) {
      throw unauthorized("REFRESH_IN_PROGRESS", "Sua sessão foi renovada em outra aba. Tente novamente.");
    }

    await tx.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: hashRefreshToken(newPlainToken),
        rotatedFromId: stored.id,
        expiresAt: new Date(now.getTime() + refreshTtlMs),
        createdByIp: request.ip,
      },
    });

    await tx.deviceSession.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  });

  const storeIds = await loadStoreIds(session.userId);

  const accessToken = signAccessToken({
    sub: session.userId,
    companyId: session.companyId,
    role: session.user.role,
    storeIds,
    sessionId: session.id,
    deviceId: session.deviceId,
  });

  return {
    accessToken,
    refreshToken: newPlainToken,
    expiresIn: Math.floor(accessTtlMs / 1000),
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      employeeCode: session.user.employeeCode,
      role: session.user.role,
      companyId: session.user.companyId,
      storeIds,
      mustChangePassword: session.user.mustChangePassword,
      mustCreatePin: session.user.mustCreatePin,
      twoFactorPending: await isTwoFactorPending(session.user),
    },
  };
}

export async function logout(params: {
  refreshToken: string;
  request: FastifyRequest;
}): Promise<void> {
  const { refreshToken, request } = params;

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(refreshToken) },
    include: { session: { include: { user: true } } },
  });

  // Logout é idempotente: token desconhecido ou já revogado não é erro.
  if (!stored || stored.session.revokedAt) {
    return;
  }

  await revokeSession(stored.session, "logout");

  await audit(request, {
    action: "LOGOUT",
    result: "SUCCESS",
    userId: stored.session.userId,
    companyId: stored.session.companyId,
    storeId: stored.session.storeId,
    deviceId: stored.session.deviceId,
    sessionId: stored.session.id,
    userRoleSnapshot: stored.session.user.role,
  });
}

export async function listActiveSessions(userId: string) {
  return prisma.deviceSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { device: { select: { name: true } } },
    orderBy: { lastUsedAt: "desc" },
  });
}

/**
 * Encerra uma sessão específica. Um usuário só encerra as próprias sessões;
 * derrubar a sessão de outra pessoa é ação administrativa, com permissão
 * própria (SESSION_REVOKE), e responde 404 quando a sessão não é acessível —
 * confirmar que ela existe já seria informação demais.
 */
export async function revokeSessionById(params: {
  sessionId: string;
  request: FastifyRequest;
}): Promise<void> {
  const { sessionId, request } = params;

  const session = await prisma.deviceSession.findFirst({
    where: { id: sessionId, revokedAt: null },
    include: { user: { select: { role: true, companyId: true } } },
  });

  const isOwnSession = session?.userId === request.user.sub;
  const isSameCompany = session?.companyId === request.user.companyId;
  const canRevokeOthers = request.user.role === "DONO";

  if (!session || !isSameCompany || (!isOwnSession && !canRevokeOthers)) {
    throw notFound("SESSION_NOT_FOUND", "Sessão não encontrada.");
  }

  await revokeSession(session, isOwnSession ? "encerrada pelo usuário" : "encerrada pelo dono");

  await audit(request, {
    action: "SESSION_REVOKE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: session.companyId,
    storeId: session.storeId,
    deviceId: session.deviceId,
    sessionId: session.id,
    userRoleSnapshot: request.user.role,
    entityType: "DeviceSession",
    entityId: session.id,
    metadata: { targetUserId: session.userId },
  });
}

export async function logoutAll(params: {
  userId: string;
  request: FastifyRequest;
}): Promise<number> {
  const { userId, request } = params;

  const sessions = await prisma.deviceSession.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });

  const sessionIds = sessions.map((session) => session.id);
  const now = new Date();

  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { sessionId: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: now, revokedReason: "logout-all" },
    }),
    prisma.deviceSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { revokedAt: now, revokedReason: "logout-all" },
    }),
  ]);

  await audit(request, {
    action: "LOGOUT_ALL",
    result: "SUCCESS",
    userId,
    metadata: { revokedSessions: sessionIds.length },
  });

  return sessionIds.length;
}
