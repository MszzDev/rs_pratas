-- Remove o e-mail do funcionario.
--
-- A identidade passa a ser exclusivamente a matricula (RS + numeros), gerada
-- pelo sistema. As credenciais sao entregues em maos pelo dono, exibidas uma
-- unica vez na tela — nao existe mais caixa de entrada por onde uma senha
-- temporaria possa vazar, nem provedor de e-mail para configurar.
--
-- Descarta dados: os e-mails cadastrados deixam de existir. E intencional.

DROP INDEX IF EXISTS "users_companyId_email_key";

ALTER TABLE "users" DROP COLUMN IF EXISTS "email";
