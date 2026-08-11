import { randomBytes } from "node:crypto";
import type { StepUpPurpose } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { audit } from "../../core/audit.service.js";
import { forbidden, unauthorized } from "../../core/errors.js";
import { verifySecret } from "../../core/security/password.service.js";
import { hashRefreshToken, parseDuration } from "../../core/security/token.service.js";
import { decryptSecret, verifyTotp } from "../../core/security/totp.service.js";

export const STEP_UP_HEADER = "x-step-up-token";

/**
 * Emite um token de uso único que autoriza UMA ação sensível.
 *
 * Existe porque uma sessão válida não é prova de que quem está no teclado
 * continua sendo o dono dela: o tablet fica na loja, aberto, o dia inteiro.
 * Antes de promover alguém a dono, mudar credencial de integração ou sair do
 * quiosque, exigimos a credencial de novo.
 */
export async function issueStepUpToken(params: {
  purpose: StepUpPurpose;
  password?: string;
  totpCode?: string;
  request: FastifyRequest;
}): Promise<{ stepUpToken: string; expiresAt: Date }> {
  const { purpose, password, totpCode, request } = params;

  const user = await prisma.user.findUnique({
    where: { id: request.user.sub },
    include: { twoFactorCredential: true },
  });

  if (!user || user.status !== "ACTIVE") {
    throw forbidden("USER_BLOCKED", "Seu acesso está bloqueado.");
  }

  let method: "PASSWORD" | "TOTP";

  // Quem tem 2FA confirmado reautentica com o segundo fator: é o que prova
  // presença de quem realmente detém a conta, não só conhecimento da senha.
  if (user.twoFactorCredential?.confirmedAt) {
    if (!totpCode) {
      throw unauthorized("TOTP_REQUIRED", "Informe o código do seu aplicativo autenticador.");
    }

    const verification = verifyTotp({
      secretBase32: decryptSecret(user.twoFactorCredential.secretEncrypted),
      accountLabel: user.employeeCode,
      code: totpCode,
    });

    const alreadyUsed =
      verification.step !== null &&
      user.twoFactorCredential.lastUsedStep !== null &&
      BigInt(verification.step) <= user.twoFactorCredential.lastUsedStep;

    if (!verification.valid || alreadyUsed) {
      await audit(request, {
        action: "STEP_UP_FAILED",
        result: "FAILURE",
        userId: user.id,
        companyId: user.companyId,
        userRoleSnapshot: user.role,
        reason: alreadyUsed ? "código TOTP já utilizado" : "código TOTP inválido",
        metadata: { purpose },
      });
      throw unauthorized("INVALID_TOTP", "Código inválido ou já utilizado.");
    }

    await prisma.twoFactorCredential.update({
      where: { userId: user.id },
      data: { lastUsedStep: BigInt(verification.step!), lastUsedAt: new Date() },
    });

    method = "TOTP";
  } else {
    if (!password || !user.passwordHash || !(await verifySecret(user.passwordHash, password))) {
      await audit(request, {
        action: "STEP_UP_FAILED",
        result: "FAILURE",
        userId: user.id,
        companyId: user.companyId,
        userRoleSnapshot: user.role,
        reason: "senha incorreta na reautenticação",
        metadata: { purpose },
      });
      throw unauthorized("INVALID_CREDENTIALS", "Senha incorreta.");
    }
    method = "PASSWORD";
  }

  const plainToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + parseDuration(env.STEP_UP_TOKEN_TTL));

  await prisma.stepUpToken.create({
    data: {
      userId: user.id,
      sessionId: request.user.sessionId,
      purpose,
      method,
      tokenHash: hashRefreshToken(plainToken),
      expiresAt,
      ipAddress: request.ip,
    },
  });

  await audit(request, {
    action: "STEP_UP_ISSUED",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
    metadata: { purpose, method },
  });

  return { stepUpToken: plainToken, expiresAt };
}

/**
 * Consome o token de step-up. O UPDATE condicional (`usedAt: null`) é a trava
 * de uso único: duas requisições simultâneas com o mesmo token disputam a mesma
 * linha, e só uma consegue marcá-la.
 */
export function requireStepUp(purpose: StepUpPurpose) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers[STEP_UP_HEADER];
    const token = Array.isArray(header) ? header[0] : header;

    if (!token) {
      throw forbidden(
        "STEP_UP_REQUIRED",
        "Esta ação exige confirmação da sua senha. Confirme e tente novamente.",
      );
    }

    const consumed = await prisma.stepUpToken.updateMany({
      where: {
        tokenHash: hashRefreshToken(token),
        userId: request.user.sub,
        sessionId: request.user.sessionId,
        purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    if (consumed.count === 0) {
      await audit(request, {
        action: "STEP_UP_FAILED",
        result: "DENIED",
        userId: request.user.sub,
        companyId: request.user.companyId,
        userRoleSnapshot: request.user.role,
        reason: "token de reautenticação inválido, expirado ou já usado",
        metadata: { purpose },
      });
      throw forbidden(
        "STEP_UP_INVALID",
        "Confirmação expirada ou já utilizada. Confirme sua senha novamente.",
      );
    }
  };
}
