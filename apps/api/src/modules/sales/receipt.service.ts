import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { sendEmail } from "../../core/email/index.js";
import { saleReceiptEmail, warrantyEmail } from "../../core/email/sale-templates.js";

/**
 * Envio do comprovante e da garantia.
 *
 * Nunca derruba a venda. O envio acontece DEPOIS que a venda já está gravada,
 * e uma falha de e-mail vira aviso, não erro: o servidor de e-mail fora do ar
 * não pode fazer a peça voltar para a prateleira com o cliente já na porta.
 *
 * Por isso também existe o reenvio: o e-mail errado no cadastro é o caso
 * comum, e sem reenviar a única saída seria refazer a venda.
 */

/**
 * O comprovante em texto, pronto para ir pelo WhatsApp.
 *
 * Não envia nada: devolve o texto e o telefone, e quem abre a conversa é a
 * pessoa, no aplicativo dela. É a diferença entre "o sistema manda mensagem
 * pelo seu número" — que exigiria conta de API, aprovação de modelo de
 * mensagem e mensalidade — e "o sistema escreve a mensagem para você mandar",
 * que funciona hoje, de graça, no celular que a loja já tem.
 *
 * E é honesto com o cliente: a mensagem chega do número da loja, com o nome
 * de quem atendeu, e não de um robô desconhecido.
 */
export async function getReceiptText(params: { saleId: string; request: FastifyRequest }) {
  const { saleId, request } = params;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: request.user.companyId },
    include: {
      customer: true,
      seller: { select: { name: true } },
      store: { select: { name: true } },
      items: true,
      payments: true,
    },
  });

  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: request.user.companyId },
    select: { tradeName: true },
  });

  const mensagem = saleReceiptEmail({
    // O endereço não é usado: só o corpo do texto interessa aqui.
    to: sale.customer?.email ?? "",
    customerName: sale.customer?.name ?? "cliente",
    companyName: company.tradeName,
    storeName: sale.store.name,
    saleCode: sale.code,
    completedAt: sale.completedAt ?? sale.createdAt,
    sellerName: sale.seller?.name ?? "a loja",
    totalAmount: sale.totalAmount.toString(),
    discountAmount: sale.discountAmount?.toString() ?? null,
    items: sale.items.map((item) => ({
      productName: item.productName,
      productSku: item.productSku,
      size: null,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      totalPrice: item.totalAmount.toString(),
    })),
    payments: sale.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount.toString(),
      installments: payment.installments,
    })),
  });

  const telefone = (sale.customer?.phone ?? "").replace(/\D/g, "");

  return {
    texto: mensagem.text,
    telefone: telefone || null,
    /**
     * Endereço que abre a conversa já com a mensagem escrita. Com o telefone,
     * abre a conversa daquele cliente; sem ele, abre o WhatsApp para a pessoa
     * escolher com quem falar — que é o caso da venda sem cadastro.
     */
    whatsappUrl: telefone
      ? `https://wa.me/55${telefone}?text=${encodeURIComponent(mensagem.text)}`
      : `https://wa.me/?text=${encodeURIComponent(mensagem.text)}`,
  };
}

export async function sendSaleReceipt(params: { saleId: string; request: FastifyRequest }) {
  const { saleId, request } = params;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: request.user.companyId },
    include: {
      customer: true,
      seller: { select: { name: true } },
      store: { select: { name: true } },
      items: true,
      payments: true,
    },
  });

  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }

  if (!sale.customer?.email) {
    throw badRequest(
      "CUSTOMER_WITHOUT_EMAIL",
      "Esta venda não tem cliente com e-mail cadastrado. Cadastre o e-mail em Clientes e envie de novo.",
    );
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: request.user.companyId },
    select: { tradeName: true },
  });

  const enviado = await sendEmail(
    saleReceiptEmail({
      to: sale.customer.email,
      customerName: sale.customer.name,
      companyName: company.tradeName,
      storeName: sale.store.name,
      saleCode: sale.code,
      completedAt: sale.completedAt ?? sale.createdAt,
      sellerName: sale.seller?.name ?? "a loja",
      totalAmount: sale.totalAmount.toString(),
      discountAmount: sale.discountAmount?.toString() ?? null,
      items: sale.items.map((item) => ({
        productName: item.productName,
        productSku: item.productSku,
        // O item guarda o id da variacao, nao o tamanho escrito. Buscar o
        // nome do tamanho exigiria outra consulta so para o e-mail — e o
        // nome do produto ja identifica a peca para quem comprou.
        size: null,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toString(),
        totalPrice: item.totalAmount.toString(),
      })),
      payments: sale.payments.map((pagamento) => ({
        method: pagamento.method,
        amount: pagamento.amount.toString(),
        installments: pagamento.installments,
      })),
    }),
  );

  await audit(request, {
    action: "DATA_EXPORT",
    result: enviado ? "SUCCESS" : "FAILURE",
    userId: request.user.sub,
    companyId: sale.companyId,
    storeId: sale.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Sale",
    entityId: sale.id,
    reason: "comprovante enviado por e-mail",
    // O endereço entra na auditoria porque a pergunta que se faz depois é
    // "para onde foi?" — e a resposta precisa existir.
    metadata: { to: sale.customer.email, enviado },
  });

  return {
    enviado,
    to: sale.customer.email,
    mensagem: enviado
      ? `Comprovante enviado para ${sale.customer.email}.`
      : "O comprovante não saiu. Confira o e-mail do cliente e a configuração de envio.",
  };
}

