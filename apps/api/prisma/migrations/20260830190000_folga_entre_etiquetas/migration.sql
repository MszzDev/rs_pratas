-- A folga entre uma etiqueta e a próxima no rolo.
--
-- Rolo de etiqueta não é papel contínuo: entre um recorte e o seguinte existe
-- um espaço, e a impressora avança esse espaço inteiro a cada etiqueta. Sem
-- contar com ele, o sistema empilha os desenhos colados e o erro se acumula —
-- na terceira etiqueta o texto já sai em cima do picote.
--
-- Zero é o certo para rolo contínuo, e é o padrão para não mudar o
-- comportamento dos modelos que já existem.

-- E quantas colunas o rolo tem. O modelo guarda o tamanho de UMA etiqueta,
-- que e como o dono pensa ao cadastrar; a pagina enviada a impressora precisa
-- da largura da bobina inteira, senao o navegador quebra a linha depois da
-- primeira coluna e duas de cada tres etiquetas saem em branco.

ALTER TABLE "label_templates"
  ADD COLUMN "gapXMm" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gapYMm" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "columnsPerRow" INTEGER NOT NULL DEFAULT 1;
