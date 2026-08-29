import type { CSSProperties } from "react";
import { CAMPOS_DE_VARIAS_LINHAS, type LabelElement } from "@rs-pratas/shared";
import { barcodeModules, encodeCode128 } from "@/lib/barcode";
import logoUrl from "@/assets/logo-rs-pratas.png";

/**
 * A etiqueta desenhada a partir do que o dono montou.
 *
 * Um único componente serve para a TELA do editor e para o PAPEL. Se fossem
 * dois, eles divergiriam na primeira mudança — e a promessa do editor é
 * exatamente que o que se vê é o que sai.
 *
 * Tudo em milímetros. Na impressão o navegador usa milímetro de verdade; na
 * tela ele usa a ideia que tem de milímetro, que erra conforme o monitor — por
 * isso o editor oferece uma régua para ajustar. O desenho não muda: o que muda
 * é só o zoom da visualização.
 */

export interface DadosDaEtiqueta {
  productName: string | null;
  sku: string | null;
  price: string | null;
  size: string | null;
  weightGrams: string | null;
  barcode: string | null;
}

/** O texto que cada elemento mostra, já formatado como sai no papel. */
export function textoDoElemento(elemento: LabelElement, dados: DadosDaEtiqueta): string | null {
  switch (elemento.campo) {
    case "NOME":
      return dados.productName;
    case "SKU":
      return dados.sku;
    case "PRECO":
      return dados.price === null
        ? null
        : `R$ ${Number(dados.price).toFixed(2).replace(".", ",")}`;
    case "TAMANHO":
      return dados.size === null ? null : `Tam. ${dados.size}`;
    case "PESO":
      return dados.weightGrams === null ? null : `${dados.weightGrams} g`;
    case "TEXTO":
      return elemento.texto ?? null;
    case "CODIGO_BARRAS":
      return dados.barcode;
    default:
      return null;
  }
}

function posicao(elemento: LabelElement): CSSProperties {
  /**
   * Endereço quebra; o resto corta.
   *
   * Numa etiqueta de joia, deixar o nome longo transbordar é melhor que
   * quebrá-lo em duas linhas por cima do preço. Num endereço é o contrário:
   * cortar "Rua das Palmeiras, 1042, apto 71" no meio faz o pacote não chegar.
   */
  const quebra = CAMPOS_DE_VARIAS_LINHAS.includes(elemento.campo);

  return {
    position: "absolute",
    left: `${elemento.xMm}mm`,
    top: `${elemento.yMm}mm`,
    width: `${elemento.larguraMm}mm`,
    ...(elemento.alturaMm && quebra ? { height: `${elemento.alturaMm}mm` } : {}),
    textAlign: elemento.alinhamento,
    fontSize: `${elemento.tamanhoMm}mm`,
    fontWeight: elemento.negrito ? 700 : 400,
    // A altura da linha acompanha a letra: sem isto, o espaçamento padrão do
    // navegador empurraria o elemento para fora da posição escolhida.
    lineHeight: 1.15,
    // `pre-line` respeita as quebras que o servidor já montou — uma parte do
    // endereço por linha — e ainda quebra sozinho o que passar da largura.
    whiteSpace: quebra ? "pre-line" : "nowrap",
    overflow: "hidden",
  };
}

export function ElementoDaEtiqueta({
  elemento,
  dados,
}: {
  elemento: LabelElement;
  dados: DadosDaEtiqueta;
}) {
  /**
   * Logo e linha não têm texto, então saem antes da checagem de conteúdo
   * vazio — que descartaria as duas.
   */
  if (elemento.campo === "LOGO") {
    return (
      <img
        src={logoUrl}
        alt=""
        style={{
          position: "absolute",
          left: `${elemento.xMm}mm`,
          top: `${elemento.yMm}mm`,
          width: `${elemento.larguraMm}mm`,
          height: `${elemento.alturaMm ?? elemento.larguraMm}mm`,
          // A proporção manda: esticar a marca para preencher a caixa é o tipo
          // de coisa que só o dono percebe, e percebe todo dia.
          objectFit: "contain",
        }}
      />
    );
  }

  if (elemento.campo === "LINHA") {
    return (
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: `${elemento.xMm}mm`,
          top: `${elemento.yMm}mm`,
          width: `${elemento.larguraMm}mm`,
          height: `${elemento.alturaMm ?? 0.4}mm`,
          background: "#000",
        }}
      />
    );
  }

  const texto = textoDoElemento(elemento, dados);
  if (texto === null || texto === "") return null;

  if (elemento.campo === "CODIGO_BARRAS") {
    return (
      <div style={{ ...posicao(elemento), whiteSpace: "normal" }}>
        <CodigoDeBarras valor={texto} alturaMm={elemento.alturaMm ?? 6} />
      </div>
    );
  }

  return <div style={posicao(elemento)}>{texto}</div>;
}

/**
 * Código de barras em SVG.
 *
 * O `viewBox` usa módulos como unidade e o SVG estica para a largura
 * disponível — assim o código ocupa a largura escolhida em qualquer tamanho de
 * rolo, sem cálculo de escala em cada lugar.
 */
export function CodigoDeBarras({ valor, alturaMm }: { valor: string; alturaMm: number }) {
  const barras = encodeCode128(valor);
  if (barras.length === 0) return null;

  const total = barcodeModules(barras);
  let x = 0;

  return (
    <svg
      viewBox={`0 0 ${total} 20`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height: `${alturaMm}mm` }}
    >
      {barras.map((barra, indice) => {
        const retangulo = barra.dark ? (
          <rect key={indice} x={x} y={0} width={barra.width} height={20} fill="#000000" />
        ) : null;
        x += barra.width;
        return retangulo;
      })}
    </svg>
  );
}

/**
 * Uma etiqueta inteira, do tamanho do papel.
 *
 * `position: relative` porque os elementos são posicionados dentro dela — as
 * coordenadas do editor são relativas à etiqueta, não à página.
 */
export function EtiquetaDesenhada({
  elementos,
  dados,
  larguraMm,
  alturaMm,
  className,
  style,
}: {
  elementos: LabelElement[];
  dados: DadosDaEtiqueta;
  larguraMm: number;
  alturaMm: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: `${larguraMm}mm`,
        height: `${alturaMm}mm`,
        overflow: "hidden",
        ...style,
      }}
    >
      {elementos.map((elemento) => (
        <ElementoDaEtiqueta key={elemento.id} elemento={elemento} dados={dados} />
      ))}
    </div>
  );
}
