import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo-rs-pratas.png";

/**
 * A marca da loja.
 *
 * É a logo real da RS Pratas — o monograma em letra manuscrita dentro do
 * círculo, com o ramo de oliveira e "pratas" embaixo. Ela já traz o nome
 * desenhado, então NADA de texto acompanha: escrever "RS Pratas" ao lado de
 * uma logo que diz "RS pratas" é repetir a mesma palavra duas vezes com duas
 * tipografias diferentes.
 *
 * Imagem e não SVG porque o desenho é o arquivo do designer, com o traço à
 * mão do ramo. Redesenhá-lo em vetor daria algo parecido, e parecido não é a
 * marca de ninguém.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="RS Pratas"
      /**
       * O disco é UMA MOLDURA, não um recorte.
       *
       * O arquivo do designer é quadrado, com fundo rosa claro embutido, e
       * dentro dele o desenho já é um círculo — com o ramo de oliveira
       * ESCAPANDO dele pela esquerda. Recortar a imagem em círculo decepava
       * justamente esse ramo e mordia o traço fino do contorno: sobrava uma
       * forma torta, que não é a marca de ninguém.
       *
       * Então nada é cortado. A imagem inteira entra, e o disco cresce por
       * fora dela com uma folga. No tema claro esse disco tem a cor da barra
       * lateral e desaparece; no escuro, vira o distintivo que impede o
       * quadrado rosa de brigar com o fundo.
       *
       * `object-contain` mantém a proporção em qualquer caixa: sem ele, uma
       * barra estreita achataria a logo num oval.
       */
      className={cn(
        /**
         * `shrink-0` não é detalhe: é o que impede a deformação.
         *
         * Imagem dentro de um flex encolhe por padrão. Numa barra lateral de
         * 240 pixels, dividindo espaço com o relógio e a bateria, a logo era
         * espremida na horizontal e virava uma pílula vertical — alta,
         * estreita, com o desenho letterboxado a ponto de sumir. Parecia um
         * defeito de imagem, e era só a caixa cedendo.
         */
        "h-8 w-8 shrink-0 rounded-full bg-[#FDF4F9] p-[6%] object-contain",
        className,
      )}
      draggable={false}
    />
  );
}

/**
 * A mesma marca, nos tamanhos usados pelo sistema.
 *
 * Existe separada de `LogoMark` só para padronizar as medidas — o conteúdo é
 * idêntico, porque a logo é autossuficiente.
 */
export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  /**
   * No tablet a logo cresce.
   *
   * A tela do balcão é de 1920 por 1200 a um braço de distância, e a marca
   * ficava do tamanho de um ícone de celular — pequena a ponto de parecer
   * desalinhada. Cresce só a partir de `lg`, que é onde a barra lateral
   * aparece: no celular, a mesma medida ocuparia metade do cabeçalho.
   */
  const tamanhos = {
    sm: "h-12 w-12",
    md: "h-14 w-14 lg:h-20 lg:w-20",
    lg: "h-28 w-28 lg:h-36 lg:w-36",
  };

  return <LogoMark className={cn(tamanhos[size], className)} />;
}
