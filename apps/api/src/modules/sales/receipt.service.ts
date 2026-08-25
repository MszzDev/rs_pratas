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
