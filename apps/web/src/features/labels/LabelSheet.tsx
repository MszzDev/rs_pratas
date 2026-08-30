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
    /** A folga entre uma etiqueta e a próxima no rolo, em milímetros. */
    gapXMm?: number;
    gapYMm?: number;
    /** Quantas etiquetas o rolo tem lado a lado. Um é rolo de coluna única. */
    columnsPerRow?: number;
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

  /**
   * O rolo desta impressão.
   *
   * Vem da primeira etiqueta porque a folha inteira é do mesmo rolo: não faz
   * sentido misturar modelos de tamanhos diferentes numa impressão só.
   */
  const rolo = etiquetas[0]?.payload.layout;

  /**
   * O tamanho da PÁGINA, declarado pelo sistema.
   *
   * Sem isso o navegador usa o papel escolhido no diálogo de impressão, e
   * qualquer diferença entre esse papel e a etiqueta faz o conteúdo transbordar
   * para uma página nova. Numa impressora térmica, página nova é **etiqueta
   * nova**: saem etiquetas em branco no meio do lote, e o desenho vai
   * escorregando para fora do picote.
   *
   * Aconteceu na loja: o lote saía com brancas intercaladas e o texto subindo
   * até cair na dobra. Declarar a página do tamanho exato de uma linha do rolo
   * resolve os dois de uma vez — a impressora avança sozinha a folga entre uma
   * linha e a seguinte, que é o trabalho dela.
   */
  /**
   * A altura da página é o PASSO do rolo, não o tamanho da etiqueta.
   *
   * No papel, cada etiqueta ocupa o próprio corpo mais o intervalo até a
   * seguinte. Declarando a página com o corpo apenas, sobra o intervalo a cada
   * avanço: o desenho e o recorte vão se desencontrando um pouco por linha, e
   * quando a soma passa de uma etiqueta aparece uma em branco. Depois duas,
   * depois três — o desperdício cresce ao longo do rolo.
   *
   * Com o passo completo, cada página corresponde a um recorte e o desvio não
   * tem como acumular. A etiqueta continua desenhada só no corpo; o intervalo
   * fica em branco de propósito, porque é onde o papel é picotado.
   */
  const alturaDaPagina = rolo ? rolo.heightMm + (rolo.gapYMm ?? 0) : 0;
  const larguraDaPagina = rolo ? larguraDaBobina(rolo) : 0;

  /**
   * As etiquetas agrupadas em linhas do rolo, uma linha por página.
   *
   * Antes a quebra era deixada para o navegador: a folha crescia e ele cortava
   * a cada altura de página. Só que `break-inside: avoid` protege a etiqueta de
   * ser partida ao meio, e qualquer fração de milímetro que sobrasse fazia a
   * linha inteira pular para a página seguinte — deixando a anterior em branco.
   * Numa impressora térmica, página em branco é **etiqueta em branco**: o rolo
   * saía com um vazio a cada duas linhas.
   *
   * Agrupando aqui, cada página tem exatamente uma linha do rolo e não há
   * sobra para arredondar.
   */
  const porLinha = rolo ? colunasPorLinha(rolo) : 1;
  const linhas: (typeof etiquetas)[] = [];
  for (let i = 0; i < etiquetas.length; i += porLinha) {
    linhas.push(etiquetas.slice(i, i + porLinha));
  }

  const estiloDaFolha = {
    /**
     * A largura da folha, dita explicitamente.
     *
     * `.print-sheet` é `position: absolute`, e caixa absoluta sem largura
     * **encolhe até o conteúdo**. Com etiquetas de 33 mm a folha inteira ficava
     * com 33 mm — e numa caixa de 33 mm três etiquetas de 33 mm nunca cabem
     * lado a lado. Cada uma caía numa linha, a tira saía estreita, e a
     * impressora centralizava esse fiapo no meio do rolo: a coluna do meio
     * impressa e as duas laterais em branco, um terço de aproveitamento.
     *
     * O `flex-wrap` estava certo o tempo todo; faltava dar a ele espaço para
     * quebrar.
     */
    width: `${larguraDaPagina}mm`,
  };

  return (
    <>
      {rolo && (
        <style>{`@page { size: ${larguraDaPagina}mm ${alturaDaPagina}mm; margin: 0; }`}</style>
      )}
      <div className="print-sheet" style={estiloDaFolha} aria-hidden>
        {linhas.map((linha, indice) => (
          <div
            key={linha[0]?.key ?? indice}
            className="print-row"
            style={{
              height: `${alturaDaPagina}mm`,
              columnGap: `${rolo?.gapXMm ?? 0}mm`,
              // O intervalo fica DEPOIS do corpo, como no papel.
              alignItems: "flex-start",
            }}
          >
            {linha.map((etiqueta) => (
              <Label key={etiqueta.key} payload={etiqueta.payload} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Quantas etiquetas cabem lado a lado numa linha do rolo.
 *
 * O modelo guarda o tamanho de UMA etiqueta, não a largura da bobina — é assim
 * que o dono pensa ao cadastrar ("minha etiqueta é 33 por 21"). Mas a página
 * precisa ter a largura da bobina inteira, senão o navegador quebra a linha
 * depois da primeira coluna e duas de cada três etiquetas saem em branco.
 *
 * `columnsPerRow` diz quantas colunas o rolo tem. Um significa rolo de coluna
 * única, e a conta continua valendo sem caso especial.
 */
function colunasPorLinha(rolo: LabelPayload["layout"]) {
  return Math.max(1, rolo.columnsPerRow ?? 1);
}

/**
 * A largura de uma linha inteira do rolo: as colunas mais as folgas entre elas.
 *
 * As folgas contam. Esquecê-las encurta a página e a impressora centraliza o
 * que recebe — o desenho sai deslocado meio milímetro para a esquerda em cada
 * coluna, o bastante para o código de barras encostar no picote.
 *
 * O que sobra entre esta largura e a bobina física é a borda de papel exposto
 * dos dois lados, que a impressora resolve sozinha ao centralizar.
 */
function larguraDaBobina(rolo: LabelPayload["layout"]) {
  const colunas = colunasPorLinha(rolo);
  const folga = rolo.gapXMm ?? 0;

  return rolo.widthMm * colunas + folga * (colunas - 1);
}

function Label({ payload }: { payload: LabelPayload }) {
  const { layout } = payload;

  const style = {
    width: `${layout.widthMm}mm`,
    height: `${layout.heightMm}mm`,
    // A calibração desloca a impressão inteira: rolo desalinhado é o problema
    // mais comum de impressora térmica de balcão.
    fontSize: "2.1mm",
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
