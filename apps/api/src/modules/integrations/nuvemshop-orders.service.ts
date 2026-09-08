import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { badRequest } from "../../core/errors.js";
import { audit } from "../../core/audit.service.js";
import { applyMovement } from "../stock/stock.service.js";
import * as nuvemshop from "./nuvemshop.client.js";
import { lerCredenciais } from "./integrations.service.js";

/**
 * O pedido da loja online dando baixa no estoque da loja física.
 *
 * A vitrine da Nuvemshop não representa a rede: ela reflete **uma** loja, a do
 * Jardim Ângela, que é de onde as peças vendidas online saem. Então uma venda
 * no site tira a peça de lá, e não de um estoque consolidado que não existe na
 * operação real.
 *
 * ## Por que isso importa mais do que parece
 *
 * Estoque de joalheria é peça única com frequência: uma aliança específica, num
 * tamanho específico. Sem esta baixa, a mesma peça continua à venda no balcão
 * depois de vendida pela internet — e os dois erros só aparecem semanas
 * depois, na contagem. O cliente que ficar sem a peça descobre antes.
 *
 * ## Nada é desfeito sozinho
 *
 * Quando a peça já acabou no Jardim Ângela, o pedido **não** é cancelado e o
 * estoque **não** fica negativo: o evento é marcado com o motivo e aparece para
 * a dona resolver. Cancelar um pedido pago por conta própria, ou vender peça
 * que não existe, são dois estragos maiores que o aviso.
 */

/** Só pedido pago vira baixa. Carrinho abandonado não tira peça da prateleira. */
const PAGOS = ["paid", "authorized", "partially_paid"];

/** Pedido cancelado ou devolvido nunca deve baixar, mesmo que tenha sido pago. */
const MORTOS = ["cancelled", "canceled", "refunded", "voided"];

export interface ResultadoDaSincronia {
  pedidosLidos: number;
  pedidosNovos: number;
  pecasBaixadas: number;
  semEstoque: Array<{ pedido: number; sku: string; peca: string; faltam: number }>;
  semCadastro: Array<{ pedido: number; sku: string | null; peca: string }>;
}

/**
 * Busca os pedidos novos do site e baixa o estoque de cada um.
 *
 * A idempotência vem do banco, não de controle em memória: cada pedido vira um
 * `IntegrationEvent` com o id dele como `externalId`, e a chave única impede
 * que o mesmo pedido baixe duas vezes. É a proteção que importa aqui — rodar
 * de novo depois de uma falha de rede não pode tirar a peça duas vezes.
 */
