-- Contato da loja. Vai no comprovante: o cliente precisa saber onde reclamar
-- da peca que comprou naquela loja, nao no e-mail da empresa.
ALTER TABLE "stores" ADD COLUMN "email" TEXT;
