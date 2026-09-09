-- O acabamento da peca: prata, dourado, rodio, ouro rose.
--
-- Diferente do material. Uma peca pode ser prata 925 E banhada a ouro, e e o
-- banho que o cliente ve na vitrine e a vendedora usa para achar a peca na
-- gaveta. Sem isso, "anel dourado tamanho 18" nao e uma busca que o sistema
-- saiba responder.
--
-- Texto e nao enum: joalheria inventa acabamento novo com frequencia, e cada um
-- exigiria migracao.

ALTER TABLE "products" ADD COLUMN "finish" TEXT;

-- Ajuda a filtrar o lote de etiquetas por acabamento sem varrer o catalogo.
CREATE INDEX "products_companyId_finish_idx" ON "products"("companyId", "finish");
