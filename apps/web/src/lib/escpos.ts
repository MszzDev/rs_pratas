/**
 * ESC/POS — a linguagem das impressoras térmicas de balcão.
 *
 * O papel de 58 mm cabe 32 caracteres na fonte normal. Tudo aqui parte disso:
 * as linhas quebram em 32, o alinhamento de preço é calculado em 32, e o traço
 * separador tem 32. Trocar de papel para 80 mm é trocar `COLUNAS`.
 *
 * Por que montar os bytes aqui e não no Android: layout de comprovante muda —
 * o rodapé ganha um telefone, a garantia ganha uma linha, o dono quer o CNPJ.
 * Cada uma dessas mudanças, feita no Java, custaria recompilar e reinstalar o
 * aplicativo em cinco tablets espalhados pela cidade. Aqui, custa uma
 * publicação.
 */

/** Colunas de uma linha na fonte normal, no papel de 58 mm. */
export const COLUNAS = 32;

const ESC = 0x1b;
const GS = 0x1d;

/**
 * A tabela de caracteres que a impressora vai usar.
 *
 * CP850 porque cobre todos os acentos do português (á à ã â é ê í ó õ ô ú ç) e
 * é a tabela que praticamente toda impressora térmica traz — inclusive as
 * genéricas. A alternativa seria mandar tudo sem acento, que funciona sempre e
 * imprime "Anel de Prata Coracao".
 */
const CODEPAGE_CP850 = 2;

/**
 * Os caracteres do português que o CP850 coloca fora do ASCII.
 *
 * Escrito à mão, e não gerado, porque é só isto que a loja usa: nomes de peça,
 * nomes de cliente e o texto fixo do comprovante. Um mapa completo de 128
 * posições seria mais código para cobrir caracteres que nunca vão aparecer.
 */
const CP850: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87,
  ê: 0x88, ë: 0x89, è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f,
  É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97,
  ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, "£": 0x9c, Ø: 0x9d, "×": 0x9e,
  á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7,
  "¿": 0xa8, "®": 0xa9, "½": 0xab, "¼": 0xac, "¡": 0xad, "«": 0xae, "»": 0xaf,
  Á: 0xb5, Â: 0xb6, À: 0xb7, "©": 0xb8, ã: 0xc6, Ã: 0xc7, ð: 0xd0, Ê: 0xd2,
  Ë: 0xd3, È: 0xd4, Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ì: 0xde, Ó: 0xe0, ß: 0xe1,
  Ô: 0xe2, Ò: 0xe3, õ: 0xe4, Õ: 0xe5, µ: 0xe6, Ú: 0xe9, Û: 0xea, Ù: 0xeb,
  ý: 0xec, Ý: 0xed, "±": 0xf1, "¶": 0xf4, "§": 0xf5, "÷": 0xf6, "°": 0xf8,
  "·": 0xfa, "¹": 0xfb, "³": 0xfc, "²": 0xfd,
};

/**
 * Último recurso para o que não existe no CP850.
 *
 * Um nome de peça copiado de outro sistema pode trazer aspas curvas ou um
 * travessão. Sem esta troca, a impressora imprimiria um bloco preto no meio da
 * palavra — pior do que o hífen que ela vira aqui.
 */
const SUBSTITUTOS: Record<string, string> = {
  "—": "-", "–": "-", "‘": "'", "’": "'",
  "“": '"', "”": '"', "…": "...", " ": " ",
};

function paraCp850(texto: string): number[] {
  const bytes: number[] = [];

  for (const caractere of texto.normalize("NFC")) {
    const trocado = SUBSTITUTOS[caractere] ?? caractere;

    for (const letra of trocado) {
      const codigo = letra.charCodeAt(0);

      if (codigo < 0x80) {
        bytes.push(codigo);
        continue;
      }

      const mapeado = CP850[letra];

      if (mapeado !== undefined) {
        bytes.push(mapeado);
        continue;
      }

      // Não está na tabela: tira o acento e imprime a letra base. "ǎ" vira "a",
      // que é legível; o bloco preto que a impressora imprimiria não é.
      const semAcento = letra.normalize("NFD").replace(/[̀-ͯ]/g, "");
      bytes.push(semAcento.length === 1 ? semAcento.charCodeAt(0) : 0x3f);
    }
  }

  return bytes;
}

