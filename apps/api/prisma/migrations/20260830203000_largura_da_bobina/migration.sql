-- A largura TOTAL da bobina, com a borda de papel exposto dos dois lados.
--
-- Precisa bater exatamente com o papel configurado no driver. Quando nao bate,
-- o navegador escala a pagina inteira para caber, e o desenho sai menor e
-- deslocado -- sem aviso nenhum, o que torna o problema dificil de enxergar.
--
-- Zero significa "calcule pelas colunas", o certo quando nao ha borda.

ALTER TABLE "label_templates"
  ADD COLUMN "rollWidthMm" DECIMAL(6,2) NOT NULL DEFAULT 0;
