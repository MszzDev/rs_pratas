import type { FastifyRequest } from "fastify";
import { isWeakPin } from "@rs-pratas/shared";
import type {
  FirstAccessFinishInput,
  FirstAccessSetPasswordInput,
  FirstAccessSetPinInput,
  FirstAccessStartInput,
} from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, unauthorized } from "../../core/errors.js";
import { burnVerificationTime, hashSecret, verifySecret } from "../../core/security/password.service.js";

/** Escopo do token de onboarding — não serve para acessar nenhuma rota normal. */
export const ONBOARDING_SCOPE = "first_access";
const ONBOARDING_TTL = "15m";

export interface OnboardingTokenPayload {
  sub: string;
  scope: typeof ONBOARDING_SCOPE;
}

export type SignOnboardingToken = (payload: OnboardingTokenPayload) => string;
export type VerifyOnboardingToken = (token: string) => OnboardingTokenPayload;

export const onboardingSignOptions = { expiresIn: ONBOARDING_TTL };

/**
 * Valida a senha temporária e devolve um token de propósito único.
 *
 * Esse token não é uma sessão: não abre nenhuma rota da aplicação, só habilita
 * os passos seguintes do primeiro acesso. Assim, uma senha temporária vazada
 * nunca vira acesso ao sistema por si só — no máximo permite completar o
 * cadastro, que é auditado.
 */
export async function startFirstAccess(params: {
  input: FirstAccessStartInput;
  request: FastifyRequest;
  signOnboardingToken: SignOnboardingToken;
}) {
  const { input, request, signOnboardingToken } = params;

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      employeeCode: input.identifier,
    },
  });

  if (!user || !user.passwordHash) {
    await burnVerificationTime();
    throw unauthorized("INVALID_CREDENTIALS", "Matrícula ou senha temporária incorretos.");
  }

  // A senha é conferida ANTES do status. Se a ordem fosse invertida, bastaria
  // chutar uma matrícula para descobrir se ele pertence a um usuário já ativo — o
  // que desfaria, por esta porta, a proteção anti-enumeração que o login tem.
  const matches = await verifySecret(user.passwordHash, input.tempPassword);

  // Quem ainda não trocou o que recebeu passa por aqui, mesmo já ATIVO: o
  // funcionário nasce ativo para poder entrar no tablet com o PIN temporário
  // no primeiro dia, e a senha do papel continua sendo de uso único.
  const aindaNaoTrocou = user.status === "PENDING_FIRST_ACCESS" || user.mustChangePassword;

  if (matches && !aindaNaoTrocou) {
    throw badRequest(
      "FIRST_ACCESS_ALREADY_DONE",
      "Este usuário já concluiu o primeiro acesso. Use a tela de login normal.",
    );
  }

  if (!matches) {
    await audit(request, {
      action: "LOGIN_FAILED",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "senha temporária incorreta no primeiro acesso",
    });
    throw unauthorized("INVALID_CREDENTIALS", "Matrícula ou senha temporária incorretos.");
  }

  return {
    onboardingToken: signOnboardingToken({ sub: user.id, scope: ONBOARDING_SCOPE }),
    user: { id: user.id, name: user.name, employeeCode: user.employeeCode },
  };
}

async function loadOnboardingUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });

  /**
   * O que autoriza os passos seguintes é o TOKEN, não o status.
   *
   * O funcionário passou a nascer ATIVO — é o PIN temporário que o faz
   * trabalhar no primeiro dia —, então exigir "PENDENTE" aqui derrubava o
   * fluxo no meio: bastava a senha ter sido definida no passo anterior para o
   * passo seguinte dizer que o primeiro acesso não valia mais.
   *
   * O token de onboarding tem escopo próprio, dura minutos e só é emitido a
   * quem acertou a senha temporária no `start` — que é onde a conta já
   * estabelecida é recusada. Aqui basta a conta existir e não estar bloqueada.
   */
  if (!user || user.status === "BLOCKED" || user.status === "INACTIVE") {
    throw badRequest("FIRST_ACCESS_INVALID_STATE", "Este fluxo de primeiro acesso não é mais válido.");
  }

  return user;
}

