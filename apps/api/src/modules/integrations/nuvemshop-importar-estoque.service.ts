import type { Ator } from "../../core/ator.js";
import { prisma } from "../../db/prisma.js";
import { badRequest } from "../../core/errors.js";
import { audit } from "../../core/audit.service.js";
import { applyMovement } from "../stock/stock.service.js";
import * as nuvemshop from "./nuvemshop.client.js";
import { lerCredenciais } from "./integrations.service.js";

/**
 * Traz para o sistema as quantidades que já existem no site.
 *
 * A sincronia normal vai no outro sentido: o sistema é a verdade e publica no
 * site. Só que na estreia essa verdade não existia — as 668 peças entraram com
 * saldo zero, enquanto a loja online já vinha sendo mantida à mão e tem os
 * números certos.
 *
 * Nesse estado, publicar zeraria a vitrine inteira. E contar 668 peças na mão
 * para alimentar o sistema é trabalho de dias que já está feito do outro lado.
 *
 * Então, **uma vez**, o site é a origem. Depois disso o sentido se inverte para
 * sempre e o sistema passa a mandar.
 *
 * ## Por que passa por movimento de estoque
 *
 * Poderia escrever direto no saldo, que seria mais rápido. Mas saldo que muda
 * sem movimento é saldo sem explicação: daqui a três meses ninguém vai saber por
 * que a peça tinha 4 e passou a ter 7, e a contagem seguinte vai brigar com um
 * número que ninguém consegue justificar.
 *
 * Cada ajuste vira um movimento com o motivo escrito.
 */

export interface DiferencaDeEstoque {
  sku: string;
  peca: string;
  aqui: number;
  noSite: number;
}

export interface ResultadoDaImportacao {
  /** Verdadeiro quando só simulou, sem gravar. */
  simulacao: boolean;
  loja: string;
  variantesNoSite: number;
  /** Peças cujo saldo aqui já bate com o do site. */
  jaIguais: number;
  diferencas: DiferencaDeEstoque[];
  semCadastro: Array<{ sku: string; peca: string; noSite: number }>;
  /** Códigos que existem em mais de uma linha de estoque, e por isso ficaram de fora. */
  codigosRepetidos: string[];
  /** Só quando aplicado. */
  ajustadas: number;
}

