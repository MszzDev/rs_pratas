import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { labelElementsSchema } from "@rs-pratas/shared";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import {
  buildBatchFromStock,
  cancelPrintJob,
  createTemplate,
  queueLabelBatch,
  listQueue,
  listTemplates,
  queueProductLabels,
  queueReceipt,
  reportPrintResult,
  saveTemplateElements,
  setDefaultTemplate,
} from "./labels.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createTemplateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(80),
  /** Em milímetros. Etiqueta de joia costuma ficar entre 10 e 60 mm. */
  widthMm: z.number().min(5).max(200),
  heightMm: z.number().min(5).max(200),
  /**
   * A folga entre uma etiqueta e a próxima no rolo.
   *
   * Sem ela o sistema empilha os desenhos colados, e como a impressora avança
   * etiqueta + folga a cada avanço, o erro se acumula: a terceira já sai em
   * cima do picote. Zero é o certo para rolo contínuo.
   */
  gapXMm: z.number().min(0).max(50).optional(),
  gapYMm: z.number().min(0).max(50).optional(),
  /** Quantas etiquetas o rolo tem lado a lado. Um é rolo de coluna única. */
  columnsPerRow: z.number().int().min(1).max(10).optional(),
  /** A largura total da bobina. Tem que bater com o papel do driver. */
  rollWidthMm: z.number().min(0).max(300).optional(),
  isDoubleSided: z.boolean().optional(),
  showProductName: z.boolean().optional(),
  showSku: z.boolean().optional(),
  showPrice: z.boolean().optional(),
  showWeight: z.boolean().optional(),
  showSize: z.boolean().optional(),
  showBarcode: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function labelRoutes(app: FastifyInstance) {
  app.get(
    "/label-templates",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request) => listTemplates(request),
  );

  app.post(
    "/label-templates",
    { preHandler: [app.requireAuth, requirePermission("LABEL_TEMPLATE_MANAGE")] },
    async (request, reply) => {
      const input = createTemplateSchema.parse(request.body);
      return reply.status(201).send(await createTemplate({ input, request }));
    },
  );

  /**
   * O desenho montado no editor.
   *
   * Vive no servidor porque a etiqueta é da EMPRESA: o dono monta uma vez e as
   * cinco lojas imprimem igual. Guardado no aparelho, a mesma peça sairia
   * diferente em cada quiosque.
   */
  app.put(
    "/label-templates/:id/elements",
    { preHandler: [app.requireAuth, requirePermission("LABEL_TEMPLATE_MANAGE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { elements } = z
        .object({ elements: labelElementsSchema })
        .parse(request.body);

      return saveTemplateElements({ templateId: id, elements, request });
    },
  );

  app.post(
    "/print-jobs/labels",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          productId: z.string().uuid(),
          variationId: z.string().uuid().optional(),
          copies: z.number().int().min(1).max(100),
          templateId: z.string().uuid().optional(),
          deviceId: z.string().uuid().optional(),
        })
        .parse(request.body);

      return reply.status(201).send(await queueProductLabels({ input, request }));
    },
  );

  /** Sugestão de lote  /** Qual modelo a impressão usa quando ninguém indica outro. */
  app.patch(
    "/label-templates/:id/default",
    { preHandler: [app.requireAuth, requirePermission("LABEL_TEMPLATE_MANAGE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return setDefaultTemplate({ templateId: id, request });
    },
  );

  /** Sugestão de lote a partir do estoque da loja — uma etiqueta por peça. */
  app.get(
    "/print-jobs/batch-suggestion",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request) => {
      const query = z
        .object({
          storeId: z.string().uuid(),
          categoryId: z.string().uuid().optional(),
          onlyWithStock: z.coerce.boolean().optional(),
        })
        .parse(request.query);

      return buildBatchFromStock({ request, ...query });
    },
  );

  app.post(
    "/print-jobs/labels/batch",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request, reply) => {
      const input = z
        .object({
          storeId: z.string().uuid(),
          templateId: z.string().uuid().optional(),
          deviceId: z.string().uuid().optional(),
          items: z
            .array(
              z.object({
                productId: z.string().uuid(),
                variationId: z.string().uuid().optional(),
                copies: z.number().int().min(1).max(100),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(request.body);

      return reply.status(201).send(await queueLabelBatch({ input, request }));
    },
  );

  app.post(
    "/print-jobs/receipts",
    { preHandler: [app.requireAuth, requirePermission("SALE_CREATE")] },
    async (request, reply) => {
      const input = z
        .object({ saleId: z.string().uuid(), deviceId: z.string().uuid().optional() })
        .parse(request.body);

      return reply.status(201).send(await queueReceipt({ ...input, request }));
    },
  );

  /** O tablet consulta esta rota para saber o que imprimir. */
  app.get(
    "/print-jobs/queue",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request) => {
      const query = z
        .object({ storeId: z.string().uuid(), deviceId: z.string().uuid().optional() })
        .parse(request.query);

      return listQueue({ request, ...query });
    },
  );

  app.post(
    "/print-jobs/:id/result",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({ success: z.boolean(), error: z.string().max(500).optional() })
        .parse(request.body);

      return reportPrintResult({ jobId: id, ...input, request });
    },
  );

  app.post(
    "/print-jobs/:id/cancel",
    { preHandler: [app.requireAuth, requirePermission("LABEL_PRINT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return cancelPrintJob({ jobId: id, request });
    },
  );
}