export async function setFirstAccessPassword(params: {
  userId: string;
  input: FirstAccessSetPasswordInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;
  const user = await loadOnboardingUser(userId);

  // A nova senha não pode ser a própria temporária — senão o "troque a senha"
  // vira formalidade e a credencial entregue em mãos continua
  // valendo.
  if (user.passwordHash && (await verifySecret(user.passwordHash, input.newPassword))) {
    throw badRequest(
      "PASSWORD_SAME_AS_TEMPORARY",
      "A nova senha precisa ser diferente da senha temporária.",
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashSecret(input.newPassword),
      mustChangePassword: false,
      passwordFailedAttempts: 0,
      passwordLockedUntil: null,
    },
  });

  await audit(request, {
    action: "PASSWORD_CHANGE",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
    reason: "definida no primeiro acesso",
  });
}

export async function setFirstAccessPin(params: {
  userId: string;
  input: FirstAccessSetPinInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;
  const user = await loadOnboardingUser(userId);

  if (user.mustChangePassword) {
    throw badRequest("PASSWORD_STEP_PENDING", "Defina sua nova senha antes de criar o PIN.");
  }

  // PIN sequencial ou repetido é o primeiro palpite de quem observa o teclado.
  if (isWeakPin(input.pin)) {
    throw badRequest(
      "WEAK_PIN",
      "Escolha um PIN menos previsível — evite números repetidos ou em sequência.",
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      pinHash: await hashSecret(input.pin),
      pinChangedAt: new Date(),
      mustCreatePin: false,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });

  await audit(request, {
    action: "PIN_SET",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
  });
}


/**
 * Fecha o primeiro acesso: só aqui o usuário vira ACTIVE e ganha uma sessão.
 * Enquanto senha e PIN não estiverem definidos, a conta não entra em operação.
 */
export async function completeFirstAccess(params: {
  userId: string;
  request: FastifyRequest;
}) {
  const { userId, request } = params;
  const user = await loadOnboardingUser(userId);

  if (user.mustChangePassword || user.mustCreatePin) {
    throw badRequest(
      "FIRST_ACCESS_INCOMPLETE",
      "Conclua a criação da senha e do PIN antes de finalizar.",
    );
  }

  const activated = await prisma.user.update({
    where: { id: user.id },
    data: { status: "ACTIVE" },
  });

  await audit(request, {
    action: "FIRST_ACCESS_COMPLETED",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
  });

  return activated;
}

/**
 * O primeiro acesso inteiro, numa transação só.
 *
 * Substitui `setFirstAccessPassword` + `setFirstAccessPin` + `completeFirstAccess`.
 *
 * O motivo é um defeito real, reproduzido: a senha era gravada no passo dela, e
 * o PIN só vinha depois. Quando o PIN era recusado — e ele É recusado, porque
 * quase todo mundo escolhe 1234 —, a conta ficava assim: senha do papel já
 * substituída, status ainda pendente, cadastro incompleto.
 *
 * A partir daí não havia porta. O login com a senha do papel dizia "matrícula
 * ou senha incorretos"; o login com a senha nova mandava para o primeiro
 * acesso; e o primeiro acesso pedia "a senha temporária", que já não existia. O
 * dono ficou trancado para fora do próprio sistema, e nada na tela explicava o
 * porquê.
 *
 * Gravar tudo junto elimina o estado intermediário. Não existe mais "meio
 * cadastrado".
 */
export async function finishFirstAccess(params: {
  userId: string;
  input: FirstAccessFinishInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;
  const user = await loadOnboardingUser(userId);

  // A nova senha não pode ser a própria temporária — senão o "troque a senha"
  // vira formalidade e a credencial entregue em mãos continua valendo.
  if (user.passwordHash && (await verifySecret(user.passwordHash, input.newPassword))) {
    throw badRequest(
      "PASSWORD_SAME_AS_TEMPORARY",
      "A nova senha precisa ser diferente da senha temporária.",
    );
  }

  // O schema compartilhado já recusa PIN previsível, e a tela recusa antes de
  // enviar. A conferência continua aqui porque o schema é do cliente também, e
  // o servidor não confia em validação que roda na máquina de outra pessoa.
  if (isWeakPin(input.pin)) {
    throw badRequest(
      "WEAK_PIN",
      "Escolha um PIN menos previsível — evite números repetidos ou em sequência.",
    );
  }

  const [passwordHash, pinHash] = await Promise.all([
    hashSecret(input.newPassword),
    hashSecret(input.pin),
  ]);

  const ativado = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      pinHash,
      mustChangePassword: false,
      mustCreatePin: false,
      pinChangedAt: new Date(),
      status: "ACTIVE",
      passwordFailedAttempts: 0,
      passwordLockedUntil: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });

  await audit(request, {
    action: "FIRST_ACCESS_COMPLETED",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
    reason: "senha e PIN definidos no primeiro acesso",
  });

  return ativado;
}
