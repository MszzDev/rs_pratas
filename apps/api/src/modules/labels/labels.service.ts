import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Etiquetas e fila de impressão.
 *
 * O servidor NÃO imprime. Quem imprime é o tablet, que está na mesma rede da
 * impressora térmica do balcão — o servidor não alcança aquela rede, e mesmo
 * que alcançasse, mandar o trabalho por fora do aparelho que o operador está
 * olhando esconderia a falha dele.
 *
 * O que existe aqui é a fila: o trabalho é criado, o tablet busca, imprime, e
 * relata o resultado. Isso importa porque impressora de balcão falha o tempo
 * todo (acaba papel, cai a rede, trava), e sem registro o funcionário não sabe
 * se a etiqueta saiu — reimprime, e a peça acaba com duas etiquetas de preços
 * diferentes.
 */

/** Códigos de barras. EAN-13 exige 13 dígitos; usamos Code128 por SKU livre. */
function barcodeFor(sku: string): string {
  // Code128 aceita alfanumérico, que é o formato dos nossos SKUs (AN-100-16).
  // EAN-13 exigiria um prefixo GS1 comprado, que a loja não tem.
  return sku;
}

export async function listTemplates(request: FastifyRequest) {
  return prisma.labelTemplate.findMany({
    where: { companyId: request.user.companyId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function createTemplate(params: {
  input: {
    code: string;
    name: string;
    widthMm: number;
    heightMm: number;
    isDoubleSided?: boolean | undefined;
    showProductName?: boolean | undefined;
    showSku?: boolean | undefined;
    showPrice?: boolean | undefined;
    showWeight?: boolean | undefined;
    showSize?: boolean | undefined;
    showBarcode?: boolean | undefined;
    isDefault?: boolean | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const taken = await prisma.labelTemplate.findFirst({
    where: { companyId: request.user.companyId, code: input.code, deletedAt: null },
    select: { id: true },
  });
  if (taken) {
    throw conflict("TEMPLATE_CODE_TAKEN", "Já existe um modelo com este código.");
  }

  const template = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.labelTemplate.updateMany({
        where: { companyId: request.user.companyId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.labelTemplate.create({
      data: {
        companyId: request.user.companyId,
        code: input.code,
        name: input.name,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        isDoubleSided: input.isDoubleSided ?? true,
        showProductName: input.showProductName ?? true,
        showSku: input.showSku ?? true,
        showPrice: input.showPrice ?? true,
        showWeight: input.showWeight ?? false,
        showSize: input.showSize ?? true,
        showBarcode: input.showBarcode ?? true,
        isDefault: input.isDefault ?? false,
        createdById: request.user.sub,
      },
    });
  });

  await audit(request, {
    action: "LABEL_TEMPLATE_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "LabelTemplate",
    entityId: template.id,
    newData: { code: template.code, name: template.name },
  });

  return template;
}

/**
 * Calibração: desloca a impressão em milímetros.
 *
 * Existe porque rolo de etiqueta desalinha com o uso e cada impressora tem
 * folga própria. Sem esse ajuste, o caminho do funcionário quando a etiqueta
 * sai cortada é trocar a impressora.
 */
export async function calibrateTemplate(params: {
  templateId: string;
  input: { offsetXMm: number; offsetYMm: number; fontScale?: number | undefined };
  request: FastifyRequest;
}) {
  const { templateId, input, request } = params;

  const template = await prisma.labelTemplate.findFirst({
    where: { id: templateId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!template) {
    throw notFound("TEMPLATE_NOT_FOUND", "Modelo de etiqueta não encontrado.");
  }

  // Deslocamento maior que a própria etiqueta joga a impressão para fora dela.
  const maxX = Number(template.widthMm);
  const maxY = Number(template.heightMm);
  if (Math.abs(input.offsetXMm) > maxX || Math.abs(input.offsetYMm) > maxY) {
    throw badRequest(
      "OFFSET_TOO_LARGE",
      `O ajuste não pode passar do tamanho da etiqueta (${maxX} × ${maxY} mm).`,
    );
  }

  const updated = await prisma.labelTemplate.update({
    where: { id: template.id },
    data: {
      offsetXMm: input.offsetXMm,
      offsetYMm: input.offsetYMm,
      ...(input.fontScale !== undefined ? { fontScale: input.fontScale } : {}),
    },
  });

  await audit(request, {
    action: "LABEL_TEMPLATE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "LabelTemplate",
    entityId: template.id,
    previousData: { offsetXMm: template.offsetXMm, offsetYMm: template.offsetYMm },
    newData: { offsetXMm: updated.offsetXMm, offsetYMm: updated.offsetYMm },
    reason: "calibração da impressora",
  });

  return updated;
}

/**
 * Enfileira etiquetas de um produto.
 *
 * O conteúdo é resolvido AGORA e congelado no trabalho: se o preço mudar entre
 * o pedido e a impressão, a etiqueta ainda sai com o preço que o funcionário
 * viu na tela. Etiqueta com preço diferente do que foi combinado é briga no
 * balcão.
 */
export async function queueProductLabels(params: {
  input: {
    storeId: string;
    productId: string;
    variationId?: string | undefined;
    copies: number;
    templateId?: string | undefined;
    deviceId?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  const product = await prisma.product.findFirst({
    where: { id: input.productId, companyId: request.user.companyId, deletedAt: null },
    include: {
      variations: input.variationId ? { where: { id: input.variationId } } : false,
    },
  });
  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }

  const variation = input.variationId ? product.variations?.[0] : undefined;
  if (input.variationId && !variation) {
    throw notFound("VARIATION_NOT_FOUND", "Tamanho não encontrado para este produto.");
  }
  if (product.hasVariations && !variation) {
    throw badRequest(
      "VARIATION_REQUIRED",
      "Este produto tem tamanhos. Escolha qual deles vai na etiqueta.",
    );
  }

  const template = input.templateId
    ? await prisma.labelTemplate.findFirst({
        where: { id: input.templateId, companyId: request.user.companyId, deletedAt: null },
      })
    : await prisma.labelTemplate.findFirst({
        where: { companyId: request.user.companyId, isDefault: true, deletedAt: null },
      });

  if (!template) {
    throw badRequest(
      "NO_TEMPLATE",
      "Nenhum modelo de etiqueta configurado. Cadastre um antes de imprimir.",
    );
  }

  const sku = variation?.sku ?? product.sku;
  const price = variation?.salePriceOverride ?? product.salePrice;

  const job = await prisma.printJob.create({
    data: {
      companyId: request.user.companyId,
      storeId: input.storeId,
      deviceId: input.deviceId ?? null,
      type: "ETIQUETA",
      templateId: template.id,
      copies: input.copies,
      referenceType: "Product",
      referenceId: product.id,
      requestedById: request.user.sub,
      payload: buildLabelPayload({
        template,
        productName: product.name,
        sku,
        price,
        size: variation?.size ?? null,
        weightGrams: variation?.weightGrams ?? product.weightGrams,
      }),
    },
  });

  await audit(request, {
    action: "PRINT_JOB_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PrintJob",
    entityId: job.id,
    newData: { sku, copies: input.copies, template: template.code },
  });

  return job;
}

/** Monta o que vai impresso, obedecendo o que o modelo manda mostrar. */
function buildLabelPayload(params: {
  template: {
    showProductName: boolean;
    showSku: boolean;
    showPrice: boolean;
    showWeight: boolean;
    showSize: boolean;
    showBarcode: boolean;
    isDoubleSided: boolean;
    widthMm: Prisma.Decimal;
    heightMm: Prisma.Decimal;
    offsetXMm: Prisma.Decimal;
    offsetYMm: Prisma.Decimal;
    fontScale: Prisma.Decimal;
  };
  productName: string;
  sku: string;
  price: Prisma.Decimal;
  size: string | null;
  weightGrams: Prisma.Decimal | null;
}) {
  const { template } = params;

  return {
    // Nome longo não cabe numa etiqueta de joia; cortar aqui é melhor que
    // deixar a impressora decidir onde quebrar.
    productName: template.showProductName ? params.productName.slice(0, 28) : null,
    sku: template.showSku ? params.sku : null,
    price: template.showPrice ? params.price.toFixed(2) : null,
    size: template.showSize ? params.size : null,
    weightGrams: template.showWeight ? (params.weightGrams?.toFixed(3) ?? null) : null,
    barcode: template.showBarcode ? barcodeFor(params.sku) : null,
    layout: {
      widthMm: Number(template.widthMm),
      heightMm: Number(template.heightMm),
      offsetXMm: Number(template.offsetXMm),
      offsetYMm: Number(template.offsetYMm),
      fontScale: Number(template.fontScale),
      isDoubleSided: template.isDoubleSided,
    },
  };
}

/**
 * Lote: várias peças de uma vez, cada uma com sua quantidade.
 *
 * É o caso de quando a mercadoria chega — vinte anéis, dez correntes, tudo
 * precisa de etiqueta antes de ir para a vitrine. Pedir peça por peça faria o
 * funcionário abrir a mesma tela vinte vezes e errar a conta no meio.
 *
 * Cada peça vira um trabalho próprio na fila, e não um trabalho gigante: se a
 * impressora falhar no décimo item, os nove primeiros continuam impressos e só
 * o que faltou é retentado.
 */
export async function queueLabelBatch(params: {
  input: {
    storeId: string;
    templateId?: string | undefined;
    deviceId?: string | undefined;
    items: Array<{
      productId: string;
      variationId?: string | undefined;
      copies: number;
    }>;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  if (input.items.length === 0) {
    throw badRequest("EMPTY_BATCH", "Escolha ao menos uma peça para etiquetar.");
  }

  const total = input.items.reduce((sum, item) => sum + item.copies, 0);
  if (total > 500) {
    throw badRequest(
      "BATCH_TOO_LARGE",
      `São ${total} etiquetas de uma vez. Divida em lotes menores — um rolo não aguenta tudo isso.`,
    );
  }

  const jobs = [];
  const problemas: Array<{ productId: string; motivo: string }> = [];

  for (const item of input.items) {
    try {
      const job = await queueProductLabels({
        input: {
          storeId: input.storeId,
          productId: item.productId,
          ...(item.variationId ? { variationId: item.variationId } : {}),
          copies: item.copies,
          ...(input.templateId ? { templateId: input.templateId } : {}),
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        },
        request,
      });
      jobs.push(job);
    } catch (error) {
      // Uma peça com problema não derruba o lote inteiro: o funcionário
      // recebe o que deu certo e a lista do que não deu, em vez de ter que
      // adivinhar qual das vinte travou.
      problemas.push({
        productId: item.productId,
        motivo: error instanceof Error ? error.message : "erro desconhecido",
      });
    }
  }

  return {
    enfileirados: jobs.length,
    etiquetas: jobs.reduce((sum, job) => sum + job.copies, 0),
    problemas,
    jobs,
  };
}

/**
 * Monta o lote a partir do estoque da loja: uma etiqueta por peça existente.
 *
 * Atalho para o inventário de vitrine — quando a loja decide reetiquetar tudo
 * depois de uma mudança de preço, contar item a item na mão é o caminho para
 * esquecer metade.
 */
export async function buildBatchFromStock(params: {
  request: FastifyRequest;
  storeId: string;
  categoryId?: string | undefined;
  onlyWithStock?: boolean | undefined;
}) {
  const { request, storeId, categoryId, onlyWithStock } = params;
  await assertStoreAccess(request, storeId);

  const items = await prisma.stockItem.findMany({
    where: {
      storeId,
      companyId: request.user.companyId,
      ...(onlyWithStock === false ? {} : { quantity: { gt: 0 } }),
      ...(categoryId ? { product: { categoryId } } : {}),
      product: { deletedAt: null, isActive: true, ...(categoryId ? { categoryId } : {}) },
    },
    include: {
      product: { select: { name: true, sku: true, salePrice: true, imageChecksum: true } },
      variation: { select: { sku: true, size: true } },
    },
    orderBy: { product: { name: "asc" } },
    take: 300,
  });

  return items.map((item) => ({
    productId: item.productId,
    variationId: item.variationId,
    sku: item.variation?.sku ?? item.product.sku,
    name: item.product.name,
    size: item.variation?.size ?? null,
    /** Sugere uma etiqueta por peça em estoque — o funcionário ajusta. */
    copies: item.quantity,
    salePrice: item.product.salePrice,
    imageChecksum: item.product.imageChecksum,
  }));
}

/** Enfileira o comprovante de uma venda. */
export async function queueReceipt(params: {
  saleId: string;
  deviceId?: string | undefined;
  request: FastifyRequest;
}) {
  const { saleId, deviceId, request } = params;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: request.user.companyId },
    include: {
      items: true,
      payments: true,
      customer: { select: { name: true } },
      seller: { select: { name: true } },
      store: { select: { name: true, phone: true } },
    },
  });
  if (!sale) {
    throw notFound("SALE_NOT_FOUND", "Venda não encontrada.");
  }

  await assertStoreAccess(request, sale.storeId);

  const job = await prisma.printJob.create({
    data: {
      companyId: sale.companyId,
      storeId: sale.storeId,
      deviceId: deviceId ?? sale.deviceId,
      type: "COMPROVANTE",
      copies: 1,
      referenceType: "Sale",
      referenceId: sale.id,
      requestedById: request.user.sub,
      payload: {
        code: sale.code,
        storeName: sale.store.name,
        storePhone: sale.store.phone,
        sellerName: sale.seller.name,
        customerName: sale.customer?.name ?? null,
        completedAt: sale.completedAt,
        items: sale.items.map((item) => ({
          name: item.productName,
          sku: item.productSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toFixed(2),
          totalAmount: item.totalAmount.toFixed(2),
        })),
        subtotalAmount: sale.subtotalAmount.toFixed(2),
        discountAmount: sale.discountAmount.toFixed(2),
        totalAmount: sale.totalAmount.toFixed(2),
        payments: sale.payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount.toFixed(2),
          installments: payment.installments,
        })),
      },
    },
  });

  return job;
}

/**
 * A fila que o tablet consulta.
 *
 * Devolve o que está esperando naquela loja — e, quando o trabalho foi
 * endereçado a um tablet específico, só para ele.
 */
export async function listQueue(params: {
  request: FastifyRequest;
  storeId: string;
  deviceId?: string | undefined;
}) {
  const { request, storeId, deviceId } = params;
  await assertStoreAccess(request, storeId);

  return prisma.printJob.findMany({
    where: {
      companyId: request.user.companyId,
      storeId,
      status: { in: ["NA_FILA", "FALHOU"] },
      // Trabalho endereçado a outro tablet não aparece aqui; sem endereço,
      // qualquer tablet da loja pode pegar.
      ...(deviceId ? { OR: [{ deviceId }, { deviceId: null }] } : {}),
    },
    include: { template: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}

/**
 * O tablet relata o que aconteceu.
 *
 * Falha não some da fila: fica com status FALHOU e o erro, para o funcionário
 * ver que a etiqueta não saiu em vez de descobrir olhando a peça.
 */
export async function reportPrintResult(params: {
  jobId: string;
  success: boolean;
  error?: string | undefined;
  request: FastifyRequest;
}) {
  const { jobId, success, error, request } = params;

  const job = await prisma.printJob.findFirst({
    where: { id: jobId, companyId: request.user.companyId },
  });
  if (!job) {
    throw notFound("PRINT_JOB_NOT_FOUND", "Trabalho de impressão não encontrado.");
  }

  await assertStoreAccess(request, job.storeId);

  return prisma.printJob.update({
    where: { id: job.id },
    data: {
      status: success ? "CONCLUIDO" : "FALHOU",
      attempts: job.attempts + 1,
      completedAt: success ? new Date() : null,
      lastError: success ? null : (error ?? "erro não informado pela impressora"),
    },
  });
}

export async function cancelPrintJob(params: { jobId: string; request: FastifyRequest }) {
  const { jobId, request } = params;

  const job = await prisma.printJob.findFirst({
    where: { id: jobId, companyId: request.user.companyId },
  });
  if (!job) {
    throw notFound("PRINT_JOB_NOT_FOUND", "Trabalho de impressão não encontrado.");
  }

  await assertStoreAccess(request, job.storeId);

  if (job.status === "CONCLUIDO") {
    throw badRequest("ALREADY_PRINTED", "Esta etiqueta já foi impressa.");
  }

  return prisma.printJob.update({
    where: { id: job.id },
    data: { status: "CANCELADO" },
  });
}
