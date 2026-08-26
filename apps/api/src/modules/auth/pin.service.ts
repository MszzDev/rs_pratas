import { randomInt } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound, unauthorized } from "../../core/errors.js";
import { hashSecret, verifySecret } from "../../core/security/password.service.js";
import { isWeakPin } from "@rs-pratas/shared";

/**
 * Troca e recuperação do PIN.
 *
 * O PIN vence a cada 30 dias. Quem está dentro do prazo troca sozinho; quem
 * deixou vencer e ficou de fora pede um PIN temporário ao dono ou ao gerente.
 *
 * A troca é do próprio funcionário de propósito: um PIN que só o dono troca
 * vira chamado telefônico às 9 da manhã, e o expediente não espera.
 */

/** Prazo de validade e a partir de quando o aviso aparece. */
export const PIN_VALIDO_POR_DIAS = 30;
export const AVISAR_A_PARTIR_DE_DIAS = 5;

/** Quantos dias faltam para o PIN vencer. Negativo = já venceu. */
export function diasAteVencer(pinChangedAt: Date | null): number | null {
  if (!pinChangedAt) return null;

  const usados = (Date.now() - pinChangedAt.getTime()) / 86_400_000;
  return Math.ceil(PIN_VALIDO_POR_DIAS - usados);
}

/**
 * O funcionário troca o próprio PIN.
 *
 * Exige o PIN atual. Sem isso, um tablet deixado destravado permitiria a
 * qualquer um trocar o PIN de quem esqueceu de sair — e a partir daí vender
 * no nome da pessoa.
 */
export async function changeOwnPin(params: {
  currentPin: string;
  newPin: string;
  request: FastifyRequest;
}) {
  const { currentPin, newPin, request } = params;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: request.user.sub },
    select: { id: true, pinHash: true, employeeCode: true },
  });

  if (!user.pinHash) {
    throw badRequest("NO_PIN", "Você ainda não tem PIN. Conclua o primeiro acesso.");
  }

  const confere = await verifySecret(user.pinHash, currentPin);

  if (!confere) {
    await audit(request, {
      action: "PIN_CHANGE",
      result: "FAILURE",
      userId: user.id,
      companyId: request.user.companyId,
      userRoleSnapshot: request.user.role,
      reason: "PIN atual incorreto",
    });

    throw unauthorized("WRONG_PIN", "O PIN atual não confere.");
  }

  if (isWeakPin(newPin)) {
    throw badRequest(
      "WEAK_PIN",
      "Escolha outro PIN. Sequências como 123456 e números repetidos são os primeiros que alguém tenta.",
    );
  }

  if (await verifySecret(user.pinHash, newPin)) {
    throw badRequest(
      "SAME_PIN",
      "O PIN novo é igual ao atual. Trocar por ele mesmo não renova nada.",
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      pinHash: await hashSecret(newPin),
      pinChangedAt: new Date(),
      mustCreatePin: false,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });

  await audit(request, {
    action: "PIN_CHANGE",
    result: "SUCCESS",
    userId: user.id,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    reason: "troca do próprio PIN",
  });

  return { trocado: true, validoPorDias: PIN_VALIDO_POR_DIAS };
}

/**
 * Confere o PIN de quem já está na sessão. Usado para destravar a tela.
 *
 * Não é login: a sessão continua a mesma, e nada novo é emitido. É só a
 * pergunta "ainda é você aí?" depois do tablet ficar parado no balcão — quem
 * pegou o aparelho de alguém que saiu para o almoço não passa daqui.
 *
 * Erra o PIN e conta como tentativa, com o mesmo bloqueio do login: sem isso,
 * a tela de destravar viraria o lugar confortável para tentar PINs à vontade.
 */
export async function verifyOwnPin(params: { pin: string; request: FastifyRequest }) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.request.user.sub },
    select: { id: true, pinHash: true, pinFailedAttempts: true, pinLockedUntil: true },
  });

  if (!user.pinHash) {
    throw badRequest("NO_PIN", "Você ainda não tem PIN.");
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw unauthorized("PIN_LOCKED", "PIN bloqueado por tentativas. Aguarde alguns minutos.");
  }

  const confere = await verifySecret(user.pinHash, params.pin);

  if (!confere) {
    const tentativas = user.pinFailedAttempts + 1;
    const bloquear = tentativas >= 5;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        pinFailedAttempts: bloquear ? 0 : tentativas,
        ...(bloquear ? { pinLockedUntil: new Date(Date.now() + 15 * 60_000) } : {}),
      },
    });

    throw unauthorized("WRONG_PIN", "PIN incorreto.");
  }

  if (user.pinFailedAttempts > 0) {
    await prisma.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0 } });
  }

  return { destravado: true };
}

/**
 * O funcionário pede um PIN temporário.
 *
 * SEM sessão: quem não consegue entrar não tem sessão para pedir com ela. O
 * que impede abuso é que pedir NÃO CONCEDE nada — o pedido só vira PIN depois
 * que o dono ou o gerente aprova, com o nome deles no registro.
 *
 * A resposta é sempre a mesma, exista a matrícula ou não. Uma resposta
 * diferente para matrícula inexistente transformaria esta tela num verificador
 * de quem trabalha na loja.
 */
