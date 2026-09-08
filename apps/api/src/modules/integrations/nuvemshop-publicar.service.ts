import { prisma } from "../../db/prisma.js";
import { logger } from "../../core/logger.js";
import * as nuvemshop from "./nuvemshop.client.js";
import { lerCredenciais } from "./integrations.service.js";

/**
 * A venda do balcão atualizando a vitrine da loja online.
 *
 * A Nuvemshop publica o estoque de **uma** loja, a do Jardim Ângela, porque é
 * de lá que as peças vendidas pela internet saem. Então uma venda no balcão
 * daquela loja precisa aparecer no site na hora: senão alguém compra pela
 * internet uma peça que acabou de sair pela porta, paga, e descobre depois que
 * ela não existe mais.
 *
 * Venda nas outras quatro lojas não mexe em nada aqui — o estoque delas não
 * está publicado, então não há o que atualizar.
 *
 * ## Por que só as peças vendidas
 *
 * A sincronia completa varre o catálogo inteiro e leva minutos com 668
 * produtos. Rodá-la a cada venda seria caro e lento, e a vendedora estaria na
 * próxima venda muito antes de ela terminar. Aqui vão só os códigos que
 * acabaram de sair, que costumam ser um ou dois.
 */

/**
 * Atualiza no site o estoque das peças que acabaram de ser vendidas.
 *
 * Nunca lança: é chamada por trás de uma venda que **já está gravada**, e
 * derrubar a resposta da venda porque o site não respondeu seria trocar um
 * problema pequeno por um grande. A falha é registrada e a sincronia completa,
 * que roda depois, corrige o que ficou para trás.
 */
export async function publicarEstoqueDasPecasVendidas(params: {
  companyId: string;
  storeId: string;
  saleId: string;
}): Promise<void> {
  try {
    const integration = await prisma.integration.findUnique({
      where: { companyId_provider: { companyId: params.companyId, provider: "NUVEMSHOP" } },
    });

    // A venda foi noutra loja, ou o site não está ligado: nada a fazer, e isso
    // é o caso comum — quatro das cinco lojas.
    if (!integration || integration.status !== "CONECTADA") return;
    if (integration.storeId !== params.storeId) return;

    const credenciais = lerCredenciais(integration.credentialsEncrypted);
    if (!credenciais.storeId || !credenciais.accessToken) return;

    const conta = { storeId: credenciais.storeId, accessToken: credenciais.accessToken };

    const itens = await prisma.saleItem.findMany({
      where: { saleId: params.saleId },
      select: {
        productId: true,
        variationId: true,
        product: { select: { sku: true } },
        variation: { select: { sku: true } },
      },
    });

    const codigos = new Set(
      itens.map((i) => i.variation?.sku ?? i.product?.sku).filter((s): s is string => Boolean(s)),
    );

    if (codigos.size === 0) return;

    // O saldo AGORA, já com a venda descontada — é o que o site precisa saber.
    const saldos = await prisma.stockItem.findMany({
      where: {
        storeId: params.storeId,
        OR: itens.map((i) => ({
          productId: i.productId,
          variationId: i.variationId ?? null,
        })),
      },
      select: {
        quantity: true,
        reservedQuantity: true,
        product: { select: { sku: true } },
        variation: { select: { sku: true } },
      },
    });

    const disponivelPorSku = new Map<string, number>();
    for (const saldo of saldos) {
      const sku = saldo.variation?.sku ?? saldo.product.sku;
      // Peça separada para um cliente já tem dono: não pode ser vendida de novo.
      const disponivel = Math.max(0, saldo.quantity - saldo.reservedQuantity);
      disponivelPorSku.set(sku, disponivel);
    }

    /**
     * O site é procurado pelo código, e não guardado o id da variante no nosso
     * banco de propósito: o dono pode recriar um produto lá e o id muda, sem
     * ninguém avisar. O código é o que as duas pontas combinam.
     */
    let pagina = 1;
    const pendentes = new Set(codigos);

    while (pendentes.size > 0 && pagina <= 25) {
      const produtos = await nuvemshop.listProducts(conta, pagina);
      if (produtos.length === 0) break;

      for (const produto of produtos) {
        for (const variante of produto.variants) {
          if (!variante.sku || !pendentes.has(variante.sku)) continue;

          const disponivel = disponivelPorSku.get(variante.sku) ?? 0;
          pendentes.delete(variante.sku);

          if (variante.stock === disponivel) continue;

          await nuvemshop.updateVariantStock(conta, produto.id, variante.id, disponivel);
        }
      }

      pagina += 1;
    }

    if (pendentes.size > 0) {
      logger.info(
        { saleId: params.saleId, semCorrespondencia: [...pendentes] },
        "peças vendidas que não existem no site",
      );
    }
  } catch (erro) {
    /**
     * Registra e cala.
     *
     * A venda está gravada e o dinheiro entrou; o site desatualizado por alguns
     * minutos é um incômodo, não um estrago. A sincronia completa, rodada pela
     * dona ou pelo agendamento, corrige o que ficou para trás.
     */
    logger.warn(
      { err: erro, saleId: params.saleId },
      "não deu para atualizar o estoque no site depois da venda",
    );
  }
}
