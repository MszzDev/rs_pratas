-- Horário anunciado da loja, por dia da semana mais feriado.
--
-- Diferente de `isOpen`, que diz se ela está aberta agora: um é o que a placa
-- na porta promete, o outro é o que o tablet registrou no primeiro login do
-- dia. Guardado como JSON porque os oito dias só são lidos juntos — oito
-- colunas de horário existiriam apenas para serem selecionadas em bloco.
ALTER TABLE "stores" ADD COLUMN "openingHours" JSONB;
