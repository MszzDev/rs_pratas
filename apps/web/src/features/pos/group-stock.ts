import type { StockRow } from "./types";

export interface GroupedProduct {
  productId: string;
  name: string;
  /** SKU do produto, sem o sufixo do tamanho. */
  sku: string;
  imageChecksum: string | null;
  imageExternalUrl: string | null;
  /** Menor e maior preço entre os tamanhos — quase sempre iguais. */
  precoMin: number;
  precoMax: number;
  disponivelTotal: number;
  reservadoTotal: number;
  /** Uma linha por tamanho. Produto sem tamanho tem exatamente uma. */
  variacoes: StockRow[];
  temTamanhos: boolean;
}

/**
 * Agrupa as linhas de estoque por PEÇA.
 *
 * O estoque é por tamanho — é assim que ele precisa existir, porque o anel 16 e
 * o 22 são peças diferentes na gaveta. Mas na tela de venda isso vira quatro
 * cartões idênticos do mesmo modelo, e o vendedor rola a lista procurando o
 * nome no meio da repetição.
 *
 * Aqui a lista volta a ser uma peça por linha; o tamanho é escolhido ao tocar.
 * A ordem original é preservada dentro de cada grupo para o tamanho aparecer
 * na sequência em que a loja fala dele.
 */
export function groupByProduct(rows: StockRow[]): GroupedProduct[] {
  const grupos = new Map<string, GroupedProduct>();

  for (const row of rows) {
    const existente = grupos.get(row.productId);

    if (existente) {
      existente.variacoes.push(row);
      existente.disponivelTotal += row.availableQuantity;
      existente.reservadoTotal += row.reservedQuantity;
      existente.precoMin = Math.min(existente.precoMin, Number(row.salePrice ?? 0));
      existente.precoMax = Math.max(existente.precoMax, Number(row.salePrice ?? 0));
      existente.temTamanhos = true;
      continue;
    }

    const preco = Number(row.salePrice ?? 0);

    grupos.set(row.productId, {
      productId: row.productId,
      name: row.name,
      // O SKU da variação é "AN-1002-16"; o da peça é o que vem antes do
      // tamanho. Cortar pelo sufixo evita depender de uma segunda consulta só
      // para descobrir o código do produto.
      sku: row.size ? row.sku.replace(new RegExp(`-${row.size}$`), "") : row.sku,
      imageChecksum: row.imageChecksum,
      imageExternalUrl: row.imageExternalUrl,
      precoMin: preco,
      precoMax: preco,
      disponivelTotal: row.availableQuantity,
      reservadoTotal: row.reservedQuantity,
      variacoes: [row],
      temTamanhos: row.size !== null,
    });
  }

  return [...grupos.values()];
}
