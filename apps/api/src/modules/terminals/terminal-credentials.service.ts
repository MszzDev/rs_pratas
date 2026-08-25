import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { notFound } from "../../core/errors.js";
import { decryptSecret, encryptSecret, maskSecret } from "../../core/security/crypto.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import * as mercadopago from "../integrations/mercadopago.client.js";

/**
 * A conta do Mercado Pago de CADA maquininha.
 *
 * A suposição inicial era uma conta para a empresa toda. Não é o que existe na
 * loja: cada aparelho foi contratado numa conta própria, e é nela que cai o
 * dinheiro daquele aparelho. Com uma credencial só, o sistema consultaria a
 * conta errada — o pagamento existiria na maquininha e apareceria como "não
 * encontrado" na conferência do caixa, que é o pior tipo de erro num sistema
 * de dinheiro: o que faz duvidar do que está certo.
 *
 * Regra que atravessa o módulo: o token NUNCA volta para a tela, nem para o
 * dono. A tela mostra os quatro últimos caracteres e o apelido da conta — o
 * suficiente para reconhecer qual credencial está ali sem que o valor circule
 * de novo.
 */

interface CredenciaisDaMaquininha {
  accessToken: string;
  publicKey?: string | undefined;
}

/** O que a tela precisa saber sobre a conta, sem receber a credencial. */
export interface ResumoDaConta {
  configurada: boolean;
  apelido: string | null;
  contaId: string | null;
  tokenPreview: string | null;
  atualizadoEm: Date | null;
}

export function resumirConta(terminal: {
  mpAccountLabel: string | null;
  mpExternalAccountId: string | null;
  credentialsEncrypted: string | null;
  credentialsUpdatedAt: Date | null;
}): ResumoDaConta {
  if (!terminal.credentialsEncrypted) {
    return {
      configurada: false,
      apelido: null,
      contaId: null,
      tokenPreview: null,
      atualizadoEm: null,
    };
  }

  const credenciais = JSON.parse(
    decryptSecret(terminal.credentialsEncrypted),
  ) as CredenciaisDaMaquininha;

  return {
    configurada: true,
    apelido: terminal.mpAccountLabel,
    contaId: terminal.mpExternalAccountId,
    tokenPreview: maskSecret(credenciais.accessToken),
    atualizadoEm: terminal.credentialsUpdatedAt,
  };
}

/**
 * Guarda a credencial e confirma NA HORA que ela funciona.
 *
 * Testar antes de gravar evita o pior resultado: a tela dizer "conta
 * configurada" com um token errado, e o erro só aparecer no dia em que alguém
 * precisar estornar uma compra com o cliente na frente.
 *
 * O apelido vem do próprio Mercado Pago quando o dono não escreve um. É melhor
 * que um campo vazio: com três maquininhas em três contas, "Conta 2" não
 * distingue nada.
 */
export async function setTerminalCredentials(params: {
  terminalId: string;
  accessToken: string;
  publicKey?: string | undefined;
  label?: string | undefined;
  request: FastifyRequest;
}) {
  const { terminalId, accessToken, publicKey, label, request } = params;

  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });

  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  await assertStoreAccess(request, terminal.storeId);

  // Se o token for recusado, o erro sobe daqui e nada é gravado.
  const conta = await mercadopago.getAccount(accessToken);

  const credenciais: CredenciaisDaMaquininha = { accessToken, publicKey };

  const atualizado = await prisma.paymentTerminal.update({
    where: { id: terminal.id },
    data: {
      credentialsEncrypted: encryptSecret(JSON.stringify(credenciais)),
      mpExternalAccountId: String(conta.id),
      mpAccountLabel: label?.trim() || conta.nickname,
      credentialsUpdatedAt: new Date(),
      provider: terminal.provider ?? "MERCADOPAGO",
    },
  });

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: terminal.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    reason: "conta do Mercado Pago da maquininha",
    // O token NÃO entra na auditoria — ela é lida por mais gente que o banco.
    newData: { contaId: String(conta.id), apelido: atualizado.mpAccountLabel },
  });

  return {
    terminalId: terminal.id,
    conta: resumirConta(atualizado),
    aviso: `Token aceito pela conta ${conta.nickname}.`,
  };
}

/** Tira a conta da maquininha. Ela continua cobrando; só sai do alcance do sistema. */
export async function clearTerminalCredentials(params: {
  terminalId: string;
  request: FastifyRequest;
}) {
  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: params.terminalId, companyId: params.request.user.companyId, deletedAt: null },
  });

  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  await assertStoreAccess(params.request, terminal.storeId);

  await prisma.paymentTerminal.update({
    where: { id: terminal.id },
    data: {
      credentialsEncrypted: null,
      mpExternalAccountId: null,
      mpAccountLabel: null,
      credentialsUpdatedAt: null,
    },
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
    reason: "conta do Mercado Pago removida da maquininha",
    previousData: { contaId: terminal.mpExternalAccountId, apelido: terminal.mpAccountLabel },
  });

  return { removida: true };
}

/**
 * A credencial que vale para cobrar/consultar NESTA maquininha.
 *
 * Cai para a credencial da empresa quando a maquininha não tem conta própria —
 * é o caso de quem só usa uma conta, e de tudo o que já existia antes desta
 * mudança.
 */
export async function credentialsForTerminal(terminalId: string): Promise<{
  accessToken: string;
  origem: "MAQUININHA" | "EMPRESA";
} | null> {
  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, deletedAt: null },
  });

  if (!terminal) return null;

  if (terminal.credentialsEncrypted) {
    const credenciais = JSON.parse(
      decryptSecret(terminal.credentialsEncrypted),
    ) as CredenciaisDaMaquininha;

    return { accessToken: credenciais.accessToken, origem: "MAQUININHA" };
  }

  const integracao = await prisma.integration.findFirst({
    where: { companyId: terminal.companyId, provider: "MERCADOPAGO", status: "CONECTADA" },
  });

  if (!integracao?.credentialsEncrypted) return null;

  const credenciais = JSON.parse(decryptSecret(integracao.credentialsEncrypted)) as {
    accessToken?: string;
  };

  return credenciais.accessToken
    ? { accessToken: credenciais.accessToken, origem: "EMPRESA" }
    : null;
}
