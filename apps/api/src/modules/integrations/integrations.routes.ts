import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { assertPermission, requirePermission } from "../../core/rbac/require-permission.hook.js";
import { prisma } from "../../db/prisma.js";
import {
  connectIntegration,
  disconnectIntegration,
  listEvents,
  listIntegrations,
  recordEvent,
  completeNuvemshopAuthorization,
  nuvemshopAuthorizationUrl,
  syncStockToNuvemshop,
  testIntegration,
} from "./integrations.service.js";
import {
  importCustomersFromNuvemshop,
  importProductsFromNuvemshop,
} from "./nuvemshop-import.service.js";

const providerParam = z.object({
  provider: z.enum(["NUVEMSHOP", "MERCADOPAGO", "REDE"]),
});

/**
 * A permissão certa para cada serviço — o catálogo já tinha uma por
 * integração, então quem libera a Nuvemshop para alguém não libera junto o
 * acesso à conta de pagamentos.
 */
const PERMISSAO = {
  NUVEMSHOP: "INTEGRATION_NUVEMSHOP",
  MERCADOPAGO: "INTEGRATION_MERCADOPAGO",
  REDE: "INTEGRATION_REDE",
} as const;

export async function integrationRoutes(app: FastifyInstance) {
  app.get(
    "/integrations",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => listIntegrations(request),
  );

  app.post(
    "/integrations/:provider/connect",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => {
      const { provider } = providerParam.parse(request.params);

      // Confere a permissão específica do serviço, além da geral.
      await assertPermission(request, PERMISSAO[provider]);

      const body = z
        .object({
          storeId: z.string().uuid().optional(),
          credentials: z.record(z.string()),
        })
        .parse(request.body);

      return connectIntegration({
        provider,
        credentials: body.credentials,
        storeId: body.storeId,
        request,
      });
    },
  );

  app.post(
    "/integrations/:provider/test",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => {
      const { provider } = providerParam.parse(request.params);
      return testIntegration({ provider, request });
    },
  );

  app.delete(
    "/integrations/:provider",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => {
      const { provider } = providerParam.parse(request.params);
      return disconnectIntegration({ provider, request });
    },
  );

  app.post(
    "/integrations/nuvemshop/sync-stock",
    { preHandler: [app.requireAuth, requirePermission("INTEGRATION_NUVEMSHOP")] },
    async (request) => syncStockToNuvemshop({ request }),
  );

  app.get(
    "/integrations/events",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => {
      const query = z
        .object({ provider: z.enum(["NUVEMSHOP", "MERCADOPAGO", "REDE"]).optional() })
        .parse(request.query);

      return listEvents({ request, ...query });
    },
  );


  /**
   * Onde o dono autoriza o aplicativo na loja dele.
   *
   * A Nuvemshop nao entrega token pelo painel: o que ela mostra e o par
   * aplicativo + chave secreta. O token so nasce depois que o lojista
   * autoriza, e e por isso que este passo existe.
   */
  app.get(
    "/integrations/nuvemshop/authorize-url",
    { preHandler: [app.requireAuth, requirePermission("INTEGRATION_NUVEMSHOP")] },
    async (request) => {
      const { appId } = z.object({ appId: z.string().min(1) }).parse(request.query);
      return { url: nuvemshopAuthorizationUrl(appId) };
    },
  );

  app.post(
    "/integrations/nuvemshop/authorize",
    { preHandler: [app.requireAuth, requirePermission("INTEGRATION_NUVEMSHOP")] },
    async (request) => {
      const body = z
        .object({
          appId: z.string().min(1),
          clientSecret: z.string().min(1),
          code: z.string().min(1),
          storeId: z.string().uuid().optional(),
        })
        .parse(request.body);

      return completeNuvemshopAuthorization({ ...body, request });
    },
  );


  /**
   * Traz o catalogo da loja virtual para o ERP.
   *
   * Separado da sincronizacao de estoque de proposito: um manda dados para la,
   * o outro traz de la. Juntar os dois num botao so faria o dono disparar uma
   * escrita quando queria uma leitura.
   */
  app.post(
    "/integrations/nuvemshop/import-products",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_CREATE")] },
    async (request) => importProductsFromNuvemshop({ request }),
  );

  app.post(
    "/integrations/nuvemshop/import-customers",
    { preHandler: [app.requireAuth, requirePermission("CUSTOMER_CREATE")] },
    async (request) => importCustomersFromNuvemshop({ request }),
  );

  // ------------------------------------------------------------- webhooks
  //
  // Sem autenticação de sessão: quem chama é o serviço externo, que não tem
  // login aqui. A defesa é outra — o evento é só GRAVADO, nunca confiado. O
  // que ele diz é conferido depois contra a API do próprio serviço, usando o
  // nosso token. Assim, um terceiro que descubra a URL consegue no máximo
  // encher a fila de eventos falsos, nunca criar uma venda.

  /**
   * Responde 200 imediatamente, sempre.
   *
   * Serviço de webhook reenvia quando não recebe 200 rápido — e reenvio em
   * cima de processamento lento vira evento duplicado. Guardar e responder é
   * a ordem certa; processar vem depois.
   */
  app.post("/integrations/nuvemshop/webhook/:companyId", async (request, reply) => {
    const { companyId } = z.object({ companyId: z.string().uuid() }).parse(request.params);
    const corpo = request.body as { event?: string; id?: number | string } | null;

    await recordEvent({
      provider: "NUVEMSHOP",
      companyId,
      topic: corpo?.event ?? "desconhecido",
      externalId: corpo?.id !== undefined ? String(corpo.id) : null,
      payload: corpo ?? {},
    });

    return reply.status(200).send({ recebido: true });
  });

  app.post("/integrations/mercadopago/webhook/:companyId", async (request, reply) => {
    const { companyId } = z.object({ companyId: z.string().uuid() }).parse(request.params);
    const corpo = request.body as
      | { type?: string; action?: string; data?: { id?: string } }
      | null;

    await recordEvent({
      provider: "MERCADOPAGO",
      companyId,
      topic: corpo?.type ?? corpo?.action ?? "desconhecido",
      externalId: corpo?.data?.id ?? null,
      payload: corpo ?? {},
    });

    return reply.status(200).send({ recebido: true });
  });

  /**
   * Retorno do OAuth do Mercado Pago.
   *
   * Chega pelo navegador do dono, não por chamada de servidor — por isso
   * responde HTML e não JSON: quem lê é uma pessoa, numa aba que acabou de
   * voltar do Mercado Pago.
   */
  app.get("/integrations/mercadopago/callback", async (request, reply) => {
    const query = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() })
      .parse(request.query);

    const pagina = (titulo: string, mensagem: string) =>
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
       <title>${titulo}</title>
       <style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;
       min-height:100vh;background:#F8F7F7;color:#262323}div{max-width:32rem;padding:2rem;
       background:#fff;border-radius:.75rem;box-shadow:0 18px 45px rgba(38,35,35,.07);text-align:center}
       h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#6F6868;line-height:1.5;margin:0}</style></head>
       <body><div><h1>${titulo}</h1><p>${mensagem}</p></div></body></html>`;

    reply.header("Content-Type", "text/html; charset=utf-8");

    if (query.error || !query.code) {
      return reply
        .status(400)
        .send(
          pagina(
            "Autorização não concluída",
            "O Mercado Pago não devolveu o código. Volte às Configurações e tente conectar de novo.",
          ),
        );
    }

    // O código sozinho não conecta nada: a troca por token exige o
    // client_secret, que só o dono informa na tela de Integrações. Guardá-lo
    // aqui e deixar a tela concluir evita que este endereço público vire um
    // caminho para conectar contas sem passar pela autenticação.
    await prisma.integrationEvent
      .create({
        data: {
          integrationId: (
            await prisma.integration.findFirstOrThrow({ where: { provider: "MERCADOPAGO" } })
          ).id,
          companyId: (await prisma.company.findFirstOrThrow({ where: { deletedAt: null } })).id,
          topic: "oauth_code",
          externalId: query.code.slice(0, 60),
          payload: { code: query.code, state: query.state ?? null },
        },
      })
      .catch(() => undefined);

    return reply.send(
      pagina(
        "Autorização recebida",
        "Pode fechar esta aba e voltar ao RS Pratas para concluir a conexão em Configurações → Integrações.",
      ),
    );
  });
}
