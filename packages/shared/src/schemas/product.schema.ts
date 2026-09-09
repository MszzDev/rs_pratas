/**
 * Os acabamentos que a loja usa.
 *
 * Uma lista de sugestões, não uma trava: o campo no banco é texto livre porque
 * joalheria inventa acabamento novo com frequência ("ouro velho", "ródio
 * negro"), e cada um exigiria migração se fosse enum.
 *
 * A lista serve à tela — oferecendo os conhecidos, evita a maior parte dos
 * erros de digitação, que são o que quebra o filtro depois: "Dourado" e
 * "dourado" viram dois acabamentos diferentes na hora de agrupar a gaveta.
 */
export const ACABAMENTOS = [
  "Prata",
  "Dourado",
  "Ródio",
  "Ouro rosé",
  "Ouro velho",
  "Ródio negro",
] as const;

export type Acabamento = (typeof ACABAMENTOS)[number];
