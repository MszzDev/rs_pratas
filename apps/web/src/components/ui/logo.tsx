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
       * O disco claro é da logo, não do tema.
       *
       * O arquivo do designer tem fundo rosa claro embutido. No tema claro ele
       * se funde ao fundo da barra e ninguém nota. No escuro virava um quadrado
       * aceso colado na tela — o desenho certo, com uma moldura que ninguém
       * pediu.
       *
       * Recortado em círculo e assumido como disco, ele lê como distintivo nos
       * dois temas: é a marca sobre o fundo dela, e não um erro de recorte.
       *
       * `object-contain` mantém o círculo redondo em qualquer caixa: sem ele,
       * uma barra estreita achataria a logo num oval.
       */
      className={cn(
        "h-8 w-8 rounded-full bg-[#FDF4F9] object-contain",
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
    sm: "h-10 w-10",
    md: "h-12 w-12 lg:h-16 lg:w-16",
    lg: "h-24 w-24 lg:h-32 lg:w-32",
  };

  return <LogoMark className={cn(tamanhos[size], className)} />;
}
