import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";

/**
 * O catálogo é da EMPRESA, não da loja: o mesmo anel existe nas três lojas com
 * o mesmo código. O que é por loja é o estoque, não o produto.
 */

export async function listCategories(request: FastifyRequest) {
  return prisma.category.findMany({
    where: { companyId: request.user.companyId, deletedAt: null },
    orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
}

export async function createCategory(params: {
  input: { code: string; name: string; parentId?: string | undefined };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  if (input.parentId) {
    const parent = await prisma.category.findFirst({
      where: { id: input.parentId, companyId: request.user.companyId, deletedAt: null },
      select: { parentId: true },
    });
    if (!parent) {
      throw notFound("CATEGORY_NOT_FOUND", "Categoria pai não encontrada.");
    }
    // Um nível de profundidade. Mais que isso vira uma árvore que ninguém
    // consegue navegar num tablet de balcão.
    if (parent.parentId) {
      throw badRequest(
        "CATEGORY_TOO_DEEP",
        "Uma subcategoria não pode ter subcategorias. Use no máximo dois níveis.",
      );
    }
  }

  const existing = await prisma.category.findFirst({
    where: { companyId: request.user.companyId, code: input.code },
    select: { id: true },
  });
  if (existing) {
    throw conflict("CATEGORY_CODE_TAKEN", "Já existe uma categoria com este código.");
  }

  const category = await prisma.category.create({
    data: {
      companyId: request.user.companyId,
      code: input.code,
      name: input.name,
      parentId: input.parentId ?? null,
    },
  });

  await audit(request, {
    action: "CATEGORY_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Category",
    entityId: category.id,
    newData: { code: category.code, name: category.name, parentId: category.parentId },
  });

  return category;
}

export async function listSizeGrades(request: FastifyRequest) {
  return prisma.sizeGrade.findMany({
    where: { companyId: request.user.companyId, deletedAt: null },
    orderBy: { name: "asc" },
  });
}

export async function createSizeGrade(params: {
  input: { code: string; name: string; sizes: string[] };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const unique = new Set(input.sizes);
  if (unique.size !== input.sizes.length) {
    throw badRequest("DUPLICATE_SIZE", "A grade tem tamanhos repetidos.");
  }

  const existing = await prisma.sizeGrade.findFirst({
    where: { companyId: request.user.companyId, code: input.code },
    select: { id: true },
  });
  if (existing) {
    throw conflict("GRADE_CODE_TAKEN", "Já existe uma grade com este código.");
  }

  return prisma.sizeGrade.create({
    data: {
      companyId: request.user.companyId,
      code: input.code,
      name: input.name,
      sizes: input.sizes,
    },
  });
}

/**
 * Próximo código livre da categoria.
 *
 * O código é gerado, não digitado: quem cadastra peça no balcão inventa o
 * padrão que lembra na hora, e em três meses o catálogo tem "AN1", "an-002" e
 * "ANEL 3" apontando para coisas parecidas. Um código que o sistema escolhe é
 * previsível, cabe na etiqueta e não colide.
 *
 * O prefixo vem da categoria (ANEL → AN); sem categoria, usa PC de peça. A
 * numeração é por prefixo e não global, para o código dizer o que é a peça
 * antes mesmo de alguém ler o nome.
 */
export async function suggestSku(params: {
  companyId: string;
  categoryId?: string | undefined;
}): Promise<string> {
  let prefixo = "PC";

  if (params.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: params.categoryId, companyId: params.companyId },
      select: { code: true },
    });

    if (category) {
      // Duas primeiras letras do código da categoria, só A-Z: o código da
      // etiqueta é lido por gente e por leitor, e nenhum dos dois lida bem
      // com acento ou símbolo.
      const limpo = category.code.toUpperCase().replace(/[^A-Z]/g, "");
      if (limpo.length >= 2) prefixo = limpo.slice(0, 2);
    }
  }

  // Procura o maior número JÁ USADO no prefixo em vez de contar quantos
  // existem: com produto removido no meio, a contagem devolveria um número
  // que já foi de outra peça.
  const usados = await prisma.product.findMany({
    where: { companyId: params.companyId, sku: { startsWith: `${prefixo}-` } },
    select: { sku: true },
  });

  const maior = usados.reduce((maximo, produto) => {
    const numero = Number(produto.sku.slice(prefixo.length + 1));
    return Number.isFinite(numero) && numero > maximo ? numero : maximo;
  }, 0);

  return `${prefixo}-${String(maior + 1).padStart(4, "0")}`;
}

export async function listProducts(params: {
  request: FastifyRequest;
  search?: string | undefined;
  categoryId?: string | undefined;
  includeInactive?: boolean | undefined;
}) {
  const { request, search, categoryId, includeInactive } = params;

  return prisma.product.findMany({
    where: {
      companyId: request.user.companyId,
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
              { variations: { some: { barcode: search } } },
            ],
          }
        : {}),
    },
    include: {
      category: { select: { name: true } },
      sizeGrade: { select: { name: true, sizes: true } },
      variations: {
        where: { deletedAt: null },
        orderBy: { size: "asc" },
      },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getProduct(params: { productId: string; request: FastifyRequest }) {
  const product = await prisma.product.findFirst({
    where: { id: params.productId, companyId: params.request.user.companyId, deletedAt: null },
    include: {
      category: true,
      sizeGrade: true,
      variations: { where: { deletedAt: null }, orderBy: { size: "asc" } },
      stockItems: {
        include: { store: { select: { name: true } } },
      },
    },
  });

  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }

  return product;
}

export async function createProduct(params: {
  input: {
    /** Opcional: sem ele, o sistema gera o próximo livre da categoria. */
    sku?: string | undefined;
    name: string;
    description?: string | undefined;
    categoryId?: string | undefined;
    sizeGradeId?: string | undefined;
    material?: string | undefined;
    weightGrams?: number | undefined;
    costPrice: number;
    salePrice: number;
    /** Tamanhos que a loja realmente comprou. Vazio = produto sem variação. */
    sizes?: string[] | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  const companyId = request.user.companyId;

  const sku =
    input.sku?.trim() ||
    (await suggestSku({ companyId, categoryId: input.categoryId }));

  const taken = await prisma.product.findFirst({
    where: { companyId, sku },
    select: { id: true },
  });
  if (taken) {
    throw conflict("SKU_TAKEN", "Já existe um produto com este código.");
  }

  if (input.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      throw notFound("CATEGORY_NOT_FOUND", "Categoria não encontrada.");
    }
  }

  if (input.sizeGradeId) {
    const grade = await prisma.sizeGrade.findFirst({
      where: { id: input.sizeGradeId, companyId, deletedAt: null },
      select: { sizes: true },
    });
    if (!grade) {
      throw notFound("GRADE_NOT_FOUND", "Grade de tamanhos não encontrada.");
    }

    // Tamanho fora da grade quase sempre é digitação errada, e um "18 " com
    // espaço vira uma variação fantasma que nunca casa com a etiqueta.
    const invalid = (input.sizes ?? []).filter((size) => !grade.sizes.includes(size));
    if (invalid.length > 0) {
      throw badRequest(
        "SIZE_OUT_OF_GRADE",
        `Estes tamanhos não existem na grade escolhida: ${invalid.join(", ")}.`,
      );
    }
  }

  if ((input.sizes?.length ?? 0) > 0 && !input.sizeGradeId) {
    throw badRequest(
      "GRADE_REQUIRED",
      "Escolha a grade de tamanhos antes de informar os tamanhos.",
    );
  }

  if (input.salePrice < input.costPrice) {
    throw badRequest(
      "PRICE_BELOW_COST",
      "O preço de venda está abaixo do custo. Corrija ou registre o motivo com o dono.",
    );
  }

  const hasVariations = (input.sizes?.length ?? 0) > 0;

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        companyId,
        sku,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        sizeGradeId: input.sizeGradeId ?? null,
        material: input.material ?? "PRATA_925",
        weightGrams: input.weightGrams ?? null,
        costPrice: input.costPrice,
        salePrice: input.salePrice,
        hasVariations,
      },
    });

    if (hasVariations) {
      await tx.productVariation.createMany({
        // O SKU da variação deriva do SKU do produto: quem lê a etiqueta
        // consegue voltar ao produto sem consultar o sistema.
        data: (input.sizes ?? []).map((size) => ({
          productId: created.id,
          companyId,
          sku: `${sku}-${size}`,
          size,
        })),
      });
    }

    return created;
  });

  await audit(request, {
    action: "PRODUCT_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Product",
    entityId: product.id,
    newData: {
      sku: product.sku,
      name: product.name,
      costPrice: product.costPrice,
      salePrice: product.salePrice,
      sizes: input.sizes ?? [],
    },
  });

  return product;
}

