-- Uma contagem por produto-sem-variacao dentro do mesmo inventario.
--
-- Mesma armadilha de stock_items: no Postgres NULL nunca e igual a NULL, entao
-- o indice unico com variationId nulo nao impede linhas duplicadas. Duas
-- contagens do mesmo produto fariam o fechamento ajustar o estoque duas vezes.
CREATE UNIQUE INDEX "inventory_counts_no_variation_unique"
  ON "inventory_counts"("inventoryId", "productId")
  WHERE "variationId" IS NULL;
