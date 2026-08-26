-- Identificador da peça no serviço de origem (a variação, na Nuvemshop).
--
-- É por ele que a importação reencontra a mesma peça na vez seguinte. Sem ele,
-- a única chave seria o SKU — e a loja virtual não preenche SKU, o que fazia a
-- importação inteira ser descartada: 668 variações encontradas, nenhuma
-- importada, todas "sem código".
ALTER TABLE "products" ADD COLUMN "externalId" TEXT;

-- Uma peça de lá é uma peça aqui: importar duas vezes atualiza, não duplica.
CREATE UNIQUE INDEX "products_companyId_externalId_key"
  ON "products" ("companyId", "externalId");
