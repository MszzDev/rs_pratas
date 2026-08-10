import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, unauthorized } from "../../core/errors.js";
import { hashSecret, verifySecret } from "../../core/security/password.service.js";
import {
  createTotpSetup,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  verifyTotp,
} from "../../core/security/totp.service.js";

/**
 * O DONO tem acesso a custo, lucro, credenciais de integração e criação de
 * outros donos — senha sozinha não basta. Enquanto o 2FA não estiver
 * confirmado, a sessão dele fica restrita às próprias rotas de 2FA.
 */
export function requiresTwoFactor(role: string): boolean {
  return role === "DONO";
}

export async function startTwoFactorSetup(request: FastifyRequest) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.sub },
    include: { twoFactorCredential: true },
  });

  if (user.twoFactorCredential?.confirmedAt) {
    throw conflict("TWO_FACTOR_ALREADY_ENABLED", "A verificação em duas etapas já está ativa.");
  }

  const accountLabel = user.email ?? user.employeeCode;
  const setup = createTotpSetup(accountLabel);

  // Sobrescreve qualquer tentativa anterior não confirmada: o segredo antigo
  // nunca chegou a valer, e manter dois segredos pendentes só gera confusão.
  await prisma.twoFactorCredential.upsert({
    where: { userId: user.id },
    update: {
      secretEncrypted: encryptSecret(setup.secret),
      confirmedAt: null,
      recoveryCodesHash: [],
      recoveryCodesUsedCount: 0,
      lastUsedStep: null,
    },
    create: {
      userId: user.id,
      secretEncrypted: encryptSecret(setup.secret),
      recoveryCodesHash: [],
    },
  });

  await audit(request, {
    action: "TWO_FACTOR_SETUP_STARTED",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
  });

  // O segredo em claro só trafega aqui, para montar o QR Code.
  return { otpauthUrl: setup.otpauthUrl, secret: setup.secret };
}

export async function confirmTwoFactorSetup(params: { code: string; request: FastifyRequest }) {
  const { code, request } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.sub },
    include: { twoFactorCredential: true },
  });

  const credential = user.twoFactorCredential;
  if (!credential) {
    throw badRequest("TWO_FACTOR_NOT_STARTED", "Inicie a configuração da verificação em duas etapas.");
  }

  const verification = verifyTotp({
    secretBase32: decryptSecret(credential.secretEncrypted),
    accountLabel: user.email ?? user.employeeCode,
    code,
  });

  if (!verification.valid) {
    await audit(request, {
      action: "TWO_FACTOR_CHALLENGE_FAILED",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "código inválido na confirmação do 2FA",
    });
    throw unauthorized("INVALID_TOTP", "Código inválido. Confira o aplicativo e tente novamente.");
  }

  const recoveryCodes = generateRecoveryCodes();

  await prisma.twoFactorCredential.update({
    where: { userId: user.id },
    data: {
      confirmedAt: new Date(),
      lastUsedStep: BigInt(verification.step!),
      lastUsedAt: new Date(),
      recoveryCodesHash: await Promise.all(recoveryCodes.map((entry) => hashSecret(entry))),
      recoveryCodesUsedCount: 0,
    },
  });

  await audit(request, {
    action: "TWO_FACTOR_ENABLE",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
  });

  // Única exibição dos códigos de recuperação — depois só existem como hash.
  return { recoveryCodes };
}

export async function verifyTwoFactorChallenge(params: { code: string; request: FastifyRequest }) {
  const { code, request } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.sub },
    include: { twoFactorCredential: true },
  });

  const credential = user.twoFactorCredential;
  if (!credential?.confirmedAt) {
    throw badRequest("TWO_FACTOR_NOT_ENABLED", "Verificação em duas etapas não está ativa.");
  }

  const verification = verifyTotp({
    secretBase32: decryptSecret(credential.secretEncrypted),
    accountLabel: user.email ?? user.employeeCode,
    code,
  });

  // Um código já usado não vale de novo, mesmo dentro da janela de 30s: sem
  // isso, quem intercepta o código na hora ainda consegue reutilizá-lo.
  const alreadyUsed =
    verification.step !== null &&
    credential.lastUsedStep !== null &&
    BigInt(verification.step) <= credential.lastUsedStep;

  if (!verification.valid || alreadyUsed) {
    await audit(request, {
      action: "TWO_FACTOR_CHALLENGE_FAILED",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: alreadyUsed ? "código já utilizado" : "código inválido",
    });
    throw unauthorized("INVALID_TOTP", "Código inválido ou já utilizado.");
  }

  await prisma.twoFactorCredential.update({
    where: { userId: user.id },
    data: { lastUsedStep: BigInt(verification.step!), lastUsedAt: new Date() },
  });

  return { verified: true };
}

export async function useRecoveryCode(params: { code: string; request: FastifyRequest }) {
  const { code, request } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.sub },
    include: { twoFactorCredential: true },
  });

  const credential = user.twoFactorCredential;
  if (!credential?.confirmedAt) {
    throw badRequest("TWO_FACTOR_NOT_ENABLED", "Verificação em duas etapas não está ativa.");
  }

  const normalized = code.trim().toUpperCase();
  let matchedIndex = -1;

  for (const [index, hash] of credential.recoveryCodesHash.entries()) {
    if (await verifySecret(hash, normalized)) {
      matchedIndex = index;
      break;
    }
  }

  if (matchedIndex === -1) {
    await audit(request, {
      action: "TWO_FACTOR_CHALLENGE_FAILED",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "código de recuperação inválido",
    });
    throw unauthorized("INVALID_RECOVERY_CODE", "Código de recuperação inválido.");
  }

  // Consumido: some da lista para não valer duas vezes.
  const remaining = credential.recoveryCodesHash.filter((_, index) => index !== matchedIndex);

  await prisma.twoFactorCredential.update({
    where: { userId: user.id },
    data: {
      recoveryCodesHash: remaining,
      recoveryCodesUsedCount: credential.recoveryCodesUsedCount + 1,
      lastUsedAt: new Date(),
    },
  });

  await audit(request, {
    action: "TWO_FACTOR_RECOVERY_USED",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
    metadata: { remainingCodes: remaining.length },
  });

  return { verified: true, remainingCodes: remaining.length };
}
