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
   * Envio pelo correio.
   *
   * A etiqueta da peça responde "o que é isto e quanto custa"; a do pacote
   * responde "para onde vai e quem mandou". São perguntas diferentes, e por
   * isso campos diferentes — mas o mesmo editor, o mesmo desenho e a mesma
   * impressora, porque a mecânica de posicionar em milímetros não muda.
   */
  "DESTINATARIO",
  /** Logradouro, número e complemento. Ocupa mais de uma linha. */
  "ENDERECO_ENTREGA",
  "BAIRRO",
  "CIDADE_UF",
  "CEP",
  /** A loja que despachou, em bloco: nome, endereço e cidade. */
  "REMETENTE",
  /** O código da venda, para casar o pacote com o pedido. */
  "PEDIDO",
] as const;

export type CampoDaEtiqueta = (typeof CAMPOS_DA_ETIQUETA)[number];

/**
 * Campos que ocupam mais de uma linha.
 *
 * O resto da etiqueta corta o que não cabe: numa etiqueta de joia, um nome
 * longo transbordando é melhor que ele empurrando o preço para fora do papel.
 * Endereço é o oposto — cortar "Rua das Palmeiras, 1042, apto 71" no meio faz
 * o pacote não chegar. Estes quebram e continuam na linha de baixo.
 */
export const CAMPOS_DE_VARIAS_LINHAS: readonly CampoDaEtiqueta[] = [
  "ENDERECO_ENTREGA",
  "REMETENTE",
  "DESTINATARIO",
];

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

/**
 * O desenho padrão de uma etiqueta de pacote.
 *
 * Segue a ordem que o carteiro lê: destinatário grande no meio, endereço
 * abaixo, CEP em destaque no rodapé — porque é o CEP que decide a triagem — e
 * o remetente pequeno no topo, que é onde ele deve ficar para não competir com
 * o destino.
 *
 * As medidas assumem uma etiqueta grande (100 × 125 mm é a comum). Numa
 * pequena os elementos vão se sobrepor, e o dono ajusta arrastando — a conta
 * aqui é um ponto de partida, não uma promessa de caber em qualquer rolo.
 */
export function desenhoDeEnvio(larguraMm: number, alturaMm: number): LabelElement[] {
  const margem = Math.min(5, larguraMm * 0.05);
  const largura = larguraMm - margem * 2;

  return [
    {
      id: "remetente",
      campo: "REMETENTE",
      xMm: margem,
      yMm: margem,
      larguraMm: largura,
      alturaMm: Math.max(10, alturaMm * 0.14),
      tamanhoMm: 2.4,
      negrito: false,
      alinhamento: "left",
    },
    {
      id: "pedido",
      campo: "PEDIDO",
      xMm: margem,
      yMm: margem + Math.max(11, alturaMm * 0.15),
      larguraMm: largura,
      tamanhoMm: 2.6,
      negrito: false,
      alinhamento: "right",
    },
    {
      id: "destinatario",
      campo: "DESTINATARIO",
      xMm: margem,
      yMm: margem + Math.max(16, alturaMm * 0.22),
      larguraMm: largura,
      alturaMm: Math.max(8, alturaMm * 0.1),
      tamanhoMm: 4.5,
      negrito: true,
      alinhamento: "left",
    },
    {
      id: "endereco",
      campo: "ENDERECO_ENTREGA",
      xMm: margem,
      yMm: margem + Math.max(26, alturaMm * 0.33),
      larguraMm: largura,
      alturaMm: Math.max(12, alturaMm * 0.16),
      tamanhoMm: 3.4,
      negrito: false,
      alinhamento: "left",
    },
    {
      id: "bairro",
      campo: "BAIRRO",
      xMm: margem,
      yMm: margem + Math.max(40, alturaMm * 0.5),
      larguraMm: largura,
      tamanhoMm: 3.4,
      negrito: false,
      alinhamento: "left",
    },
    {
      id: "cidade",
      campo: "CIDADE_UF",
      xMm: margem,
      yMm: margem + Math.max(46, alturaMm * 0.58),
      larguraMm: largura,
      tamanhoMm: 3.4,
      negrito: false,
      alinhamento: "left",
    },
    {
      id: "cep",
      campo: "CEP",
      xMm: margem,
      yMm: margem + Math.max(53, alturaMm * 0.67),
      larguraMm: largura,
      tamanhoMm: 5,
      negrito: true,
      alinhamento: "left",
    },
    {
      id: "barras",
      campo: "CODIGO_BARRAS",
      xMm: margem,
      yMm: margem + Math.max(62, alturaMm * 0.78),
      larguraMm: largura,
      alturaMm: Math.max(10, alturaMm * 0.13),
      tamanhoMm: 2,
      negrito: false,
      alinhamento: "center",
    },
  ];
}