/**
 * Montador do comprovante.
 *
 * Encadeável (`.linha().negrito().corta()`) porque um comprovante se lê de
 * cima para baixo, e o código que o monta deveria também.
 */
export class Comprovante {
  private bytes: number[] = [];

  constructor() {
    // ESC @ zera a impressora: negrito, alinhamento e tamanho voltam ao padrão.
    // Sem isso, um comprovante que terminou em negrito começa o próximo assim.
    this.bytes.push(ESC, 0x40);
    this.bytes.push(ESC, 0x74, CODEPAGE_CP850);
  }

  private comando(...valores: number[]): this {
    this.bytes.push(...valores);
    return this;
  }

  /** Uma linha de texto, com a quebra no fim. */
  linha(texto = ""): this {
    this.bytes.push(...paraCp850(texto), 0x0a);
    return this;
  }

  /**
   * Texto que não cabe numa linha, quebrado por palavras.
   *
   * Nome de peça é o caso: "Pulseira Veneziana Prata 925 com Fecho" não cabe em
   * 32 colunas, e cortar no meio da palavra deixa o comprovante difícil de ler
   * justamente na parte que o cliente vai conferir.
   */
  paragrafo(texto: string, recuo = 0): this {
    const largura = COLUNAS - recuo;
    const espacos = " ".repeat(recuo);
    let atual = "";

    for (const palavra of texto.split(/\s+/).filter(Boolean)) {
      if (atual === "") {
        atual = palavra;
      } else if (atual.length + 1 + palavra.length <= largura) {
        atual += ` ${palavra}`;
      } else {
        this.linha(espacos + atual);
        atual = palavra;
      }
    }

    if (atual !== "") this.linha(espacos + atual);
    return this;
  }

  /**
   * Rótulo à esquerda, valor à direita, pontilhado no meio.
   *
   * É como se lê um comprovante: os olhos descem pela coluna da direita
   * procurando o total, e valores desalinhados obrigam a ler tudo.
   */
  entreExtremos(esquerda: string, direita: string): this {
    const sobra = COLUNAS - esquerda.length - direita.length;

    if (sobra < 1) {
      // Não coube na mesma linha: o valor desce e encosta na direita, que é
      // melhor que espremer os dois e deixar ambos ilegíveis.
      this.linha(esquerda);
      return this.linha(direita.padStart(COLUNAS));
    }

    return this.linha(esquerda + " ".repeat(sobra) + direita);
  }

  negrito(ligado: boolean): this {
    return this.comando(ESC, 0x45, ligado ? 1 : 0);
  }

  /** 0 esquerda, 1 centro, 2 direita. */
  alinhamento(posicao: 0 | 1 | 2): this {
    return this.comando(ESC, 0x61, posicao);
  }

  /** Dobra a altura e a largura — para o nome da loja e para o total. */
  grande(ligado: boolean): this {
    return this.comando(GS, 0x21, ligado ? 0x11 : 0x00);
  }

  separador(caractere = "-"): this {
    return this.linha(caractere.repeat(COLUNAS));
  }

  /**
   * Avança o papel e corta.
   *
   * As linhas em branco antes do corte não são enfeite: a lâmina fica alguns
   * milímetros acima do cabeçote, e sem elas o corte passa no meio da última
   * linha impressa.
   */
  corta(): this {
    this.linha().linha().linha();
    return this.comando(GS, 0x56, 0x42, 0x00);
  }

  /** O que vai para o plugin: os bytes em base64. */
  paraBase64(): string {
    let binario = "";
    for (const byte of this.bytes) binario += String.fromCharCode(byte);
    return btoa(binario);
  }
}