export async function requestPinReset(params: {
  employeeCode: string;
  deviceId?: string | undefined;
}) {
  const user = await prisma.user.findFirst({
    where: { employeeCode: params.employeeCode, deletedAt: null },
    select: { id: true, companyId: true, status: true },
  });

  const resposta = {
    registrado: true,
    mensagem:
      "Pedido enviado. Procure o responsável da loja — ele libera um PIN temporário para você.",
  };

  if (!user || user.status === "BLOCKED" || user.status === "INACTIVE") {
    return resposta;
  }

  const jaPendente = await prisma.pinResetRequest.findFirst({
    where: { userId: user.id, status: "PENDENTE" },
  });

  // Pedir de novo não cria fila: o responsável veria a mesma pessoa três vezes
  // e não saberia se são três pedidos ou um repetido.
  if (jaPendente) return resposta;

  await prisma.pinResetRequest.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      ...(params.deviceId ? { deviceId: params.deviceId } : {}),
    },
  });

  return resposta;
}

/** Pedidos esperando decisão — o que o dono ou o gerente resolve. */
export async function listPinResets(request: FastifyRequest) {
  const pedidos = await prisma.pinResetRequest.findMany({
    where: { companyId: request.user.companyId, status: "PENDENTE" },
    include: {
      user: { select: { name: true, employeeCode: true, role: true } },
    },
    orderBy: { requestedAt: "asc" },
  });

  return pedidos.map((pedido) => ({
    id: pedido.id,
    name: pedido.user.name,
    employeeCode: pedido.user.employeeCode,
    role: pedido.user.role,
    requestedAt: pedido.requestedAt,
    esperandoHaMinutos: Math.floor((Date.now() - pedido.requestedAt.getTime()) / 60_000),
  }));
}

/**
 * Aprova e devolve o PIN temporário UMA vez.
 *
 * O PIN aparece na tela de quem aprovou, para ser dito à pessoa. Não vai por
 * e-mail nem fica guardado em texto: quem precisa dele está na mesma loja, a
 * três metros de distância.
 *
 * O PIN temporário nasce VENCIDO — `pinChangedAt` fica nulo. Assim o
 * funcionário entra com ele e o sistema já exige a troca, em vez de deixar um
 * PIN que passou pela boca de duas pessoas valendo por trinta dias.
 */
export async function approvePinReset(params: { requestId: string; request: FastifyRequest }) {
  const { requestId, request } = params;

  const pedido = await prisma.pinResetRequest.findFirst({
    where: { id: requestId, companyId: request.user.companyId },
    include: { user: { select: { id: true, name: true, employeeCode: true } } },
  });

  if (!pedido) {
    throw notFound("REQUEST_NOT_FOUND", "Pedido não encontrado.");
  }

  if (pedido.status !== "PENDENTE") {
    throw badRequest("ALREADY_DECIDED", "Este pedido já foi resolvido.");
  }

  // randomInt do módulo crypto, e não Math.random: é uma credencial, ainda que
  // de vida curta.
  const temporario = String(randomInt(100_000, 1_000_000));

  await prisma.$transaction([
    prisma.user.update({
      where: { id: pedido.user.id },
      data: {
        pinHash: await hashSecret(temporario),
        pinChangedAt: null,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    }),
    prisma.pinResetRequest.update({
      where: { id: pedido.id },
      data: { status: "APROVADA", decidedAt: new Date(), decidedById: request.user.sub },
    }),
  ]);

  await audit(request, {
    action: "PIN_CHANGE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: pedido.user.id,
    reason: `PIN temporário liberado para ${pedido.user.employeeCode}`,
    // O PIN NÃO entra na auditoria. O log é lido por mais gente que o banco.
  });

  return {
    employeeCode: pedido.user.employeeCode,
    name: pedido.user.name,
    temporaryPin: temporario,
    aviso: "Diga este PIN à pessoa. Ele serve para uma entrada — na primeira, o sistema pede a troca.",
  };
}

export async function rejectPinReset(params: {
  requestId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { requestId, reason, request } = params;

  const pedido = await prisma.pinResetRequest.findFirst({
    where: { id: requestId, companyId: request.user.companyId, status: "PENDENTE" },
  });

  if (!pedido) {
    throw notFound("REQUEST_NOT_FOUND", "Pedido não encontrado ou já resolvido.");
  }

  await prisma.pinResetRequest.update({
    where: { id: pedido.id },
    data: {
      status: "RECUSADA",
      decidedAt: new Date(),
      decidedById: request.user.sub,
      reason,
    },
  });

  await audit(request, {
    action: "PIN_CHANGE",
    result: "DENIED",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: pedido.userId,
    reason: `pedido de PIN recusado: ${reason}`,
  });

  return { recusado: true };
}
