import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import * as mercadopago from "../integrations/mercadopago.client.js";
import { credentialsForTerminal } from "./terminal-credentials.service.js";

/**
 * A cobrança que sai do PDV e aparece na tela da maquininha.
 *
 * O que isso resolve não é conforto. É o valor digitado errado: R$ 189,90
 * virando R$ 18,99 na pressa do fim de tarde, com o cliente já indo embora e
 * a diferença aparecendo no fechamento, quando não há mais como cobrar.
 *
 * E é o que traz o número do pagamento de volta sozinho — sem ele, estornar
 * uma troca significa alguém procurar o comprovante de papel e digitar o
 * número à mão, que é onde a conferência do caixa costuma parar de bater.
 */

/** Estados que a API do Point devolve, traduzidos para quem está no balcão. */
const ESTADOS: Record<string, string> = {
  OPEN: "Esperando o cliente na maquininha",
  ON_TERMINAL: "Esperando o cliente na maquininha",
  PROCESSING: "Processando o pagamento",
  FINISHED: "Pago",
  CANCELED: "Cancelado",
  ERROR: "A maquininha recusou",
  ABANDONED: "O cliente não concluiu",
};

async function carregarTerminal(terminalId: string, request: FastifyRequest) {
  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });

  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  await assertStoreAccess(request, terminal.storeId);

  return terminal;
}

/**
 * As maquininhas Point que existem na conta desta maquininha.
 *
 * Serve para o dono escolher qual aparelho físico corresponde ao cadastro —
 * a conta pode ter várias, e o número de série impresso na maquininha não é o
 * mesmo identificador que a API usa.
 */
export async function listPointDevices(params: { terminalId: string; request: FastifyRequest }) {
  const terminal = await carregarTerminal(params.terminalId, params.request);
  const credencial = await credentialsForTerminal(terminal.id);

  if (!credencial) {
    throw badRequest(
      "NO_CREDENTIALS",
      "Informe a conta do Mercado Pago desta maquininha antes de procurar o aparelho.",
    );
  }

  const aparelhos = await mercadopago.listPointDevices(credencial.accessToken);

  return aparelhos.map((aparelho) => ({
    id: aparelho.id,
    modo: aparelho.operating_mode ?? null,
    escolhido: aparelho.id === terminal.mpDeviceId,
  }));
}

/** Amarra o cadastro ao aparelho físico. */
export async function setPointDevice(params: {
  terminalId: string;
  pointDeviceId: string;
  request: FastifyRequest;
}) {
  const terminal = await carregarTerminal(params.terminalId, params.request);

  await prisma.paymentTerminal.update({
    where: { id: terminal.id },
    data: { mpDeviceId: params.pointDeviceId },
  });

  await audit(params.request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: params.request.user.sub,
    companyId: params.request.user.companyId,
    storeId: terminal.storeId,
    userRoleSnapshot: params.request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    reason: "aparelho Point vinculado à maquininha",
    newData: { mpDeviceId: params.pointDeviceId },
  });

  return { vinculado: true };
}

/**
 * Manda o valor para a maquininha.
 *
 * O valor vai em centavos porque é o que a API do Point espera — mandar reais
 * faria a maquininha cobrar cem vezes menos, e a venda fecharia como se
 * estivesse certa. A conversão acontece aqui, num lugar só.
 */
export async function chargeOnTerminal(params: {
  terminalId: string;
  amount: number;
  description: string;
  externalReference: string;
  installments?: number | undefined;
  type?: "credit" | "debit" | undefined;
  request: FastifyRequest;
}) {
  const terminal = await carregarTerminal(params.terminalId, params.request);

  if (terminal.status !== "ACTIVE") {
    throw badRequest("TERMINAL_NOT_ACTIVE", "Esta maquininha não está ativa.");
  }

  if (!terminal.mpDeviceId) {
    throw badRequest(
      "TERMINAL_WITHOUT_DEVICE",
      "Esta maquininha ainda não foi ligada a um aparelho do Mercado Pago. Faça isso em Maquininhas.",
    );
  }

  const credencial = await credentialsForTerminal(terminal.id);

  if (!credencial) {
    throw badRequest(
      "NO_CREDENTIALS",
      "Esta maquininha não tem conta do Mercado Pago configurada.",
    );
  }

  const intent = await mercadopago.createPaymentIntent(
    credencial.accessToken,
    terminal.mpDeviceId,
    {
      amountCents: Math.round(params.amount * 100),
      description: params.description,
      externalReference: params.externalReference,
      ...(params.installments ? { installments: params.installments } : {}),
      ...(params.type ? { type: params.type } : {}),
    },
  );

  await audit(params.request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: params.request.user.sub,
    companyId: params.request.user.companyId,
    storeId: terminal.storeId,
    userRoleSnapshot: params.request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    reason: `cobrança enviada à maquininha: ${params.externalReference}`,
    newData: { valor: params.amount, intentId: intent.id },
  });

  return {
    intentId: intent.id,
    estado: ESTADOS[intent.state] ?? intent.state,
    /** A tela pergunta de tempos em tempos até sair do "esperando". */
    concluido: false,
  };
}

/**
 * Em que pé está a cobrança.
 *
 * Devolve o número do pagamento quando aprovado — que é o dado que faz o
 * estorno funcionar depois, sem ninguém procurar comprovante de papel.
 */
export async function getChargeStatus(params: {
  terminalId: string;
  intentId: string;
  request: FastifyRequest;
}) {
  const terminal = await carregarTerminal(params.terminalId, params.request);
  const credencial = await credentialsForTerminal(terminal.id);

  if (!credencial) {
    throw badRequest("NO_CREDENTIALS", "Esta maquininha não tem conta configurada.");
  }

  const intent = await mercadopago.getPaymentIntent(credencial.accessToken, params.intentId);
  const aprovado = intent.state === "FINISHED" && intent.payment?.status === "approved";

  return {
    intentId: intent.id,
    estado: ESTADOS[intent.state] ?? intent.state,
    aprovado,
    concluido: ["FINISHED", "CANCELED", "ERROR", "ABANDONED"].includes(intent.state),
    paymentId: intent.payment?.id ? String(intent.payment.id) : null,
  };
}

/** Tira da maquininha a cobrança que o cliente desistiu de pagar. */
export async function cancelCharge(params: {
  terminalId: string;
  intentId: string;
  request: FastifyRequest;
}) {
  const terminal = await carregarTerminal(params.terminalId, params.request);
  const credencial = await credentialsForTerminal(terminal.id);

  if (!credencial || !terminal.mpDeviceId) {
    throw badRequest("NO_CREDENTIALS", "Esta maquininha não tem conta configurada.");
  }

  await mercadopago.cancelPaymentIntent(
    credencial.accessToken,
    terminal.mpDeviceId,
    params.intentId,
  );

  return { cancelado: true };
}
