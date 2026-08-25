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
}

/** Só dígitos, como o cadastro de cliente guarda. */
const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

async function credenciaisDaNuvemshop(companyId: string) {
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
 * Cada variação da Nuvemshop vira uma peça aqui. Uma variação SEM SKU é
 * ignorada e devolvida na lista: sem código, não há como reencontrá-la numa
 * próxima importação, e importar às cegas criaria uma peça nova a cada
 * execução.
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
  let pagina = 1;

  for (;;) {
    const produtos = await nuvemshop.listProducts(conta, pagina);
    if (produtos.length === 0) break;

    for (const produto of produtos) {
      const nome = nuvemshop.nomeDe(produto.name);

      for (const variante of produto.variants) {
        total += 1;

        if (!variante.sku) {
          ignorados.push(`${nome} (variação sem código)`);
          continue;
        }

        const preco = variante.price ? Number(variante.price) : null;

        const existente = await prisma.product.findFirst({
          where: { companyId: request.user.companyId, sku: variante.sku, deletedAt: null },
        });

        if (existente) {
          // Só nome e preço de venda: custo, peso e categoria são conhecimento
          // do ERP que a loja virtual não tem.
          await prisma.product.update({
            where: { id: existente.id },
            data: {
              name: nome || existente.name,
              ...(preco !== null ? { salePrice: preco } : {}),
            },
          });
          atualizados += 1;
          continue;
        }

        await prisma.product.create({
          data: {
            companyId: request.user.companyId,
            sku: variante.sku,
            name: nome || variante.sku,
            salePrice: preco ?? 0,
            // Custo zero e não nulo: o campo é obrigatório para a margem, e
            // zero é honesto — diz "ainda não sabemos", em vez de inventar.
            costPrice: 0,
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
    metadata: { criados, atualizados, ignorados: ignorados.length, total },
  });

  return { criados, atualizados, ignorados: ignorados.slice(0, 50), total };
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
