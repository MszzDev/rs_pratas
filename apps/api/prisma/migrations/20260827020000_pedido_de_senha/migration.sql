-- Pedir uma senha nova, do mesmo jeito que já se pede um PIN novo.
--
-- Quem esquece a senha não tinha caminho nenhum: dependia de lembrar de pedir
-- ao dono por fora do sistema, e o dono de lembrar de gerar. Agora o pedido
-- entra na MESMA fila do PIN — o responsável vê tudo num lugar só, confere que
-- é a própria pessoa e libera.
--
-- A tabela mantém o nome que tinha. Renomeá-la seria mexer em produção por
-- estética, e o que ela guarda continua sendo a mesma coisa: um pedido de
-- credencial temporária.
CREATE TYPE "CredentialResetType" AS ENUM ('PIN', 'SENHA');

-- PIN como padrão porque é o que todas as linhas existentes são.
ALTER TABLE "pin_reset_requests"
  ADD COLUMN "type" "CredentialResetType" NOT NULL DEFAULT 'PIN';
