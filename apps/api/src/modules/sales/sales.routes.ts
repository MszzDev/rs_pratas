import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { cancelSale, completeSale, getSale, listSales } from "./sales.service.js";
import {
  cancelReservation,
  createReservation,
  listReservations,
} from "./reservations.service.js";
import {
  cancelPieceRequest,
  createPieceRequest,
  demandSummary,
  listPieceRequests,
  updatePieceRequest,
} from "./piece-requests.service.js";
import {
  createQuote,
  getQuote,
  listQuotes,
  markQuoteConverted,
  prepareQuoteConversion,
} from "./quotes.service.js";
import { getReceiptText, sendSaleReceipt, sendWarrantyEmail } from "./receipt.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });
const moneySchema = z.number().min(0).max(9_999_999).multipleOf(0.01);

const PAYMENT_METHODS = [
  "DINHEIRO",
  "PIX",
  "DEBITO",
  "CREDITO",
  "CREDITO_PARCELADO",
  "TRANSFERENCIA",
  "CREDIARIO",
] as const;

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  variationId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
  discountAmount: moneySchema.optional(),
});

const salePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: moneySchema.refine((value) => value > 0, "O valor precisa ser maior que zero."),
  installments: z.number().int().min(1).max(24).optional(),
  terminalId: z.string().uuid().optional(),
  authorizationCode: z.string().max(60).optional(),
  tenderedAmount: moneySchema.optional(),
});

/**
 * Repare no que NÃO está aqui: preço unitário e total.
 *
 * O aplicativo manda o que o cliente vai levar e quanto de desconto foi
 * pedido. O quanto custa é decidido no servidor, contra o catálogo. Aceitar
 * preço da tela permitiria comprar um anel por um real alterando a requisição.
 */
const completeSaleSchema = z.object({
  storeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  items: z.array(saleItemSchema).min(1),
  payments: z.array(salePaymentSchema).min(1).max(4),
  discountAmount: moneySchema.optional(),
  discountAuthorizedById: z.string().uuid().optional(),
  discountReason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  reservationId: z.string().uuid().optional(),
});

