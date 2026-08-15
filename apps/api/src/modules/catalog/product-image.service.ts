import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import type { StorageProvider } from "../../core/storage/storage.provider.js";

/**
 * Foto da peça.
 *
 * O arquivo NÃO é servido estaticamente: o download passa por uma rota da API
 * que confere a permissão, como acontece com os documentos do funcionário. A
 * diferença é que aqui o motivo é outro — a foto do catálogo não é secreta,
 * mas uma pasta pública deixaria o servidor entregando arquivo sem passar por
 * autenticação nenhuma, e é assim que uma pasta de upload vira hospedagem de
 * qualquer coisa que subirem nela.
 *
 * Tamanho e tipo são conferidos aqui, não na tela: o navegador é do cliente e
 * o `accept` do input não impede nada.
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Só formatos que todo navegador e todo tablet abrem.
 *
 * SVG fica de fora de propósito: é um documento que pode conter script, e um
 * SVG servido do mesmo domínio executaria no contexto do sistema.
 */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Assinaturas do início do arquivo, para não confiar no que o cliente diz. */
const MAGIC_BYTES: Array<{ mime: string; bytes: number[] }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  // WebP: "RIFF" .... "WEBP" — os quatro primeiros bastam junto do MIME.
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

function detectMime(content: Buffer): string | null {
  for (const candidate of MAGIC_BYTES) {
    const matches = candidate.bytes.every((byte, index) => content[index] === byte);
    if (matches) return candidate.mime;
  }
  return null;
}

export async function setProductImage(params: {
  productId: string;
  file: { content: Buffer; fileName: string; mimeType: string };
  request: FastifyRequest;
  storage: StorageProvider;
}) {
  const { productId, file, request, storage } = params;

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }

  if (file.content.length === 0) {
    throw badRequest("EMPTY_FILE", "O arquivo chegou vazio. Tente enviar de novo.");
  }
  if (file.content.length > MAX_IMAGE_BYTES) {
    throw badRequest(
      "FILE_TOO_LARGE",
      "A foto passa de 5 MB. Tire uma foto menor ou reduza a resolução.",
    );
  }

  // O tipo declarado tem que bater com o conteúdo real: renomear .exe para
  // .jpg engana o `accept` do navegador, não os primeiros bytes do arquivo.
  const detected = detectMime(file.content);
  if (!detected || !ALLOWED_MIME.has(detected) || detected !== file.mimeType) {
    throw badRequest(
      "INVALID_IMAGE",
      "Envie uma foto em JPG, PNG ou WEBP.",
    );
  }

  const stored = await storage.save({
    content: file.content,
    fileName: file.fileName,
    scope: `produtos/${request.user.companyId}`,
  });

  const anterior = product.imageStorageKey;

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      imageStorageKey: stored.storageKey,
      imageMimeType: detected,
      imageChecksum: stored.checksum,
    },
  });

  // A foto antiga sai do disco depois que a nova está gravada no banco: se a
  // ordem fosse a inversa, uma falha no meio deixaria o produto apontando
  // para um arquivo que não existe mais.
  if (anterior) {
    await storage.delete(anterior).catch((error) => {
      request.log.warn({ err: error, storageKey: anterior }, "foto antiga não pôde ser apagada");
    });
  }

  await audit(request, {
    action: "PRODUCT_IMAGE_SET",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Product",
    entityId: product.id,
    newData: { sku: product.sku, tamanhoBytes: file.content.length, tipo: detected },
  });

  return {
    id: updated.id,
    sku: updated.sku,
    imageChecksum: updated.imageChecksum,
    temFoto: true,
  };
}

export async function removeProductImage(params: {
  productId: string;
  request: FastifyRequest;
  storage: StorageProvider;
}) {
  const { productId, request, storage } = params;

  const product = await prisma.product.findFirst({
    where: { id: productId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!product) {
    throw notFound("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  }
  if (!product.imageStorageKey) {
    throw badRequest("NO_IMAGE", "Este produto não tem foto.");
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { imageStorageKey: null, imageMimeType: null, imageChecksum: null },
  });

  await storage.delete(product.imageStorageKey).catch((error) => {
    request.log.warn({ err: error }, "arquivo da foto não pôde ser apagado");
  });

  await audit(request, {
    action: "PRODUCT_IMAGE_REMOVE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Product",
    entityId: product.id,
    previousData: { sku: product.sku },
  });

  return { id: product.id, temFoto: false };
}

/** Lê a foto para a rota servir. Confere a empresa antes de tocar no disco. */
export async function readProductImage(params: {
  productId: string;
  request: FastifyRequest;
  storage: StorageProvider;
}) {
  const product = await prisma.product.findFirst({
    where: {
      id: params.productId,
      companyId: params.request.user.companyId,
      deletedAt: null,
    },
    select: { imageStorageKey: true, imageMimeType: true, imageChecksum: true },
  });

  if (!product?.imageStorageKey) {
    throw notFound("IMAGE_NOT_FOUND", "Este produto não tem foto.");
  }

  return {
    content: await params.storage.read(product.imageStorageKey),
    mimeType: product.imageMimeType ?? "application/octet-stream",
    checksum: product.imageChecksum ?? "",
  };
}
