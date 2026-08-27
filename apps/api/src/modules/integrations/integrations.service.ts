import type { IntegrationProvider } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { decryptSecret, encryptSecret, maskSecret } from "../../core/security/crypto.js";
import * as nuvemshop from "./nuvemshop.client.js";
import * as mercadopago from "./mercadopago.client.js";

/**
 * Integrações com serviços externos.
 *
 * Regra que atravessa o módulo inteiro: o token NUNCA volta para a tela, nem
 * para o dono. A tela mostra os quatro últimos caracteres, o suficiente para
 * reconhecer qual credencial está configurada sem que o valor trafegue de
 * novo. Um token que circula é um token que vaza.
 */

export type Credentials = Record<string, string>;

function lerCredenciais(cifrado: string | null): Credentials {
  if (!cifrado) return {};
  try {
    return JSON.parse(decryptSecret(cifrado)) as Credentials;
  } catch {
    // Chave de cifra trocada, ou registro adulterado. Tratar como ausente é
    // melhor que derrubar a tela inteira: o dono reconecta.
    return {};
  }
}

async function exigirConectada(companyId: string, provider: IntegrationProvider) {
  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId, provider } },
  });

  if (!integration || integration.status !== "CONECTADA") {
    throw badRequest(
      "INTEGRATION_NOT_CONNECTED",
      "Esta integração ainda não está conectada. Configure-a em Configurações → Integrações.",
    );
  }

  return { integration, credentials: lerCredenciais(integration.credentialsEncrypted) };
}

/** O que a tela pode ver: situação, conta e a ponta do token. */
export async function listIntegrations(request: FastifyRequest) {
  const integrations = await prisma.integration.findMany({
    where: { companyId: request.user.companyId },
  });

  const porProvider = new Map(integrations.map((i) => [i.provider, i]));
  const providers: IntegrationProvider[] = ["NUVEMSHOP", "MERCADOPAGO", "REDE"];

  return providers.map((provider) => {
    const integration = porProvider.get(provider);
    const credenciais = lerCredenciais(integration?.credentialsEncrypted ?? null);
    const principal = credenciais.accessToken ?? "";

    return {
      provider,
      status: integration?.status ?? "DESCONECTADA",
      externalAccountId: integration?.externalAccountId ?? null,
      storeId: integration?.storeId ?? null,
      lastSyncAt: integration?.lastSyncAt ?? null,
      lastError: integration?.lastError ?? null,
      connectedAt: integration?.connectedAt ?? null,
      /** Só a ponta — o token inteiro não sai daqui. */
      tokenPreview: principal ? maskSecret(principal) : null,
    };
  });
}

/**
 * Guarda a credencial e confirma, na hora, que ela funciona.
 *
 * Testar antes de gravar como CONECTADA evita o pior resultado: a tela dizer
 * "conectado" com um token errado, e o erro só aparecer dias depois, quando um
 * pedido não entrar.
 */
export async function connectIntegration(params: {
  provider: IntegrationProvider;
  credentials: Credentials;
  storeId?: string | undefined;
  request: FastifyRequest;
}) {
  const { provider, credentials, storeId, request } = params;

  let externalAccountId: string;

  try {
    if (provider === "NUVEMSHOP") {
      if (!credentials.storeId || !credentials.accessToken) {
        throw badRequest("MISSING_CREDENTIALS", "Informe o ID da loja e o token da Nuvemshop.");
      }

      const loja = await nuvemshop.getStore({
        storeId: credentials.storeId,
        accessToken: credentials.accessToken,
      });
      externalAccountId = String(loja.id);
    } else if (provider === "MERCADOPAGO") {
      if (!credentials.accessToken) {
        throw badRequest("MISSING_CREDENTIALS", "Informe o access token do Mercado Pago.");
      }

      const conta = await mercadopago.getAccount(credentials.accessToken);
      externalAccountId = String(conta.id);
    } else {
      throw badRequest(
        "PROVIDER_NOT_SUPPORTED",
        "A integração com a Rede ainda não está disponível.",
      );
    }
  } catch (error) {
    // Guarda o erro para a tela explicar o que houve, e deixa a integração
    // marcada como ERRO em vez de fingir que está tudo bem.
    const mensagem = error instanceof Error ? error.message : "Falha ao validar a credencial.";

    await prisma.integration.upsert({
      where: { companyId_provider: { companyId: request.user.companyId, provider } },
      create: {
        companyId: request.user.companyId,
        provider,
        status: "ERRO",
        lastError: mensagem,
      },
      update: { status: "ERRO", lastError: mensagem },
    });

    throw error;
  }

  const integration = await prisma.integration.upsert({
    where: { companyId_provider: { companyId: request.user.companyId, provider } },
    create: {
      companyId: request.user.companyId,
      provider,
      status: "CONECTADA",
      externalAccountId,
      credentialsEncrypted: encryptSecret(JSON.stringify(credentials)),
      storeId: storeId ?? null,
      connectedAt: new Date(),
      connectedById: request.user.sub,
      lastError: null,
    },
    update: {
      status: "CONECTADA",
      externalAccountId,
      credentialsEncrypted: encryptSecret(JSON.stringify(credentials)),
      ...(storeId ? { storeId } : {}),
      connectedAt: new Date(),
      connectedById: request.user.sub,
      lastError: null,
    },
  });

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Integration",
    entityId: integration.id,
    reason: `integração ${provider} conectada`,
    // O token NÃO entra na auditoria: o log é lido por mais gente que o banco.
    newData: { provider, externalAccountId, storeId: storeId ?? null },
  });

  return {
    provider,
    status: integration.status,
    externalAccountId,
    conectadaEm: integration.connectedAt,
  };
}

