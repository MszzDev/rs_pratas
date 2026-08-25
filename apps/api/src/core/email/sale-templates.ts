import type { EmailMessage } from "./email.provider.js";

/**
 * Comprovante e garantia por e-mail.
 *
 * Texto puro, como o resto dos e-mails do sistema. A escolha não é preguiça:
 * o comprovante precisa continuar legível daqui a dois anos, quando a cliente
 * for procurar a garantia no meio da caixa de entrada. HTML com imagem
 * hospedada quebra; texto não.
 *
 * Sem link e sem anexo, pelo mesmo motivo dos outros: a caixa de e-mail da
 * cliente não é porta de entrada do sistema, e um PDF anexado costuma cair na
 * pasta de spam justamente das lojas pequenas.
 */

const dinheiro = (valor: string | number) =>
  Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataCurta = (data: Date) => data.toLocaleDateString("pt-BR");

export interface ItemDoComprovante {
  productName: string;
  productSku: string;
  size?: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

export function saleReceiptEmail(params: {
  to: string;
  customerName: string;
  companyName: string;
  storeName: string;
  saleCode: string;
  completedAt: Date;
  items: ItemDoComprovante[];
  totalAmount: string;
  discountAmount?: string | null;
  payments: Array<{ method: string; amount: string; installments?: number | null }>;
  sellerName: string;
}): EmailMessage {
  const primeiroNome = params.customerName.split(" ")[0] ?? params.customerName;

  const linhasDosItens = params.items.map((item) => {
    const tamanho = item.size ? ` (tam. ${item.size})` : "";
    const quantas = item.quantity > 1 ? `${item.quantity}x ` : "";

    return `  ${quantas}${item.productName}${tamanho} — ${dinheiro(item.totalPrice)}`;
  });

  const linhasDoPagamento = params.payments.map((pagamento) => {
    const parcelas =
      pagamento.installments && pagamento.installments > 1 ? ` em ${pagamento.installments}x` : "";

    return `  ${METODO[pagamento.method] ?? pagamento.method}${parcelas}: ${dinheiro(pagamento.amount)}`;
  });

  const desconto =
    params.discountAmount && Number(params.discountAmount) > 0
      ? [`  Desconto: -${dinheiro(params.discountAmount)}`]
      : [];

  return {
    to: params.to,
    subject: `Seu comprovante da ${params.companyName} — compra ${params.saleCode}`,
    text: [
      `Olá, ${primeiroNome}. Obrigado pela sua compra!`,
      "",
      `Compra ${params.saleCode}`,
      `${params.storeName} · ${dataCurta(params.completedAt)}`,
      `Atendimento: ${params.sellerName}`,
      "",
      "O que você levou:",
      ...linhasDosItens,
      "",
      ...desconto,
      `  TOTAL: ${dinheiro(params.totalAmount)}`,
      "",
      "Como foi pago:",
      ...linhasDoPagamento,
      "",
      "----------------------------------------",
      "",
      "Guarde este e-mail. Ele é o seu comprovante para troca, garantia ou",
      "qualquer dúvida sobre a compra — o código acima é o que a loja usa para",
      "encontrar tudo.",
      "",
      "Peças de prata escurecem com o tempo pelo contato com o ar; isso não é",
      "defeito e sai com flanela. Evite perfume, cloro e produtos de limpeza",
      "direto na peça.",
      "",
      params.companyName,
    ].join("\n"),
  };
}

/** Como cada forma de pagamento aparece para quem lê. */
const METODO: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  DEBITO: "Cartão de débito",
  CREDITO: "Cartão de crédito",
  CREDITO_PARCELADO: "Cartão de crédito",
  TRANSFERENCIA: "Transferência",
  CREDIARIO: "Crediário da loja",
};

/**
 * Certificado de garantia da peça.
 *
 * Vai separado do comprovante de propósito. A garantia é procurada meses
 * depois, sozinha, e um e-mail com o assunto certo se encontra pela busca da
 * caixa de entrada — enquanto um parágrafo dentro do comprovante se perde.
 */
export function warrantyEmail(params: {
  to: string;
  customerName: string;
  companyName: string;
  productName: string;
  productSku: string;
  warrantyCode: string;
  months: number;
  startsAt: Date;
  expiresAt: Date;
  terms: string;
  storeName: string;
}): EmailMessage {
  const primeiroNome = params.customerName.split(" ")[0] ?? params.customerName;

  return {
    to: params.to,
    subject: `Garantia da sua peça — ${params.productName} (${params.warrantyCode})`,
    text: [
      `Olá, ${primeiroNome}.`,
      "",
      "Esta é a garantia da peça que você comprou:",
      "",
      `  Peça: ${params.productName}`,
      `  Código: ${params.productSku}`,
      `  Garantia nº ${params.warrantyCode}`,
      `  Prazo: ${params.months} meses`,
      `  Válida de ${dataCurta(params.startsAt)} até ${dataCurta(params.expiresAt)}`,
      "",
      "O que a garantia cobre:",
      "",
      params.terms,
      "",
      "----------------------------------------",
      "",
      "Para acionar, procure a loja com este e-mail e a peça. Não precisa da",
      "nota impressa: o número da garantia acima encontra tudo.",
      "",
      `  ${params.storeName}`,
      "",
      "Guarde este e-mail até o fim do prazo.",
      "",
      params.companyName,
    ].join("\n"),
  };
}
