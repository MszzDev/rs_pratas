-- Maquininha principal x reserva.
ALTER TABLE "payment_terminals" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "payment_terminals_cashRegisterId_idx" ON "payment_terminals"("cashRegisterId");

-- Uma unica principal por caixa, garantido pelo banco.
--
-- A regra tambem existe no servico, mas duas requisicoes simultaneas do dono
-- passariam pelas duas verificacoes antes de qualquer uma gravar. Aqui a
-- segunda falha. Terminais aposentados e apagados ficam de fora do indice:
-- eles nao disputam o posto de principal.
CREATE UNIQUE INDEX "payment_terminals_one_primary_per_register"
  ON "payment_terminals"("cashRegisterId")
  WHERE "isPrimary" = true AND "deletedAt" IS NULL AND "status" <> 'RETIRED';
