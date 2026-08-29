import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest } from "../../core/errors.js";
import * as nuvemshop from "./nuvemshop.client.js";

/**
 * Traz o catálogo e os clientes da loja virtual para o ERP.
 *
 * O casamento é sempre pelo SKU (produtos) e pelo telefone (clientes) — as
 * mesmas chaves que a loja já usa no balcão. Isso torna a importação
 * REPETÍVEL: rodar de novo atualiza o que mudou em vez de duplicar tudo, o que
 * importa porque ninguém acerta a importação na primeira tentativa.
 *
 * O que existe aqui e não lá é preservado. O ERP guarda coisas que o site não
 * conhece — custo, peso, estoque por loja — e uma importação que sobrescreve
 * esses campos com vazio destrói informação que ninguém vai perceber que
 * sumiu até precisar dela.
 */

export interface ResultadoImportacao {
  criados: number;
  atualizados: number;
  ignorados: string[];
  total: number;
  /** Peças que não tinham código próprio e receberam um gerado pelo sistema. */
  semCodigoProprio?: number;
}

/** Só dígitos, como o cadastro de cliente guarda. */
const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

/**
 * Exportado porque a etiqueta de envio precisa das mesmas credenciais.
 *
 * Duplicar a leitura do token seria duplicar também a regra de "só quando a
 * integração está CONECTADA" — e é o tipo de regra que uma das cópias esquece.
 */
export async function credenciaisDaNuvemshop(companyId: string) {
  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId, provider: "NUVEMSHOP" } },
  });

  if (!integration || integration.status !== "CONECTADA" || !integration.credentialsEncrypted) {
    throw badRequest(
      "INTEGRATION_NOT_CONNECTED",
      "Conecte a Nuvemshop antes de importar. Configurações → Integrações.",
    );
  }

  const { decryptSecret } = await import("../../core/security/crypto.js");
  const credenciais = JSON.parse(decryptSecret(integration.credentialsEncrypted)) as Record<
    string,
    string
  >;

  return {
    integration,
    conta: { storeId: credenciais.storeId!, accessToken: credenciais.accessToken! },
  };
}

/**
 * Importa o catálogo.
 *
 * Cada variação da Nuvemshop vira uma peça aqui. Variação sem SKU recebe um
 * código gerado a partir do identificador dela lá — a loja virtual não obriga
 * ninguém a preencher SKU, e exigir isso aqui descartava o catálogo inteiro.
 *
 * A peça é reencontrada pelo identificador de origem, não pelo código: assim
 * quem trocar o código por um próprio depois não vê a peça ser duplicada na
 * importação seguinte.
 */
