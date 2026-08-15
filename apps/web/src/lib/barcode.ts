/**
 * Code 128, conjunto B.
 *
 * Escrito à mão em vez de trazer uma biblioteca: são as larguras das barras e
 * um dígito verificador, e o tablet baixa o aplicativo pela rede do shopping —
 * cada dependência a mais é peso numa conexão que já é ruim.
 *
 * Conjunto B porque os SKUs são alfanuméricos com hífen ("AN-1001-16"). O
 * conjunto C comprimiria pares de dígitos, mas só serve para código puramente
 * numérico, que não é o nosso caso.
 */

/**
 * Larguras de cada símbolo: seis dígitos alternando barra e espaço, começando
 * por barra. O símbolo de parada tem sete.
 */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "112142", "112241", "122141", "114212", "124112",
  "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143",
  "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131",
  "311141", "411131", "211412", "211214", "211232", "233111",
];

const START_B = 104;
const STOP = 106;

export interface BarcodeBar {
  /** Largura em módulos. O módulo é a unidade fina do código. */
  width: number;
  /** Barra escura ou espaço claro. */
  dark: boolean;
}

/**
 * Converte o texto nas barras a desenhar.
 *
 * Caracteres fora da faixa imprimível do conjunto B são descartados: um SKU
 * com acento entraria como símbolo inválido e o leitor recusaria a etiqueta
 * inteira — melhor perder o acento que perder o código.
 */
export function encodeCode128(text: string): BarcodeBar[] {
  const chars = [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126;
  });

  if (chars.length === 0) return [];

  const values = chars.map((char) => char.charCodeAt(0) - 32);

  // Verificador: soma ponderada pela posição, módulo 103. É o que faz o leitor
  // recusar uma etiqueta borrada em vez de ler o código errado.
  let checksum = START_B;
  values.forEach((value, index) => {
    checksum += value * (index + 1);
  });
  checksum %= 103;

  const symbols = [START_B, ...values, checksum, STOP];
  const bars: BarcodeBar[] = [];

  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol];
    if (!pattern) continue;

    [...pattern].forEach((digit, index) => {
      bars.push({ width: Number(digit), dark: index % 2 === 0 });
    });
  }

  return bars;
}

/** Largura total em módulos — usada para caber o código na etiqueta. */
export function barcodeModules(bars: BarcodeBar[]): number {
  return bars.reduce((total, bar) => total + bar.width, 0);
}
