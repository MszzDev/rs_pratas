-- Um saldo por produto-sem-variacao por loja.
--
-- O indice unico gerado pelo Prisma (storeId, productId, variationId) NAO cobre
-- este caso: no Postgres, NULL nunca e igual a NULL, entao duas linhas com
-- variationId nulo para o mesmo produto e a mesma loja passariam as duas. O
-- resultado seria estoque dividido em dois saldos paralelos, cada um contando
-- uma parte das pecas — o tipo de bug que so aparece quando falta mercadoria.
CREATE UNIQUE INDEX "stock_items_store_product_no_variation"
  ON "stock_items"("storeId", "productId")
  WHERE "variationId" IS NULL;