export async function baixarPedidosDaNuvemshop(params: {
  request: FastifyRequest;
}): Promise<ResultadoDaSincronia> {
  const { request } = params;

  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId: request.user.companyId, provider: "NUVEMSHOP" } },
  });

  if (!integration || integration.status !== "CONECTADA") {
    throw badRequest(
      "INTEGRATION_NOT_CONNECTED",
      "A Nuvemshop ainda não está conectada. Configure em Configurações → Integrações.",
    );
  }

  if (!integration.storeId) {
    throw badRequest(
      "STORE_NOT_CHOSEN",
      "Escolha qual loja alimenta o site — é o estoque dela que a venda online baixa.",
    );
  }

  const credenciais = lerCredenciais(integration.credentialsEncrypted);
  const conta = { storeId: credenciais.storeId!, accessToken: credenciais.accessToken! };

  /**
   * De onde retomar.
   *
   * Uma folga de um dia para trás cobre pedido que chegou enquanto a
   * sincronia anterior rodava, e pedido cujo pagamento só foi confirmado
   * depois de criado. Reprocessar é barato — a chave única descarta o
   * repetido —, enquanto perder um pedido custa uma peça vendida duas vezes.
   */
  const desde = integration.lastOrderSyncAt
    ? new Date(integration.lastOrderSyncAt.getTime() - 24 * 60 * 60 * 1000)
    : undefined;

  const pedidos = await nuvemshop.listOrders(conta, desde);

  const resultado: ResultadoDaSincronia = {
    pedidosLidos: pedidos.length,
    pedidosNovos: 0,
    pecasBaixadas: 0,
    semEstoque: [],
    semCadastro: [],
  };

  for (const pedido of pedidos) {
    const pago = PAGOS.includes(pedido.payment_status?.toLowerCase() ?? "");
    const morto = MORTOS.includes(pedido.status?.toLowerCase() ?? "");
    if (!pago || morto) continue;

    // A chave única (integrationId + externalId) é quem garante "uma vez só".
    // Tentar criar e tratar a colisão é mais seguro que consultar antes: entre
    // a consulta e a escrita cabe outra execução da sincronia.
    let evento;
    try {
      evento = await prisma.integrationEvent.create({
        data: {
          integrationId: integration.id,
          companyId: request.user.companyId,
          externalId: String(pedido.id),
          topic: "order/paid",
          payload: pedido as unknown as object,
        },
      });
    } catch (erro) {
      if ((erro as { code?: string }).code === "P2002") continue; // já processado
      throw erro;
    }

    resultado.pedidosNovos += 1;

    const problemas: string[] = [];

    for (const item of pedido.products) {
      if (!item.sku) {
        resultado.semCadastro.push({ pedido: pedido.number, sku: null, peca: item.name });
        problemas.push(`"${item.name}" veio sem código`);
        continue;
      }

      const peca = await acharPelaSku(request.user.companyId, item.sku);

      if (!peca) {
        resultado.semCadastro.push({ pedido: pedido.number, sku: item.sku, peca: item.name });
        problemas.push(`código ${item.sku} não existe no sistema`);
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          await applyMovement(tx, {
            companyId: request.user.companyId,
            storeId: integration.storeId!,
            productId: peca.productId,
            variationId: peca.variationId,
            type: "VENDA",
            quantity: item.quantity,
            userId: request.user.sub,
            reason: `Pedido ${pedido.number} da loja online`,
            referenceType: "NUVEMSHOP_ORDER",
            referenceId: String(pedido.id),
          });
        });

        resultado.pecasBaixadas += item.quantity;
      } catch (erro) {
        /**
         * Sem saldo: o pedido fica registrado com o motivo, e a peça NÃO é
         * baixada para negativo. Estoque negativo é uma mentira que o sistema
         * conta para si mesmo, e some na contagem seguinte sem ninguém
         * perceber que houve um problema.
         */
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        resultado.semEstoque.push({
          pedido: pedido.number,
          sku: item.sku,
          peca: item.name,
          faltam: item.quantity,
        });
        problemas.push(`${item.name}: ${mensagem}`);
      }
    }

    await prisma.integrationEvent.update({
      where: { id: evento.id },
      data: {
        processedAt: new Date(),
        ...(problemas.length > 0 ? { error: problemas.join(" · ") } : {}),
      },
    });
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastOrderSyncAt: new Date() },
  });

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Integration",
    entityId: integration.id,
    reason: "pedidos da loja online baixados do estoque",
    metadata: {
      pedidosNovos: resultado.pedidosNovos,
      pecasBaixadas: resultado.pecasBaixadas,
      semEstoque: resultado.semEstoque.length,
      semCadastro: resultado.semCadastro.length,
    },
  });

  return resultado;
}

/**
 * Acha a peça pelo código que veio do site.
 *
 * O código pode ser de um produto simples ou de uma variação — no site as duas
 * coisas aparecem como "SKU da variante", e o sistema guarda em lugares
 * diferentes. Procurar nos dois evita que anel com tamanho, que é o caso mais
 * comum na joalheria, caia como "não cadastrado".
 */
async function acharPelaSku(
  companyId: string,
  sku: string,
): Promise<{ productId: string; variationId: string | null } | null> {
  const variacao = await prisma.productVariation.findFirst({
    where: { sku, product: { companyId, deletedAt: null } },
    select: { id: true, productId: true },
  });

  if (variacao) return { productId: variacao.productId, variationId: variacao.id };

  const produto = await prisma.product.findFirst({
    where: { sku, companyId, deletedAt: null },
    select: { id: true },
  });

  if (produto) return { productId: produto.id, variationId: null };

  return null;
}