export async function updateProduct(params: {
  productId: string;
  input: {
    name?: string | undefined;
    description?: string | undefined;
    categoryId?: string | undefined;
    material?: string | undefined;
    weightGrams?: number | undefined;
    costPrice?: number | undefined;
    salePrice?: number | undefined;
    isActive?: boolean | undefined;
  };
  request: FastifyRequest;
}) {
  const { productId, input, request } = params;

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }

  const nextCost = input.costPrice ?? Number(product.costPrice);
  const nextSale = input.salePrice ?? Number(product.salePrice);
  if (nextSale < nextCost) {
    throw badRequest(
      "PRICE_BELOW_COST",
      "O preço de venda ficaria abaixo do custo. Corrija antes de salvar.",
    );
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.material !== undefined ? { material: input.material } : {}),
      ...(input.weightGrams !== undefined ? { weightGrams: input.weightGrams } : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
      ...(input.salePrice !== undefined ? { salePrice: input.salePrice } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  // Mudança de preço ganha ação própria na auditoria: é o que se procura
  // quando a margem do mês não fecha.
  const priceChanged =
    !product.costPrice.equals(updated.costPrice) || !product.salePrice.equals(updated.salePrice);

  await audit(request, {
    action: priceChanged ? "PRODUCT_PRICE_CHANGE" : "PRODUCT_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Product",
    entityId: product.id,
    previousData: {
      name: product.name,
      costPrice: product.costPrice,
      salePrice: product.salePrice,
      isActive: product.isActive,
    },
    newData: {
      name: updated.name,
      costPrice: updated.costPrice,
      salePrice: updated.salePrice,
      isActive: updated.isActive,
    },
  });

  return updated;
}

/**
 * Acrescenta tamanhos a um produto que já existe — a loja passou a trabalhar
 * com o anel no 30, por exemplo.
 */
export async function addVariations(params: {
  productId: string;
  sizes: string[];
  request: FastifyRequest;
}) {
  const { productId, sizes, request } = params;

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: request.user.companyId, deletedAt: null },
    include: { sizeGrade: { select: { sizes: true } }, variations: { select: { size: true } } },
  });
  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }
  if (!product.sizeGradeId || !product.sizeGrade) {
    throw badRequest(
      "GRADE_REQUIRED",
      "Este produto não tem grade de tamanhos. Defina a grade antes.",
    );
  }

  const outOfGrade = sizes.filter((size) => !product.sizeGrade!.sizes.includes(size));
  if (outOfGrade.length > 0) {
    throw badRequest(
      "SIZE_OUT_OF_GRADE",
      `Estes tamanhos não existem na grade do produto: ${outOfGrade.join(", ")}.`,
    );
  }

  const existing = new Set(product.variations.map((variation) => variation.size));
  const novos = sizes.filter((size) => !existing.has(size));
  if (novos.length === 0) {
    throw badRequest("SIZES_ALREADY_EXIST", "Todos esses tamanhos já estão cadastrados.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.productVariation.createMany({
      data: novos.map((size) => ({
        productId: product.id,
        companyId: product.companyId,
        sku: `${product.sku}-${size}`,
        size,
      })),
    });

    if (!product.hasVariations) {
      await tx.product.update({ where: { id: product.id }, data: { hasVariations: true } });
    }
  });

  await audit(request, {
    action: "PRODUCT_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Product",
    entityId: product.id,
    newData: { tamanhosAdicionados: novos },
  });

  return getProduct({ productId: product.id, request });
}

/**
 * Desativa o produto em vez de apagar.
 *
 * Apagar quebraria todo movimento de estoque e toda venda que já apontam para
 * ele — o histórico deixaria de conseguir dizer o que foi vendido.
 */
export async function deactivateProduct(params: {
  productId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { productId, reason, request } = params;

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }

  const remaining = await prisma.stockItem.aggregate({
    where: { productId: product.id },
    _sum: { quantity: true },
  });

  if ((remaining._sum.quantity ?? 0) > 0) {
    throw conflict(
      "STOCK_REMAINING",
      `Ainda há ${remaining._sum.quantity} peça(s) em estoque. Dê baixa ou transfira antes de desativar.`,
    );
  }

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { isActive: false },
  });

  await audit(request, {
    action: "PRODUCT_DEACTIVATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Product",
    entityId: product.id,
    previousData: { isActive: true },
    newData: { isActive: false },
    reason,
  });

  return updated;
}
