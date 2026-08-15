import type { User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { LoginPinInput } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, tooManyRequests, unauthorized } from "../../core/errors.js";
import { burnVerificationTime, verifySecret } from "../../core/security/password.service.js";
import type { IssuedSession, SignAccessToken } from "./auth.service.js";
import { issueSessionForUser } from "./auth.service.js";
import { openStoreOnDeviceLogin } from "../stores/store-opening.service.js";

async function registerFailedPinAttempt(user: User): Promise<void> {
  const attempts = user.pinFailedAttempts + 1;
  const shouldLock = attempts >= env.PIN_MAX_ATTEMPTS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      pinFailedAttempts: shouldLock ? 0 : attempts,
      pinLockedUntil: shouldLock
        ? new Date(Date.now() + env.PIN_LOCKOUT_MINUTES * 60_000)
        : user.pinLockedUntil,
    },
  });
}

/**
 * Login rápido do tablet: matrícula + PIN.
 *
 * O PIN tem 4 a 6 dígitos — entropia baixa demais para ser credencial única.
 * O que torna esse fluxo aceitável é a exigência de um Device pareado e ACTIVE:
 * o tablet registrado funciona como "algo que você tem", e o PIN como "algo que
 * você sabe". Fora de um tablet conhecido, matrícula + PIN não valem nada.
 */
export async function loginWithPin(params: {
  input: LoginPinInput;
  request: FastifyRequest;
  signAccessToken: SignAccessToken;
}): Promise<IssuedSession> {
  const { input, request, signAccessToken } = params;

  const device = await prisma.device.findFirst({
    where: { id: input.deviceId, deletedAt: null },
  });

  if (!device) {
    throw badRequest("DEVICE_NOT_FOUND", "Dispositivo não encontrado ou não autorizado.");
  }

  if (device.status !== "ACTIVE") {
    throw forbidden("DEVICE_NOT_ACTIVE", "Este dispositivo não está ativo para uso.");
  }

  // Matrícula é única por empresa: a busca é sempre dentro da empresa do tablet.
  const user = await prisma.user.findFirst({
    where: {
      companyId: device.companyId,
      employeeCode: input.employeeCode,
      deletedAt: null,
    },
  });

  if (!user || !user.pinHash) {
    await burnVerificationTime();
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "FAILURE",
      companyId: device.companyId,
      storeId: device.storeId,
      deviceId: device.id,
      reason: "matrícula não encontrada ou sem PIN definido",
      metadata: { employeeCode: input.employeeCode },
    });
    throw unauthorized("INVALID_CREDENTIALS", "Matrícula ou PIN incorretos.");
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      storeId: device.storeId,
      deviceId: device.id,
      userRoleSnapshot: user.role,
      reason: "PIN temporariamente bloqueado",
    });
    throw tooManyRequests(
      "PIN_LOCKED",
      "Muitas tentativas incorretas. Use sua senha ou aguarde alguns minutos.",
    );
  }

  const pinMatches = await verifySecret(user.pinHash, input.pin);

  if (!pinMatches) {
    await registerFailedPinAttempt(user);
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      storeId: device.storeId,
      deviceId: device.id,
      userRoleSnapshot: user.role,
      reason: "PIN incorreto",
    });
    throw unauthorized("INVALID_CREDENTIALS", "Matrícula ou PIN incorretos.");
  }

  if (user.status !== "ACTIVE") {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "DENIED",
      userId: user.id,
      companyId: user.companyId,
      deviceId: device.id,
      userRoleSnapshot: user.role,
      reason: `usuário com status ${user.status}`,
    });
    throw forbidden("USER_BLOCKED", "Seu acesso está bloqueado. Procure o responsável pela loja.");
  }

  // O funcionário só usa o PIN em tablet da loja a que tem acesso. Dono e
  // desenvolvedor circulam por todas as lojas da empresa.
  if (user.role !== "DONO" && user.role !== "DESENVOLVEDOR") {
    const hasStoreAccess = await prisma.userStore.findUnique({
      where: { userId_storeId: { userId: user.id, storeId: device.storeId } },
      select: { id: true },
    });

    if (!hasStoreAccess) {
      await audit(request, {
        action: "LOGIN_FAILED",
        result: "DENIED",
        userId: user.id,
        companyId: user.companyId,
        storeId: device.storeId,
        deviceId: device.id,
        userRoleSnapshot: user.role,
        reason: "usuário sem acesso à loja deste tablet",
      });
      throw forbidden("STORE_ACCESS_DENIED", "Você não tem acesso a esta loja.");
    }
  }

  const issued = await issueSessionForUser({
    user,
    deviceId: device.id,
    storeId: device.storeId,
    request,
    signAccessToken,
    resetCounters: "PIN",
  });

  await prisma.device.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  await audit(request, {
    action: "LOGIN_SUCCESS",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    storeId: device.storeId,
    deviceId: device.id,
    userRoleSnapshot: user.role,
    metadata: { method: "PIN" },
  });

  // A loja abre sozinha: alguém chegou, ligou o tablet e passou o PIN. Pedir
  // um "abrir loja" logo depois seria um passo que não informa nada.
  // Não lança — se a abertura falhar, o funcionário ainda precisa entrar.
  await openStoreOnDeviceLogin({
    storeId: device.storeId,
    userId: user.id,
    deviceId: device.id,
    request,
  });

  return issued;
}
