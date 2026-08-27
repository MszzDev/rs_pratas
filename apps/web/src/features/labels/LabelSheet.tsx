import type { LabelElement } from "@rs-pratas/shared";
import { barcodeModules, encodeCode128 } from "@/lib/barcode";
import { EtiquetaDesenhada } from "./LabelDrawing";

export interface LabelPayload {
  productName: string | null;
  sku: string | null;
  price: string | null;
  size: string | null;
  weightGrams: string | null;
  barcode: string | null;
  layout: {
    widthMm: number;
    heightMm: number;
    offsetXMm: number;
    offsetYMm: number;
    fontScale: number;
    isDoubleSided: boolean;
    /** O desenho montado no editor. Nulo usa o formato empilhado de sempre. */
    elements?: LabelElement[] | null;
  };
}

export interface LabelToPrint {
  jobId: string;
  copies: number;
  payload: LabelPayload;
}

/**
 * A folha que vai para a impressora.
 *
 * Fica fora da tela o tempo todo e só aparece durante a impressão — a regra
 * está no `@media print` do index.css, que esconde o resto da página. É o
 * mesmo truque que qualquer sistema de balcão usa: em vez de falar direto com
 * a impressora térmica (o que exigiria aplicativo nativo e um driver por
 * modelo), monta a página no tamanho exato em milímetros e deixa o próprio
 * navegador conversar com o driver que o sistema já tem instalado.
 *
 * As medidas são em `mm` de propósito: pixel depende da resolução da tela e
 * sairia com tamanho diferente em cada aparelho. Milímetro é milímetro.
 */
export function LabelSheet({ labels }: { labels: LabelToPrint[] }) {
  // Uma etiqueta por cópia: a impressora corta entre elas, então cada uma
  // precisa existir de verdade na folha.
  const etiquetas = labels.flatMap((label) =>
    Array.from({ length: label.copies }, (_, index) => ({
      key: `${label.jobId}-${index}`,
      payload: label.payload,
    })),
  );

  return (
    <div className="print-sheet" aria-hidden>
      {etiquetas.map((etiqueta) => (
        <Label key={etiqueta.key} payload={etiqueta.payload} />
      ))}
    </div>
  );
}

function Label({ payload }: { payload: LabelPayload }) {
  const { layout } = payload;

  const style = {
    width: `${layout.widthMm}mm`,
    height: `${layout.heightMm}mm`,
    // A calibração desloca a impressão inteira: rolo desalinhado é o problema
    // mais comum de impressora térmica de balcão.
    marginLeft: `${layout.offsetXMm}mm`,
    marginTop: `${layout.offsetYMm}mm`,
    fontSize: `${2.1 * layout.fontScale}mm`,
  };

  /**
   * Desenho montado pelo dono, quando existe.
   *
   * O mesmo componente que o editor mostra na tela — se fossem dois, eles
   * divergiriam na primeira mudança, e a promessa do editor é justamente que o
   * que se vê é o que sai.
   */
  if (layout.elements && layout.elements.length > 0) {
    const desenho = (
      <EtiquetaDesenhada
        elementos={layout.elements}
        dados={payload}
        larguraMm={layout.widthMm}
        alturaMm={layout.heightMm}
      />
    );

    return (
      <div
        className="print-label"
        style={{
          marginLeft: `${layout.offsetXMm}mm`,
          marginTop: `${layout.offsetYMm}mm`,
        }}
      >
        {desenho}
        {layout.isDoubleSided && (
          <>
            <span className="print-label-fold" />
            {desenho}
          </>
        )}
      </div>
    );
  }

  const conteudo = (
    <>
      {payload.productName && <span className="print-label-name">{payload.productName}</span>}

      <span className="print-label-line">
        {payload.sku && <span className="print-label-sku">{payload.sku}</span>}
        {payload.size && <span className="print-label-size">Tam. {payload.size}</span>}
      </span>

      {payload.barcode && <Barcode value={payload.barcode} heightMm={layout.heightMm * 0.32} />}

      <span className="print-label-line">
        {payload.price && (
          <span className="print-label-price">
            R$ {Number(payload.price).toFixed(2).replace(".", ",")}
          </span>
        )}
        {payload.weightGrams && (
          <span className="print-label-weight">{payload.weightGrams} g</span>
        )}
      </span>
    </>
  );

  return (
    <div className="print-label" style={style}>
      <div className="print-label-half">{conteudo}</div>

      {/*
        Etiqueta de joia é dobrada ao meio e colada na argola: as duas metades
        precisam ter o mesmo conteúdo, porque só uma fica visível dependendo de
        como a peça é pendurada.
      */}
      {layout.isDoubleSided && (
        <>
          <span className="print-label-fold" />
          <div className="print-label-half">{conteudo}</div>
        </>
      )}
    </div>
  );
}

/**
 * Código de barras desenhado em SVG.
 *
 * O `viewBox` usa módulos como unidade e o SVG estica para a largura
 * disponível — assim o código ocupa a etiqueta inteira em qualquer tamanho de
 * rolo, sem cálculo de escala em cada lugar.
 */
function Barcode({ value, heightMm }: { value: string; heightMm: number }) {
  const bars = encodeCode128(value);
  if (bars.length === 0) return null;

  const total = barcodeModules(bars);
  let x = 0;

  return (
    <svg
      className="print-label-barcode"
      viewBox={`0 0 ${total} 20`}
      preserveAspectRatio="none"
      style={{ height: `${heightMm}mm` }}
    >
      {bars.map((bar, index) => {
        const rect = bar.dark ? (
          <rect key={index} x={x} y={0} width={bar.width} height={20} fill="#000000" />
        ) : null;
        x += bar.width;
        return rect;
      })}
    </svg>
  );
}