export async function sendWarrantyEmail(params: { warrantyId: string; request: FastifyRequest }) {
  const { warrantyId, request } = params;

  const warranty = await prisma.warranty.findFirst({
    where: { id: warrantyId, companyId: request.user.companyId },
    include: {
      saleItem: {
        include: {
          sale: {
            include: { customer: true, store: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!warranty) {
    throw notFound("WARRANTY_NOT_FOUND", "Garantia não encontrada.");
  }

  const cliente = warranty.saleItem.sale.customer;

  if (!cliente?.email) {
    throw badRequest(
      "CUSTOMER_WITHOUT_EMAIL",
      "A venda desta garantia não tem cliente com e-mail cadastrado.",
    );
  }

  if (warranty.voidedAt) {
    throw badRequest(
      "WARRANTY_VOIDED",
      "Esta garantia foi cancelada — enviá-la ao cliente prometeria algo que não vale mais.",
    );
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: request.user.companyId },
    select: { tradeName: true },
  });

  const enviado = await sendEmail(
    warrantyEmail({
      to: cliente.email,
      customerName: cliente.name,
      companyName: company.tradeName,
      productName: warranty.saleItem.productName,
      productSku: warranty.saleItem.productSku,
      warrantyCode: warranty.code,
      months: warranty.months,
      startsAt: warranty.startsAt,
      expiresAt: warranty.expiresAt,
      terms: warranty.terms,
      storeName: warranty.saleItem.sale.store.name,
    }),
  );

  await audit(request, {
    action: "WARRANTY_ISSUE",
    result: enviado ? "SUCCESS" : "FAILURE",
    userId: request.user.sub,
    companyId: warranty.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Warranty",
    entityId: warranty.id,
    reason: "garantia enviada por e-mail",
    metadata: { to: cliente.email, enviado },
  });

  return {
    enviado,
    to: cliente.email,
    mensagem: enviado
      ? `Garantia enviada para ${cliente.email}.`
      : "A garantia não saiu. Confira o e-mail do cliente e a configuração de envio.",
  };
}

/**
 * O envio que acontece sozinho, assim que a venda fecha.
 *
 * No tablet do balcão ninguém aperta botão de comprovante: a fila anda, o
 * cliente vai embora, e o botão que exige um toque a mais é o botão que não
 * é apertado. Então o comprovante — e a garantia, quando já existe — saem por
 * conta própria, por trás, sem tela nenhuma e sem abrir outro aplicativo.
 *
 * Três decisões que valem explicar:
 *
 * - NÃO derruba a venda. É chamado sem esperar resposta, e engole qualquer
 *   erro: servidor de e-mail fora do ar não pode desfazer uma venda que já
 *   está gravada e paga.
 * - Sem e-mail do cliente, não faz nada e não reclama. Venda sem cadastro é o
 *   caso comum no quiosque, e transformar isso em aviso na tela treinaria a
 *   vendedora a ignorar avisos.
 * - O que sai fica auditado. "O cliente diz que não recebeu" é uma pergunta
 *   que se responde com registro, não com memória.
 */
export async function enviarComprovanteAutomatico(params: {
  saleId: string;
  request: FastifyRequest;
}): Promise<void> {
  const { saleId, request } = params;

  try {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, companyId: request.user.companyId },
      select: {
        id: true,
        customer: { select: { email: true } },
        items: {
          select: {
            warranty: { select: { id: true, voidedAt: true } },
          },
        },
      },
    });

    if (!sale?.customer?.email) return;

    await sendSaleReceipt({ saleId, request });

    for (const item of sale.items) {
      if (item.warranty && !item.warranty.voidedAt) {
        await sendWarrantyEmail({ warrantyId: item.warranty.id, request });
      }
    }
  } catch (erro) {
    // Só o log: quem está no balcão não tem o que fazer com esta informação, e
    // o reenvio manual continua disponível na tela da venda.
    request.log.warn({ erro, saleId }, "comprovante automático não saiu");
  }
}
