import { barcodeModules, encodeCode128 } from "./barcode";

/**
 * A etiqueta em TSPL, a linguagem da impressora de etiqueta.
 *
 * Existe para o sistema falar DIRETO com a impressora, sem passar pelo diálogo
 * de impressão do navegador. Essa passagem era a origem de quase todo problema
 * de etiqueta na loja: o navegador escolhe o papel, aplica margem, escala o
 * desenho para caber e cria páginas por conta própria — e cada página a mais
 * é uma etiqueta desperdiçada. Nenhuma dessas decisões é dele para tomar
 * quando o papel tem 33 mm e vem picotado.
 *
 * Falando TSPL, o sistema diz a medida em milímetros e a impressora obedece.
 *
 * ## Por que imagem, e não texto
 *
 * O TSPL tem comando de texto (`TEXT`) e de código de barras (`BARCODE`), que
 * seriam mais econômicos. Só que esta impressora **não tem as fontes internas**
 * — `TEXT` não produz saída nenhuma, enquanto `BAR` (retângulo) funciona.
 * Descobrimos isso testando comando a comando.
 *
 * Então a etiqueta é desenhada num canvas, na resolução exata da impressora, e
 * enviada como pontos prontos pelo comando `BITMAP`. Fica maior em bytes, mas
 * não depende de fonte nenhuma e o que se vê na tela é o que sai no papel.
 */

/** 203 dpi: a resolução desta família de impressoras. 1 mm = 8 pontos. */
const PONTOS_POR_MM = 8;

export interface RoloDeEtiqueta {
  /** O tamanho de UMA etiqueta. */
  larguraMm: number;
  alturaMm: number;
  /** Quantas etiquetas lado a lado. */
  colunas: number;
  /** O espaço entre colunas e entre linhas. */
  folgaXMm: number;
  intervaloYMm: number;
  /** A bobina inteira, com a borda de papel exposto dos dois lados. */
  bobinaMm: number;
}

export interface ConteudoDaEtiqueta {
  nome: string | null;
  sku: string | null;
  preco: string | null;
  tamanho: string | null;
  codigoDeBarras: string | null;
}

/** A largura útil: as colunas mais as folgas, sem a borda exposta. */
function larguraDoConteudo(rolo: RoloDeEtiqueta): number {
  return rolo.larguraMm * rolo.colunas + rolo.folgaXMm * (rolo.colunas - 1);
}

/** A bobina informada vence; sem ela, o conteúdo define a largura. */
function larguraDaBobina(rolo: RoloDeEtiqueta): number {
  return rolo.bobinaMm > 0 ? rolo.bobinaMm : larguraDoConteudo(rolo);
}

/**
 * Desenha UMA linha do rolo num canvas, na resolução da impressora.
 *
 * A linha inteira vira uma imagem só, e não cada etiqueta separada, porque a
 * impressora imprime linha por linha: mandar três imagens obrigaria a
 * posicioná-las por comando, e qualquer arredondamento entre elas apareceria
 * como coluna torta no papel.
 */