export async function saleRoutes(app: FastifyInstance) {
  app.get(
    "/sales",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          sessionId: z.string().uuid().optional(),
          customerId: z.string().uuid().optional(),
        })
        .parse(request.query);

      return listSales({ request, ...query });
    },
  );

  app.get(
    "/sales/:id",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getSale({ saleId: id, request });
    },
  );

  app.post(
    "/sales",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = completeSaleSchema.parse(request.body);
      const sale = await completeSale({ input, request });
      return reply.status(201).send(sale);
    },
  );

  app.post(
    "/sales/:id/cancel",
    { preHandler: [app.requireAuth, requirePermission("SALE_CANCEL")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(5, "Explique o motivo do cancelamento.").max(500) })
        .parse(request.body);

      return cancelSale({ saleId: id, reason, request });
    },
  );

  // ------------------------------------------------------------- reservas

  app.get(
    "/reservations",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          status: z.enum(["ATIVA", "CONVERTIDA", "CANCELADA", "EXPIRADA"]).optional(),
        })
        .parse(request.query);

      return listReservations({ request, ...query });
    },
  );

  app.post(
    "/reservations",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          customerId: z.string().uuid(),
          productId: z.string().uuid(),
          variationId: z.string().uuid().optional(),
          quantity: z.number().int().positive().max(50).optional(),
          depositAmount: moneySchema.optional(),
          days: z.number().int().min(1).max(90).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await createReservation({ input, request }));
    },
  );

  app.post(
    "/reservations/:id/cancel",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(3, "Informe o motivo.").max(500) })
        .parse(request.body);

      return cancelReservation({ reservationId: id, reason, request });
    },
  );

  // ------------------------------------------------- solicitação de peça

  app.get(
    "/piece-requests",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          status: z
            .enum(["ABERTA", "PROCURANDO", "ENCONTRADA", "AVISADO", "CONCLUIDA", "CANCELADA"])
            .optional(),
          emAberto: z.coerce.boolean().optional(),
        })
        .parse(request.query);

      return listPieceRequests({ request, ...query });
    },
  );

  /** O que as pessoas pedem e a loja não tem — base da próxima compra. */
  app.get(
    "/piece-requests/demand",
    { preHandler: [app.requireAuth, requirePermission("REPORT_VIEW_STORE")] },
    async (request) => {
      const { storeId } = z.object({ storeId: z.string().uuid().optional() }).parse(request.query);
      return demandSummary({ request, storeId });
    },
  );

  app.post(
    "/piece-requests",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          customerName: z.string().min(2, "Informe o nome de quem pediu.").max(120),
          customerPhone: z.string().min(10, "Informe o telefone com DDD.").max(20),
          description: z.string().min(3, "Descreva a peça que o cliente quer.").max(1000),
          customerId: z.string().uuid().optional(),
          productId: z.string().uuid().optional(),
          size: z.string().max(10).optional(),
          budgetAmount: moneySchema.optional(),
          notes: z.string().max(1000).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await createPieceRequest({ input, request }));
    },
  );

  app.patch(
    "/piece-requests/:id",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          status: z
            .enum(["ABERTA", "PROCURANDO", "ENCONTRADA", "AVISADO", "CONCLUIDA"])
            .optional(),
          notes: z.string().max(1000).optional(),
        })
        .parse(request.body);

      return updatePieceRequest({ requestId: id, input, request });
    },
  );

  app.post(
    "/piece-requests/:id/cancel",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(3, "Informe o motivo.").max(500) })
        .parse(request.body);

      return cancelPieceRequest({ requestId: id, reason, request });
    },
  );

  // ----------------------------------------------------------- orçamentos

  app.get(
    "/quotes",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid().optional(),
          status: z.enum(["ABERTO", "CONVERTIDO", "RECUSADO", "EXPIRADO"]).optional(),
        })
        .parse(request.query);

      return listQuotes({ request, ...query });
    },
  );

  app.get(
    "/quotes/:id",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getQuote({ quoteId: id, request });
    },
  );

  app.post(
    "/quotes",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          customerId: z.string().uuid().optional(),
          customerName: z.string().min(2).max(120).optional(),
          customerPhone: z.string().max(20).optional(),
          items: z
            .array(
              z.object({
                productId: z.string().uuid(),
                variationId: z.string().uuid().optional(),
                quantity: z.number().int().positive(),
              }),
            )
            .min(1),
          discountAmount: moneySchema.optional(),
          validDays: z.number().int().min(1).max(90).optional(),
          notes: z.string().max(1000).optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await createQuote({ input, request }));
    },
  );

  app.get(
    "/quotes/:id/conversion",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return prepareQuoteConversion({ quoteId: id, request });
    },
  );

  app.post(
    "/quotes/:id/converted",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { saleId } = z.object({ saleId: z.string().uuid() }).parse(request.body);

      return markQuoteConverted({ quoteId: id, saleId, request });
    },
  );

  /**
   * Comprovante por e-mail.
   *
   * Rota propria, e nao um passo dentro da venda: o envio precisa poder ser
   * REPETIDO. E-mail digitado errado no cadastro e o caso comum, e sem
   * reenvio a unica saida seria refazer a venda.
   */
  app.post(
    "/sales/:id/receipt",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return sendSaleReceipt({ saleId: id, request });
    },
  );

  /**
   * O mesmo comprovante, em texto, para ir pelo WhatsApp da loja.
   *
   * Nao envia: devolve a mensagem pronta e o telefone do cliente. Quem manda
   * e a pessoa, do proprio aparelho — o que dispensa conta de API, aprovacao
   * de modelo e mensalidade, e faz a mensagem chegar do numero da loja.
   */
  app.get(
    "/sales/:id/receipt-text",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getReceiptText({ saleId: id, request });
    },
  );

  app.post(
    "/warranties/:id/email",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return sendWarrantyEmail({ warrantyId: id, request });
    },
  );
}
