-- Quanto da etiqueta serve para escrever, quando nao e ela inteira.
--
-- Etiqueta de joia tem um "rabo" estreito que enrola na argola: nos 90 mm do
-- rolo da loja, so os primeiros 50 recebem informacao, e os 30 finais
-- desaparecem quando a peca e pendurada.
--
-- Zero significa "a etiqueta inteira serve", que e o caso comum e mantem o
-- comportamento dos modelos que ja existem.

ALTER TABLE "label_templates"
  ADD COLUMN "printableWidthMm" DECIMAL(6,2) NOT NULL DEFAULT 0;