export async function disconnectIntegration(params: {
  provider: IntegrationProvider;
  request: FastifyRequest;
}) {
  const { provider, request } = params;

  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId: request.user.companyId, provider } },
  });
  if (!integration) {
    throw notFound("INTEGRATION_NOT_FOUND", "Integração não encontrada.");
  }

  const atualizada = await prisma.integration.update({
    where: { id: integration.id },
    data: {
      status: "DESCONECTADA",
      // Apaga a credencial de verdade. Desconectar guardando o token seria
      // manter a porta destrancada com a placa de "fechado".
      credentialsEncrypted: null,
      connectedAt: null,
      lastError: null,
    },
  });

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Integration",
    entityId: integration.id,
    reason: `integração ${provider} desconectada`,
  });

  return { provider, status: atualizada.status };
}

/** Bate na API externa agora e diz o que voltou. */
export async function testIntegration(params: {
  provider: IntegrationProvider;
  request: FastifyRequest;
}) {
  const { provider, request } = params;
  const { credentials } = await exigirConectada(request.user.companyId, provider);

  if (provider === "NUVEMSHOP") {
    const loja = await nuvemshop.getStore({
      storeId: credentials.storeId!,
      accessToken: credentials.accessToken!,
    });

    return { ok: true, conta: nuvemshop.nomeDe(loja.name), detalhe: loja.url ?? null };
  }

  if (provider === "MERCADOPAGO") {
    const conta = await mercadopago.getAccount(credentials.accessToken!);
    return { ok: true, conta: conta.nickname, detalhe: conta.site_id };
  }

  throw badRequest("PROVIDER_NOT_SUPPORTED", "Integração ainda não disponível.");
}

/**
 * Empurra o estoque do ERP para o site.
 *
 * O casamento é pelo SKU: o código da peça aqui precisa ser o mesmo código da
 * variação lá. É a única chave que as duas pontas compartilham, e por isso a
 * função devolve a lista do que NÃO casou — sem isso o dono acharia que
 * sincronizou tudo enquanto metade do catálogo ficou de fora, em silêncio.
 */
