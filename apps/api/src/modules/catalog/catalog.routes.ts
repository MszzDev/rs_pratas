import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { badRequest } from "../../core/errors.js";
import { DatabaseStorage } from "../../core/storage/database.storage.js";
import {
  readProductImage,
  removeProductImage,
  setProductImage,
} from "./product-image.service.js";
import {
  addVariations,
  createCategory,
  createProduct,
  createSizeGrade,
  deactivateProduct,
  getProduct,
  listCategories,
  listProducts,
  listSizeGrades,
  suggestSku,
  updateProduct,
} from "./catalog.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const createCategorySchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(80),
  parentId: z.string().uuid().optional(),
});

const createSizeGradeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(80),
  sizes: z.array(z.string().min(1).max(10)).min(1, "Informe ao menos um tamanho."),
});

/**
 * Preço em centavos não: o valor chega em reais com duas casas e é guardado
 * como Decimal. Centavo inteiro evita erro de ponto flutuante, mas a conversão
 * na borda é mais uma chance de errar por 100 do que de acertar.
 */
const moneySchema = z.number().min(0).max(9_999_999).multipleOf(0.01);

const createProductSchema = z.object({
  /** Deixe vazio para o sistema gerar o próximo código da categoria. */
  sku: z.string().min(1).max(40).optional(),
  name: z.string().min(2).max(160),
  description: z.string().max(2000).optional(),
  categoryId: z.string().uuid().optional(),
  sizeGradeId: z.string().uuid().optional(),
  material: z.string().max(40).optional(),
  weightGrams: z.number().min(0).max(100000).optional(),
  costPrice: moneySchema,
  salePrice: moneySchema,
  sizes: z.array(z.string().min(1).max(10)).optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(2000).optional(),
  categoryId: z.string().uuid().optional(),
  material: z.string().max(40).optional(),
  weightGrams: z.number().min(0).max(100000).optional(),
  costPrice: moneySchema.optional(),
  salePrice: moneySchema.optional(),
  isActive: z.boolean().optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  // No banco, e não em disco: o disco do servidor é apagado a cada
  // publicação, e as fotos das peças sumiam junto. No banco elas entram na
  // cópia semanal, que é testada.
  const storage = new DatabaseStorage();

  app.get(
    "/categories",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_VIEW")] },
    async (request) => listCategories(request),
  );

  app.post(
    "/categories",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_CREATE")] },
    async (request, reply) => {
      const input = createCategorySchema.parse(request.body);
      return reply.status(201).send(await createCategory({ input, request }));
    },
  );

  app.get(
    "/size-grades",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_VIEW")] },
    async (request) => listSizeGrades(request),
  );

  app.post(
    "/size-grades",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_CREATE")] },
    async (request, reply) => {
      const input = createSizeGradeSchema.parse(request.body);
      return reply.status(201).send(await createSizeGrade({ input, request }));
    },
  );

  app.get(
    "/products",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_VIEW")] },
    async (request) => {
      const query = z
        .object({
          search: z.string().max(120).optional(),
          categoryId: z.string().uuid().optional(),
          includeInactive: z.coerce.boolean().optional(),
        })
        .parse(request.query);

      return listProducts({ request, ...query });
    },
  );

  /** O código que o sistema daria à próxima peça — a tela mostra antes de salvar. */
  app.get(
    "/products/next-sku",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_CREATE")] },
    async (request) => {
      const { categoryId } = z
        .object({ categoryId: z.string().uuid().optional() })
        .parse(request.query);

      return { sku: await suggestSku({ companyId: request.user.companyId, categoryId }) };
    },
  );

  app.get(
    "/products/:id",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_VIEW")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return getProduct({ productId: id, request });
    },
  );

  app.post(
    "/products",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_CREATE")] },
    async (request, reply) => {
      const input = createProductSchema.parse(request.body);
      return reply.status(201).send(await createProduct({ input, request }));
    },
  );

  app.patch(
    "/products/:id",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const input = updateProductSchema.parse(request.body);
      return updateProduct({ productId: id, input, request });
    },
  );

  app.post(
    "/products/:id/variations",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const { sizes } = z
        .object({ sizes: z.array(z.string().min(1).max(10)).min(1) })
        .parse(request.body);

      return reply.status(201).send(await addVariations({ productId: id, sizes, request }));
    },
  );

  // ------------------------------------------------------- foto da peça

  app.post(
    "/products/:id/image",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const file = await request.file();

      if (!file) {
        throw badRequest("FILE_REQUIRED", "Escolha a foto da peça.");
      }

      const result = await setProductImage({
        productId: id,
        file: {
          content: await file.toBuffer(),
          fileName: file.filename,
          mimeType: file.mimetype,
        },
        request,
        storage,
      });

      return reply.status(201).send(result);
    },
  );

  /**
   * Serve a foto.
   *
   * Passa pela API e não por pasta pública: uma pasta servida direto entrega
   * arquivo sem autenticação nenhuma, e vira hospedagem do que subirem nela.
   * O checksum vira ETag — foto trocada invalida o cache do navegador na hora.
   */
  app.get(
    "/products/:id/image",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_VIEW")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const image = await readProductImage({ productId: id, request, storage });

      return reply
        .header("content-type", image.mimeType)
        .header("etag", `"${image.checksum}"`)
        // Privado: e catalogo da empresa, nao deve ficar em cache de proxy.
        .header("cache-control", "private, max-age=86400")
        .send(image.content);
    },
  );

  app.delete(
    "/products/:id/image",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return removeProductImage({ productId: id, request, storage });
    },
  );

  app.post(
    "/products/:id/deactivate",
    { preHandler: [app.requireAuth, requirePermission("PRODUCT_EDIT")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(3, "Informe o motivo.").max(500) })
        .parse(request.body);

      return deactivateProduct({ productId: id, reason, request });
    },
  );
}
