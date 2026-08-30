import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { LabelElement } from "@rs-pratas/shared";
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

/**
 * Guarda o desenho que o dono montou.
 *
 * Substitui a lista inteira, e não mescla: o editor manda o que está na tela,
 * e mesclar faria um elemento apagado voltar sozinho na próxima gravação.
 *
 * Só o tamanho do papel e a calibração ficam fora daqui — são do rolo e da
 * impressora, não do desenho.
 */
export async function saveTemplateElements(params: {
  templateId: string;
  elements: LabelElement[];
  request: FastifyRequest;
}) {
  const { templateId, elements, request } = params;

  const template = await prisma.labelTemplate.findFirst({
    where: { id: templateId, companyId: request.user.companyId, deletedAt: null },
  });

  if (!template) {
    throw notFound("TEMPLATE_NOT_FOUND", "Modelo de etiqueta não encontrado.");
  }

  const salvo = await prisma.labelTemplate.update({
    where: { id: template.id },
    data: { elements: elements as unknown as Prisma.InputJsonValue },
  });

  await audit(request, {
    action: "SETTING_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "LabelTemplate",
    entityId: template.id,
    reason: `desenho da etiqueta "${template.name}" alterado`,
    newData: { elementos: elements.length },
  });

  return salvo;
}

/**
 * Marca um modelo como o padrão da empresa.
 *
 * Faltava, e o buraco era destes que só aparecem no balcão: "usar como padrão"
 * existia SÓ na hora de criar o modelo. Quem cadastrasse dois sem marcar
 * nenhum ficava sem padrão para sempre — e a impressão por peça, que usa o
 * padrão quando não se indica outro, passava a recusar antes mesmo de criar o
 * trabalho. A fila ficava vazia, o que parece "não está indo" e é, na verdade,
 * "foi recusado".
 *
 * Só um por empresa: marcar este desmarca o anterior, na mesma transação.
 * Dois padrões fariam a mesma peça sair com etiqueta diferente conforme a
 * ordem do banco naquele instante.
 */
export async function setDefaultTemplate(params: {
  templateId: string;
  request: FastifyRequest;
}) {
  const { templateId, request } = params;

  const template = await prisma.labelTemplate.findFirst({
    where: { id: templateId, companyId: request.user.companyId, deletedAt: null },
  });

  if (!template) {
    throw notFound("TEMPLATE_NOT_FOUND", "Modelo de etiqueta não encontrado.");
  }

  const atualizado = await prisma.$transaction(async (tx) => {
    await tx.labelTemplate.updateMany({
      where: { companyId: request.user.companyId, isDefault: true },
      data: { isDefault: false },
    });

    return tx.labelTemplate.update({
      where: { id: template.id },
      data: { isDefault: true },
    });
  });

  await audit(request, {
    action: "LABEL_TEMPLATE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "LabelTemplate",
    entityId: template.id,
    reason: "modelo definido como padrão da empresa",
    newData: { code: template.code },
  });

  return atualizado;
}

export async function createTemplate(params: {
  input: {
    code: string;
    name: string;
    widthMm: number;
    heightMm: number;
    gapXMm?: number | undefined;
    gapYMm?: number | undefined;
    columnsPerRow?: number | undefined;
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
        gapXMm: input.gapXMm ?? 0,
        gapYMm: input.gapYMm ?? 0,
        columnsPerRow: input.columnsPerRow ?? 1,
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
    gapXMm: Prisma.Decimal;
    gapYMm: Prisma.Decimal;
    columnsPerRow: number;
    /** O desenho montado no editor, ou nulo para o formato empilhado. */
    elements: Prisma.JsonValue | null;
  };
  productName: string;
  sku: string;
  price: Prisma.Decimal;
  size: string | null;
  weightGrams: Prisma.Decimal | null;
}) {
  const { template } = params;
  const elementos = (template.elements as LabelElement[] | null) ?? null;

  /**
   * Quando há desenho, é o DESENHO que decide o que aparece.
   *
   * Os interruptores ("mostrar preço", "mostrar código") são o mecanismo
   * antigo, e a pergunta que eles respondem — quais campos entram na etiqueta
   * — passa a ser respondida pela presença do elemento no desenho. Manter os
   * dois é ter duas fontes de verdade, e a invisível ganhava:
   *
   * O dono posicionava o preço no editor, via ele na prévia, salvava, e a
   * etiqueta saía sem preço — porque o interruptor estava desligado num
   * formulário que ele nem abriu. Sem erro em lugar nenhum, e o rolo já
   * impresso.
   *
   * Um elemento que não foi colocado simplesmente não é desenhado; não é
   * preciso apagar o dado para escondê-lo.
   */
  const mandaODesenho = Array.isArray(elementos) && elementos.length > 0;
  const mostrar = (ligado: boolean) => mandaODesenho || ligado;

  return {
    // Nome longo não cabe numa etiqueta de joia; cortar aqui é melhor que
    // deixar a impressora decidir onde quebrar.
    productName: mostrar(template.showProductName) ? params.productName.slice(0, 28) : null,
    sku: mostrar(template.showSku) ? params.sku : null,
    price: mostrar(template.showPrice) ? params.price.toFixed(2) : null,
    size: mostrar(template.showSize) ? params.size : null,
    weightGrams: mostrar(template.showWeight) ? (params.weightGrams?.toFixed(3) ?? null) : null,
    barcode: mostrar(template.showBarcode) ? barcodeFor(params.sku) : null,
    layout: {
      widthMm: Number(template.widthMm),
      heightMm: Number(template.heightMm),
      /**
       * A folga entre etiquetas vai junto do trabalho pelo mesmo motivo do
       * desenho: é o rolo que estava valendo quando a etiqueta foi pedida.
       */
      gapXMm: Number(template.gapXMm),
      gapYMm: Number(template.gapYMm),
      columnsPerRow: template.columnsPerRow,
      isDoubleSided: template.isDoubleSided,
      /**
       * O desenho que o dono montou, quando existe.
       *
       * Vai junto do trabalho, e não é buscado na hora de imprimir: o
       * trabalho na fila precisa sair como era quando foi criado. Se alguém
       * mexer no desenho enquanto a fila anda, as etiquetas já enfileiradas
       * não podem mudar de forma no meio do caminho.
       */
      elements: elementos,
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
      product: { select: { name: true, sku: true, salePrice: true, imageChecksum: true, imageExternalUrl: true } },
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
    imageExternalUrl: item.product.imageExternalUrl,
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