export async function importarEstoqueDaNuvemshop(params: {
  ator: Ator;
  aplicar: boolean;
}): Promise<ResultadoDaImportacao> {
  const { ator, aplicar } = params;

  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId: ator.companyId, provider: "NUVEMSHOP" } },
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
      "Escolha qual loja alimenta o site — é o estoque dela que vai receber as quantidades.",
    );
  }

  const loja = await prisma.store.findUnique({
    where: { id: integration.storeId },
    select: { name: true },
  });

  const credenciais = lerCredenciais(integration.credentialsEncrypted);
  const conta = { storeId: credenciais.storeId!, accessToken: credenciais.accessToken! };

  /** O saldo de cada código nesta loja, para comparar sem uma consulta por peça. */
  const nossoEstoque = await prisma.stockItem.findMany({
    where: { storeId: integration.storeId, product: { deletedAt: null } },
    select: {
      quantity: true,
      productId: true,
      variationId: true,
      product: { select: { sku: true, name: true, externalId: true } },
      variation: { select: { sku: true } },
    },
  });

  /**
   * A peça é reencontrada pelo identificador da variação no site, e só depois
   * pelo código.
   *
   * A loja virtual não preenche SKU: a importação de produtos já lida com isso
   * gerando um código `NS-<id da variação>` e guardando o `externalId`. Procurar
   * só por SKU, então, não acharia nada — o código que existe aqui foi
   * inventado aqui, e não existe do outro lado.
   */
  const porExterno = new Map<string, (typeof nossoEstoque)[number]>();
  const porSku = new Map<string, (typeof nossoEstoque)[number]>();

  /**
   * Chaves que apontam para mais de uma linha de estoque.
   *
   * Acontece quando uma variação ficou sem código próprio e herdou o do
   * produto. O site tem um número só para essa chave, e não há como saber a
   * qual das linhas ele pertence — gravar na primeira que apareceu seria
   * inventar uma resposta. Fica de fora, e a lista diz quais são.
   */
  const repetidos = new Set<string>();

  for (const item of nossoEstoque) {
    if (item.product.externalId) {
      if (porExterno.has(item.product.externalId)) repetidos.add(item.product.externalId);
      porExterno.set(item.product.externalId, item);
    }

    const sku = item.variation?.sku ?? item.product.sku;
    if (porSku.has(sku)) repetidos.add(sku);
    porSku.set(sku, item);
  }

  const resultado: ResultadoDaImportacao = {
    simulacao: !aplicar,
    loja: loja?.name ?? "",
    variantesNoSite: 0,
    jaIguais: 0,
    diferencas: [],
    semCadastro: [],
    codigosRepetidos: [],
    ajustadas: 0,
  };

  let pagina = 1;

  for (;;) {
    const produtos = await nuvemshop.listProducts(conta, pagina);
    if (produtos.length === 0) break;

    for (const produto of produtos) {
      for (const variante of produto.variants) {
        /**
         * O identificador da variação no site é a chave principal, e ele sempre
         * existe. O SKU é a segunda tentativa, para a peça que foi cadastrada
         * aqui primeiro e depois ganhou par lá.
         */
        const chave = String(variante.id);
        const skuNoSite = variante.sku?.trim() || null;

        resultado.variantesNoSite += 1;

        /**
         * Estoque nulo no site significa "não controlo estoque desta peça", e
         * não "tenho zero". Tratar como zero apagaria o saldo de peças que a
         * loja vende sem controle — e apagar saldo é o oposto do que este
         * import existe para fazer.
         */
        if (variante.stock === null || variante.stock === undefined) continue;

        const noSite = Math.max(0, Number(variante.stock));

        const nosso = porExterno.get(chave) ?? (skuNoSite ? porSku.get(skuNoSite) : undefined);

        // O código que aparece na tela é o daqui quando a peça existe, e o do
        // site quando não existe — nos dois casos, o que a pessoa consegue
        // procurar.
        const sku = nosso?.variation?.sku ?? nosso?.product.sku ?? skuNoSite ?? `NS-${chave}`;

        if (repetidos.has(chave) || (skuNoSite !== null && repetidos.has(skuNoSite))) {
          resultado.codigosRepetidos.push(sku);
          continue;
        }

        if (!nosso) {
          resultado.semCadastro.push({
            sku,
            peca: nuvemshop.nomeDe(produto.name),
            noSite,
          });
          continue;
        }

        if (nosso.quantity === noSite) {
          resultado.jaIguais += 1;
          continue;
        }

        resultado.diferencas.push({
          sku,
          peca: nosso.product.name,
          aqui: nosso.quantity,
          noSite,
        });

        if (!aplicar) continue;

        const diferenca = noSite - nosso.quantity;

        await prisma.$transaction(async (tx) => {
          await applyMovement(tx, {
            companyId: ator.companyId,
            storeId: integration.storeId!,
            productId: nosso.productId,
            variationId: nosso.variationId,
            /**
             * O tipo diz o que aconteceu, e o sinal sai dele.
             *
             * Para cima é `AJUSTE`: acerto de contagem, não compra de
             * fornecedor. Para baixo é `SAIDA` e não `PERDA` — o site ter menos
             * do que o sistema não prova que a peça sumiu, prova só que o
             * número daqui estava errado, e registrar como perda mancharia o
             * relatório de quebra com peça que nunca se perdeu.
             */
            type: diferenca > 0 ? "AJUSTE" : "SAIDA",
            quantity: Math.abs(diferenca),
            userId: ator.userId ?? undefined,
            reason: `Quantidade trazida da loja online (tinha ${nosso.quantity}, site diz ${noSite})`,
            referenceType: "NUVEMSHOP_IMPORT",
            referenceId: chave,
          });
        });

        resultado.ajustadas += 1;
      }
    }

    pagina += 1;
    // Trava: catálogo grande não vira laço infinito por um erro de paginação
    // do outro lado.
    if (pagina > 25) break;
  }

  if (aplicar) {
    await audit(ator.request, {
      action: "SETTING_UPDATE",
      result: "SUCCESS",
      userId: ator.userId,
      companyId: ator.companyId,
      storeId: integration.storeId,
      userRoleSnapshot: ator.role,
      entityType: "Integration",
      entityId: integration.id,
      reason: "quantidades trazidas da loja online para o estoque",
      metadata: {
        ajustadas: resultado.ajustadas,
        jaIguais: resultado.jaIguais,
        semCadastro: resultado.semCadastro.length,
        codigosRepetidos: resultado.codigosRepetidos.length,
      },
    });
  }

  return resultado;
}
