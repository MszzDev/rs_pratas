import { z } from "zod";

/**
 * O desenho de uma etiqueta.
 *
 * Tudo aqui é em MILÍMETROS — a mesma unidade da impressora. Pixel dependeria
 * da resolução da tela e sairia com tamanho diferente em cada aparelho;
 * milímetro é milímetro na tela do dono, no tablet do balcão e no papel.
 *
 * O desenho vive no servidor e não no aparelho: a etiqueta é da EMPRESA. O
 * dono monta uma vez, e as cinco lojas imprimem igual — se cada tablet
 * guardasse o seu, a mesma peça sairia diferente em cada quiosque.
 */

/** O que cada elemento mostra. */
export const CAMPOS_DA_ETIQUETA = [
  "NOME",
  "SKU",
  "PRECO",
  "TAMANHO",
  "PESO",
  "CODIGO_BARRAS",
  /** Texto que o dono escreve: nome da loja, "prata 925", um telefone. */
  "TEXTO",

  /**
   * Enfeite e estrutura.
   *
   * A logo e a linha divisória não carregam informação nenhuma — e é
   * justamente por isso que existem. Numa etiqueta de pacote, o que separa
   * "quem manda" de "para quem vai" é o espaço em branco e o traço entre os
   * dois; sem eles o carteiro lê dois endereços empilhados e escolhe um.
   */
  "LOGO",
  "LINHA",
] as const;

export type CampoDaEtiqueta = (typeof CAMPOS_DA_ETIQUETA)[number];

/**
 * Campos que ocupam mais de uma linha.
 *
 * A regra padrão da etiqueta é CORTAR o que não cabe: numa etiqueta de joia,
 * um nome longo transbordando é melhor que ele empurrando o preço para fora do
 * papel. O texto livre é a exceção — quem escreve ali decide o que vai, e
 * cortar a frase de alguém pela metade não ajuda ninguém.
 */
export const CAMPOS_DE_VARIAS_LINHAS: readonly CampoDaEtiqueta[] = ["TEXTO"];

export const labelElementSchema = z.object({
  id: z.string().min(1).max(40),
  campo: z.enum(CAMPOS_DA_ETIQUETA),
  /** Só para TEXTO. */
  texto: z.string().max(60).optional(),

  xMm: z.number().min(-50).max(500),
  yMm: z.number().min(-50).max(500),
  larguraMm: z.number().min(1).max(500),
  /** Só o código de barras tem altura própria; texto ocupa a linha dele. */
  alturaMm: z.number().min(1).max(200).optional(),

  /**
   * Tamanho da letra em milímetros, e não em pontos.
   *
   * Impressora térmica não pensa em pontos, e o dono não deveria precisar
   * converter: ele quer "essa letra do tamanho de dois milímetros", e é isso
   * que a régua da tela mostra.
   */
  tamanhoMm: z.number().min(0.8).max(30),
  negrito: z.boolean(),
  alinhamento: z.enum(["left", "center", "right"]),
});

export type LabelElement = z.infer<typeof labelElementSchema>;

/**
 * Lista vazia é diferente de nula.
 *
 * Nula significa "use o desenho padrão" — o empilhado, que atende a etiqueta
 * comum e é o que as etiquetas antigas usam. Vazia significa "o dono apagou
 * tudo", e uma etiqueta em branco é uma escolha legítima dele.
 */
export const labelElementsSchema = z.array(labelElementSchema).max(30);

/**
 * O desenho padrão, para quem abre o editor pela primeira vez.
 *
 * Reproduz o formato empilhado que existia antes: nome em cima, código e
 * tamanho na linha seguinte, barras no meio, preço embaixo. Assim o dono
 * começa a mexer no que já conhece, em vez de encarar uma folha em branco.
 */
export function desenhoPadrao(larguraMm: number, alturaMm: number): LabelElement[] {
  const margem = Math.min(1.5, larguraMm * 0.06);
  const largura = larguraMm - margem * 2;

  return [
    {
      id: "nome",
      campo: "NOME",
      xMm: margem,
      yMm: margem,
      larguraMm: largura,
      tamanhoMm: 2,
      negrito: true,
      alinhamento: "center",
    },
    {
      id: "sku",
      campo: "SKU",
      xMm: margem,
      yMm: margem + 3,
      larguraMm: largura,
      tamanhoMm: 1.8,
      negrito: false,
      alinhamento: "center",
    },
    {
      id: "barras",
      campo: "CODIGO_BARRAS",
      xMm: margem,
      yMm: margem + 5.6,
      larguraMm: largura,
      alturaMm: Math.max(4, alturaMm * 0.3),
      tamanhoMm: 1.6,
      negrito: false,
      alinhamento: "center",
    },
    {
      id: "preco",
      campo: "PRECO",
      xMm: margem,
      yMm: Math.max(margem + 9, alturaMm - margem - 3),
      larguraMm: largura,
      tamanhoMm: 2.6,
      negrito: true,
      alinhamento: "center",
    },
  ];
}