function desenharLinha(etiquetas: ConteudoDaEtiqueta[], rolo: RoloDeEtiqueta): ImageData {
  const larguraPt = Math.round(larguraDaBobina(rolo) * PONTOS_POR_MM);
  const alturaPt = Math.round(rolo.alturaMm * PONTOS_POR_MM);

  const canvas = document.createElement("canvas");
  canvas.width = larguraPt;
  canvas.height = alturaPt;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("SEM_CANVAS");

  // Fundo branco: o que não for pintado não queima o papel.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, larguraPt, alturaPt);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  // A borda de papel exposto, dividida entre os dois lados.
  const bordaPt = Math.round(
    ((larguraDaBobina(rolo) - larguraDoConteudo(rolo)) / 2) * PONTOS_POR_MM,
  );
  const larguraEtiquetaPt = Math.round(rolo.larguraMm * PONTOS_POR_MM);
  const passoPt = Math.round((rolo.larguraMm + rolo.folgaXMm) * PONTOS_POR_MM);

  /* Folga interna generosa: rolo de várias colunas nunca fica perfeitamente
     alinhado, e o desenho precisa tolerar meio milímetro de desvio em vez de
     exigir do papel uma precisão que ele não dá. */
  const margemPt = Math.round(2 * PONTOS_POR_MM);

  etiquetas.forEach((etiqueta, coluna) => {
    const x0 = bordaPt + coluna * passoPt + margemPt;
    const util = larguraEtiquetaPt - margemPt * 2;
    const centro = x0 + util / 2;

    let y = Math.round(1 * PONTOS_POR_MM);

    if (etiqueta.nome) {
      /* Negrito e um pouco maior: no primeiro teste real o nome saiu legível
         mas fraco, e etiqueta de joia é lida de perto, sob vitrine, por quem
         está decidindo a compra. */
      ctx.font = `bold ${Math.round(2.6 * PONTOS_POR_MM)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      escreverCortando(ctx, etiqueta.nome, centro, y, util);
      y += Math.round(3.2 * PONTOS_POR_MM);
    }

    const linhaDeCima = [etiqueta.sku, etiqueta.tamanho ? `Tam. ${etiqueta.tamanho}` : null]
      .filter(Boolean)
      .join("  ");

    if (linhaDeCima) {
      ctx.font = `bold ${Math.round(2.1 * PONTOS_POR_MM)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      escreverCortando(ctx, linhaDeCima, centro, y, util);
      y += Math.round(2.6 * PONTOS_POR_MM);
    }

    if (etiqueta.codigoDeBarras) {
      const alturaBarras = Math.round(rolo.alturaMm * 0.34 * PONTOS_POR_MM);
      desenharBarras(ctx, etiqueta.codigoDeBarras, x0, y, util, alturaBarras);
      y += alturaBarras + Math.round(0.6 * PONTOS_POR_MM);
    }

    if (etiqueta.preco) {
      ctx.font = `bold ${Math.round(3 * PONTOS_POR_MM)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      escreverCortando(ctx, `R$ ${etiqueta.preco}`, centro, y, util);
    }
  });

  return ctx.getImageData(0, 0, larguraPt, alturaPt);
}

/** Escreve cortando com reticências quando não cabe, em vez de invadir a vizinha. */
function escreverCortando(
  ctx: CanvasRenderingContext2D,
  texto: string,
  centro: number,
  y: number,
  largura: number,
): void {
  let atual = texto;

  while (atual.length > 1 && ctx.measureText(atual).width > largura) {
    atual = atual.slice(0, -1);
  }

  if (atual !== texto && atual.length > 1) {
    atual = `${atual.slice(0, -1)}…`;
  }

  ctx.fillText(atual, centro, y);
}

/** As barras do Code 128, esticadas para a largura útil da etiqueta. */
function desenharBarras(
  ctx: CanvasRenderingContext2D,
  valor: string,
  x0: number,
  y: number,
  largura: number,
  altura: number,
): void {
  const barras = encodeCode128(valor);
  if (barras.length === 0) return;

  const modulos = barcodeModules(barras);
  const porModulo = largura / modulos;

  let x = x0;
  for (const barra of barras) {
    const w = barra.width * porModulo;
    if (barra.dark) ctx.fillRect(Math.round(x), y, Math.max(1, Math.round(w)), altura);
    x += w;
  }
}

/**
 * A imagem em bytes do jeito que o TSPL espera.
 *
 * Um bit por ponto, oito pontos por byte, e o bit **1 é branco** — ao
 * contrário do que a intuição sugere. Trocar isso imprime o negativo: a
 * etiqueta sai toda preta com as letras em branco, gastando o rolo e o
 * cabeçote.
 */
function bytesDaImagem(imagem: ImageData): { bytes: Uint8Array; porLinha: number } {
  const porLinha = Math.ceil(imagem.width / 8);
  const bytes = new Uint8Array(porLinha * imagem.height);
  bytes.fill(0xff);

  for (let y = 0; y < imagem.height; y++) {
    for (let x = 0; x < imagem.width; x++) {
      const p = (y * imagem.width + x) * 4;
      const r = imagem.data[p] ?? 255;
      const g = imagem.data[p + 1] ?? 255;
      const b = imagem.data[p + 2] ?? 255;

      // Média simples serve: o desenho é preto no branco, sem meio-tom.
      const escuro = (r + g + b) / 3 < 128;
      if (!escuro) continue;

      const indice = y * porLinha + (x >> 3);
      const atual = bytes[indice] ?? 0xff;
      bytes[indice] = atual & ~(0x80 >> (x & 7));
    }
  }

  return { bytes, porLinha };
}

function ascii(texto: string): Uint8Array {
  const saida = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) saida[i] = texto.charCodeAt(i) & 0xff;
  return saida;
}

function juntar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((soma, p) => soma + p.length, 0);
  const saida = new Uint8Array(total);

  let posicao = 0;
  for (const parte of partes) {
    saida.set(parte, posicao);
    posicao += parte.length;
  }
  return saida;
}

/** Base64 é o formato que a ponte para o Android aceita. */
function paraBase64(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

/**
 * Monta o lote inteiro em TSPL e devolve pronto para o plugin.
 *
 * As etiquetas são agrupadas em linhas do rolo, e cada linha vira uma imagem e
 * um `PRINT`. É a impressora que avança até o recorte seguinte — o intervalo
 * entre linhas não é desenhado, porque é onde o papel é picotado.
 */
export function montarEtiquetasTspl(
  etiquetas: ConteudoDaEtiqueta[],
  rolo: RoloDeEtiqueta,
): string {
  const colunas = Math.max(1, rolo.colunas);
  const partes: Uint8Array[] = [];

  for (let i = 0; i < etiquetas.length; i += colunas) {
    const linha = etiquetas.slice(i, i + colunas);
    const imagem = desenharLinha(linha, rolo);
    const { bytes, porLinha } = bytesDaImagem(imagem);

    const cabecalho =
      `SIZE ${larguraDaBobina(rolo)} mm, ${rolo.alturaMm} mm\r\n` +
      `GAP ${rolo.intervaloYMm} mm, 0 mm\r\n` +
      `DIRECTION 1\r\n` +
      `REFERENCE 0,0\r\n` +
      `DENSITY 15\r\n` +
      `SPEED 2\r\n` +
      `CLS\r\n` +
      `BITMAP 0,0,${porLinha},${imagem.height},0,`;

    partes.push(ascii(cabecalho), bytes, ascii(`\r\nPRINT 1,1\r\n`));
  }

  return paraBase64(juntar(partes));
}