export async function syncStockToNuvemshop(params: { request: FastifyRequest }) {
  const { request } = params;
  const { integration, credentials } = await exigirConectada(
    request.user.companyId,
    "NUVEMSHOP",
  );

  if (!integration.storeId) {
    throw badRequest(
      "STORE_NOT_CHOSEN",
      "Escolha qual loja alimenta o site antes de sincronizar — é o estoque dela que vai para lá.",
    );
  }

  const conta = { storeId: credentials.storeId!, accessToken: credentials.accessToken! };

  const estoque = await prisma.stockItem.findMany({
    /**
     * Peça removida do catálogo não vai para o site.
     *
     * Faltava, e este era o pior lugar para faltar: o saldo de uma peça que a
     * loja tirou de linha seria publicado como disponível, e alguém poderia
     * comprar pela internet um produto que não existe mais para vender.
     */
    where: { storeId: integration.storeId, product: { deletedAt: null } },
    include: {
      product: { select: { sku: true, name: true } },
      variation: { select: { sku: true } },
    },
  });

  // Mapa SKU -> disponível. O reservado sai do total: peça separada para um
  // cliente não pode ser vendida de novo no site.
  const disponivelPorSku = new Map<string, number>();
  for (const item of estoque) {
    const sku = item.variation?.sku ?? item.product.sku;
    const disponivel = Math.max(0, item.quantity - item.reservedQuantity);
    disponivelPorSku.set(sku, (disponivelPorSku.get(sku) ?? 0) + disponivel);
  }

  const atualizados: string[] = [];
  const semCorrespondencia: string[] = [];
  let pagina = 1;

  for (;;) {
    const produtos = await nuvemshop.listProducts(conta, pagina);
    if (produtos.length === 0) break;

    for (const produto of produtos) {
      for (const variante of produto.variants) {
        if (!variante.sku) continue;

        const disponivel = disponivelPorSku.get(variante.sku);

        if (disponivel === undefined) {
          semCorrespondencia.push(variante.sku);
          continue;
        }

        if (variante.stock === disponivel) continue;

        await nuvemshop.updateVariantStock(conta, produto.id, variante.id, disponivel);
        atualizados.push(variante.sku);
      }
    }

    pagina += 1;
    // Trava de segurança: catálogo grande não vira laço infinito por um erro
    // de paginação do outro lado.
    if (pagina > 25) break;
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date(), lastError: null },
  });

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Integration",
    entityId: integration.id,
    reason: "estoque sincronizado com a Nuvemshop",
    metadata: { atualizados: atualizados.length, semCorrespondencia: semCorrespondencia.length },
  });

  return {
    atualizados: atualizados.length,
    /** SKUs que existem no site e não existem aqui — o dono precisa saber. */
    semCorrespondencia: semCorrespondencia.slice(0, 50),
    totalSemCorrespondencia: semCorrespondencia.length,
  };
}

/**
 * Guarda um evento recebido de fora.
 *
 * Grava ANTES de processar, e ignora reentrega do mesmo evento pelo
 * `externalId`. Os serviços reenviam webhooks quando não recebem 200 rápido o
 * bastante — sem essa trava, um pedido viraria dois.
 */
export async function recordEvent(params: {
  provider: IntegrationProvider;
  companyId: string;
  topic: string;
  externalId: string | null;
  payload: unknown;
}) {
  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId: params.companyId, provider: params.provider } },
  });

  if (!integration) return { duplicado: false, evento: null };

  try {
    const evento = await prisma.integrationEvent.create({
      data: {
        integrationId: integration.id,
        companyId: params.companyId,
        topic: params.topic,
        externalId: params.externalId,
        payload: params.payload as never,
      },
    });

    return { duplicado: false, evento };
  } catch {
    // Violação do índice único = já recebemos este evento. Não é erro.
    return { duplicado: true, evento: null };
  }
}

export async function listEvents(params: {
  request: FastifyRequest;
  provider?: IntegrationProvider | undefined;
}) {
  const eventos = await prisma.integrationEvent.findMany({
    where: {
      companyId: params.request.user.companyId,
      ...(params.provider ? { integration: { provider: params.provider } } : {}),
    },
    include: { integration: { select: { provider: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return eventos.map((evento) => ({
    id: evento.id,
    provider: evento.integration.provider,
    topic: evento.topic,
    externalId: evento.externalId,
    processado: evento.processedAt !== null,
    error: evento.error,
    createdAt: evento.createdAt,
  }));
}

/**
 * Conclui a conexao com a Nuvemshop a partir do codigo da autorizacao.
 *
 * Fluxo: o dono autoriza o aplicativo na loja dele, a Nuvemshop devolve um
 * codigo, e ESTE metodo troca esse codigo pelo token permanente. So aqui o
 * client_secret e usado; depois disso ele nao serve para mais nada e nao e
 * guardado.
 */
export async function completeNuvemshopAuthorization(params: {
  appId: string;
  clientSecret: string;
  code: string;
  storeId?: string | undefined;
  request: FastifyRequest;
}) {
  const { appId, clientSecret, code, storeId, request } = params;

  const credencial = await nuvemshop.exchangeCodeForToken({
    clientId: appId,
    clientSecret,
    code,
  });

  return connectIntegration({
    provider: "NUVEMSHOP",
    credentials: {
      storeId: credencial.storeId,
      accessToken: credencial.accessToken,
      // Guardado para a tela saber de qual aplicativo veio; o secret nao vai.
      appId,
    },
    storeId,
    request,
  });
}

/** O endereco para o qual o dono vai clicar para autorizar. */
export function nuvemshopAuthorizationUrl(appId: string): string {
  return nuvemshop.authorizationUrl(appId);
}
