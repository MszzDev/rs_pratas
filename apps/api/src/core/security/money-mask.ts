/**
 * Mascaramento de valores monetários para o perfil DESENVOLVEDOR.
 *
 * O perfil enxerga todos os dados operacionais de todas as lojas — para dar
 * suporte técnico — mas nunca valores em dinheiro. Em vez de exigir que cada
 * rota declare quais campos são monetários (o que vaza no dia em que alguém
 * esquece de declarar), a varredura acontece na saída, por convenção de nome:
 * qualquer rota nova já nasce protegida.
 *
 * O custo dessa escolha é o falso positivo — um campo chamado `totalItens`
 * seria mascarado sem necessidade. Por isso existe a lista NON_MONETARY, e o
 * princípio adotado é: na dúvida, mascarar. Esconder um número a mais para o
 * suporte é irrelevante; expor faturamento é o que não pode acontecer.
 */

const MONEY_FIELD_PATTERNS = [
  /price/i,
  /cost/i,
  /margin/i,
  /amount/i,
  /total/i,
  /subtotal/i,
  /discount/i,
  /revenue/i,
  /balance/i,
  /commission/i,
  /salary/i,
  /fee/i,
  /valor/i,
  /preco/i,
  /preço/i,
  /custo/i,
  /margem/i,
  /desconto/i,
  /faturamento/i,
  /comissao/i,
  /comissão/i,
  /lucro/i,
  /ticket/i,
  /troco/i,
  /sangria/i,
  /suprimento/i,
];

/** Campos que casam com os padrões acima mas não representam dinheiro. */
const NON_MONETARY = new Set([
  "totalitems",
  "totalitens",
  "totalcount",
  "totalpages",
  "totalregistros",
  "totalquantity",
  "totalquantidade",
  "pricelistid",
  "discounttype",
  "tipodesconto",
]);

export const MASKED_VALUE = null;
export const MASK_FLAG = "_masked";

export function isMoneyField(fieldName: string): boolean {
  if (NON_MONETARY.has(fieldName.toLowerCase())) {
    return false;
  }
  return MONEY_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Percorre a estrutura e substitui todo valor monetário por null, marcando o
 * objeto com `_masked: true` para o frontend saber que aquilo foi ocultado
 * (e mostrar "—" em vez de "R$ 0,00", que seria uma informação falsa).
 */
export function maskMoneyDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskMoneyDeep(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  let maskedAny = false;

  for (const [key, fieldValue] of Object.entries(source)) {
    if (isMoneyField(key) && (typeof fieldValue === "number" || typeof fieldValue === "string")) {
      result[key] = MASKED_VALUE;
      maskedAny = true;
      continue;
    }
    result[key] = maskMoneyDeep(fieldValue);
  }

  if (maskedAny) {
    result[MASK_FLAG] = true;
  }

  return result;
}
