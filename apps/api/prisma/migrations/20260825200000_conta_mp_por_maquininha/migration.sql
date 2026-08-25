-- Conta do Mercado Pago por maquininha.
--
-- A loja contratou uma conta por aparelho, e é em cada uma delas que o
-- dinheiro daquela maquininha cai. Com uma credencial única da empresa, o
-- sistema consultaria a conta errada: o pagamento existiria na maquininha e
-- apareceria como "não encontrado" na conferência do caixa.
--
-- Tudo opcional: as maquininhas já cadastradas continuam funcionando sem conta
-- informada — elas cobram do mesmo jeito, só não são consultadas nem estornadas
-- pelo sistema até alguém colar o token.
ALTER TABLE "payment_terminals"
  ADD COLUMN "mpAccountLabel" TEXT,
  ADD COLUMN "mpExternalAccountId" TEXT,
  ADD COLUMN "credentialsEncrypted" TEXT,
  ADD COLUMN "credentialsUpdatedAt" TIMESTAMP(3);