export async function importProductsFromNuvemshop(params: {
  request: FastifyRequest;
}): Promise<ResultadoImportacao> {
  const { request } = params;
  const { integration, conta } = await credenciaisDaNuvemshop(request.user.companyId);

  let criados = 0;
  let atualizados = 0;
  const ignorados: string[] = [];
  let total = 0;
  /** Quantas peças de lá não tinham código próprio e receberam um gerado. */
  let semCodigoProprio = 0;
  let pagina = 1;

  for (;;) {
    const produtos = await nuvemshop.listProducts(conta, pagina);
    if (produtos.length === 0) break;

    for (const produto of produtos) {
      const nome = nuvemshop.nomeDe(produto.name);

      /**
       * A primeira foto da peça, na ordem em que aparece na loja virtual.
       *
       * É o endereço que fica guardado, não o arquivo: as fotos já estão
       * publicadas lá, e baixá-las encheria o disco do servidor — que no plano
       * gratuito é apagado a cada publicação, levando as fotos junto.
       */
      const foto = [...(produto.images ?? [])].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      )[0]?.src;

      for (const variante of produto.variants) {
        total += 1;

        const externalId = String(variante.id);

        /**
         * O código da peça.
         *
         * A loja virtual não obriga ninguém a preencher SKU, e a desta loja
         * não preenche: das 668 variações, nenhuma tinha código. Exigir o SKU
         * fazia a importação inteira ser descartada em silêncio — "0 de 668".
         *
         * Então o sistema gera um: `NS-` mais o identificador da variação lá.
         * É estável (a mesma peça sempre recebe o mesmo código), único, e cabe
         * numa etiqueta com código de barras. Quem quiser trocar por um código
         * próprio depois, troca — a importação seguinte reencontra a peça pelo
         * identificador, não pelo SKU.
         */
        const sku = variante.sku?.trim() || `NS-${externalId}`;
        const geradoAqui = !variante.sku?.trim();

        if (geradoAqui) semCodigoProprio += 1;

        const preco = variante.price ? Number(variante.price) : null;

        const existente = await prisma.product.findFirst({
          where: {
            companyId: request.user.companyId,
            deletedAt: null,
            OR: [{ externalId }, { sku }],
          },
        });

        if (existente) {
          // Só nome, preço de venda e foto: custo, peso e categoria são
          // conhecimento do ERP que a loja virtual não tem.
          await prisma.product.update({
            where: { id: existente.id },
            data: {
              name: nome || existente.name,
              externalId,
              ...(preco !== null ? { salePrice: preco } : {}),
              // Foto enviada pelo sistema tem precedência: quem fotografou a
              // peça no balcão fez isso por um motivo, e a importação não
              // desfaz esse trabalho.
              ...(foto && !existente.imageStorageKey ? { imageExternalUrl: foto } : {}),
            },
          });
          atualizados += 1;
          continue;
        }

        await prisma.product.create({
          data: {
            companyId: request.user.companyId,
            sku,
            externalId,
            name: nome || sku,
            salePrice: preco ?? 0,
            // Custo zero e não nulo: o campo é obrigatório para a margem, e
            // zero é honesto — diz "ainda não sabemos", em vez de inventar.
            costPrice: 0,
            ...(foto ? { imageExternalUrl: foto } : {}),
          },
        });
        criados += 1;
      }
    }

    pagina += 1;
    // Trava contra erro de paginação do outro lado virar laço infinito.
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
    reason: "produtos importados da Nuvemshop",
    metadata: { criados, atualizados, ignorados: ignorados.length, total, semCodigoProprio },
  });

  return { criados, atualizados, ignorados: ignorados.slice(0, 50), total, semCodigoProprio };
}

/**
 * Importa os clientes que já compraram no site.
 *
 * A Nuvemshop não expõe uma lista de clientes independente dos pedidos, então
 * eles saem dos pedidos — que é justamente quem interessa: quem comprou, não
 * quem se cadastrou e sumiu.
 *
 * Sem telefone o cliente é ignorado. O telefone é a chave do cadastro aqui, e
 * um cliente sem ele viraria uma linha impossível de reencontrar no balcão.
 */
export async function importCustomersFromNuvemshop(params: {
  request: FastifyRequest;
}): Promise<ResultadoImportacao> {
  const { request } = params;
  const { integration, conta } = await credenciaisDaNuvemshop(request.user.companyId);

  const pedidos = await nuvemshop.listOrders(conta);

  let criados = 0;
  let atualizados = 0;
  const ignorados: string[] = [];

  for (const pedido of pedidos) {
    const nome = pedido.customer?.name ?? pedido.contact_name ?? "";
    const telefone = somenteDigitos(pedido.customer?.phone ?? pedido.contact_phone ?? "");

    if (!nome || telefone.length < 10) {
      ignorados.push(`pedido #${pedido.number} (sem nome ou telefone)`);
      continue;
    }

    const existente = await prisma.customer.findFirst({
      where: { companyId: request.user.companyId, phone: telefone, deletedAt: null },
    });

    if (existente) {
      // O e-mail é o único campo que a loja virtual costuma ter mais completo
      // que o balcão — e só preenche se aqui estiver vazio.
      if (!existente.email && pedido.customer?.email) {
        await prisma.customer.update({
          where: { id: existente.id },
          data: { email: pedido.customer.email },
        });
        atualizados += 1;
      }
      continue;
    }

    await prisma.customer.create({
      data: {
        companyId: request.user.companyId,
        name: nome,
        phone: telefone,
        ...(pedido.customer?.email ? { email: pedido.customer.email } : {}),
      },
    });
    criados += 1;
  }

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Integration",
    entityId: integration.id,
    reason: "clientes importados da Nuvemshop",
    metadata: { criados, atualizados, ignorados: ignorados.length },
  });

  return {
    criados,
    atualizados,
    ignorados: ignorados.slice(0, 50),
    total: pedidos.length,
  };
}
