import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Garantias e certificados de autenticidade.
 *
 * A garantia é do ITEM da venda, não do produto: é daquela peça que aquele
 * cliente levou naquele dia. Ligar ao produto faria toda unidade vendida
 * compartilhar um prazo só, o que não significa nada.
 *
 * Os termos são congelados na emissão, pelo mesmo motivo do preço no item:
 * mudar o texto da garantia depois reescreveria o que foi prometido ao
 * cliente que já levou a peça.
 */

const DEFAULT_TERMS =
  "Garantia contra defeito de fabricação. Não cobre mau uso, batidas, contato " +
  "com produtos químicos, nem escurecimento natural da prata, que é reversível " +
  "com limpeza. Apresente este documento e o comprovante de compra.";

async function nextCode(companyId: string, prefix: string, table: "warranty" | "certificate") {
  const count =
    table === "warranty"
      ? await prisma.warranty.count({ where: { companyId } })
      : await prisma.certificate.count({ where: { companyId } });

  return `${prefix}${String(count + 1).padStart(6, "0")}`;
}

export async function issueWarranty(params: {
  input: { saleItemId: string; months: number; terms?: string | undefined };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const saleItem = await prisma.saleItem.findFirst({
    where: { id: input.saleItemId, sale: { companyId: request.user.companyId } },
    include: { sale: { select: { storeId: true, completedAt: true, status: true } } },
  });
  if (!saleItem) {
    throw notFound("SALE_ITEM_NOT_FOUND", "Item de venda não encontrado.");
  }

  await assertStoreAccess(request, saleItem.sale.storeId);

  if (saleItem.sale.status !== "CONCLUIDA") {
    throw badRequest(
      "SALE_NOT_COMPLETED",
      "A venda precisa estar concluída para emitir garantia.",
    );
  }

  const existing = await prisma.warranty.findUnique({
    where: { saleItemId: saleItem.id },
    select: { code: true },
  });
  if (existing) {
    throw conflict(
      "WARRANTY_EXISTS",
      `Esta peça já tem a garantia ${existing.code}. Uma peça, uma garantia.`,
    );
  }

  // Vale a partir da venda, não da emissão: se a garantia for emitida uma
  // semana depois, o cliente não ganha uma semana a mais.
  const startsAt = saleItem.sale.completedAt ?? new Date();
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + input.months);

  const warranty = await prisma.warranty.create({
    data: {
      companyId: request.user.companyId,
      saleItemId: saleItem.id,
      code: await nextCode(request.user.companyId, "GA", "warranty"),
      months: input.months,
      startsAt,
      expiresAt,
      terms: input.terms ?? DEFAULT_TERMS,
      createdById: request.user.sub,
    },
  });

  await audit(request, {
    action: "WARRANTY_ISSUE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: saleItem.sale.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Warranty",
    entityId: warranty.id,
    newData: { code: warranty.code, months: warranty.months, expiresAt: warranty.expiresAt },
  });

  return warranty;
}

/** Consulta pelo código — o que o balcão faz quando o cliente volta. */
export async function findWarranty(params: { code: string; request: FastifyRequest }) {
  const warranty = await prisma.warranty.findFirst({
    where: { companyId: params.request.user.companyId, code: params.code },
    include: {
      saleItem: {
        include: {
          sale: {
            select: {
              code: true,
              completedAt: true,
              storeId: true,
              customer: { select: { name: true, phone: true } },
            },
          },
        },
      },
      claims: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!warranty) {
    throw notFound("WARRANTY_NOT_FOUND", "Garantia não encontrada.");
  }

  const now = new Date();
  const expired = warranty.expiresAt < now;

  return {
    ...warranty,
    vigente: !expired && !warranty.voidedAt,
    /** Negativo quando já venceu — a tela mostra há quantos dias. */
    diasRestantes: Math.ceil((warranty.expiresAt.getTime() - now.getTime()) / 86_400_000),
  };
}

/**
 * O cliente voltou com defeito.
 *
 * O acionamento é registrado mesmo quando a garantia já venceu: o pedido
 * existiu, e a recusa precisa ficar documentada com o motivo. Não registrar o
 * que foi recusado apaga metade da história.
 */
export async function openClaim(params: {
  input: { warrantyId: string; description: string };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const warranty = await prisma.warranty.findFirst({
    where: { id: input.warrantyId, companyId: request.user.companyId },
    include: { saleItem: { include: { sale: { select: { storeId: true } } } } },
  });
  if (!warranty) {
    throw notFound("WARRANTY_NOT_FOUND", "Garantia não encontrada.");
  }

  const storeId = warranty.saleItem.sale.storeId;
  await assertStoreAccess(request, storeId);

  const claim = await prisma.warrantyClaim.create({
    data: {
      warrantyId: warranty.id,
      companyId: warranty.companyId,
      storeId,
      description: input.description,
      openedById: request.user.sub,
    },
  });

  await audit(request, {
    action: "WARRANTY_CLAIM",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: warranty.companyId,
    storeId,
    userRoleSnapshot: request.user.role,
    entityType: "WarrantyClaim",
    entityId: claim.id,
    newData: {
      garantia: warranty.code,
      vencida: warranty.expiresAt < new Date(),
    },
    reason: input.description,
  });

  return claim;
}

export async function decideClaim(params: {
  claimId: string;
  approved: boolean;
  reason: string;
  request: FastifyRequest;
}) {
  const { claimId, approved, reason, request } = params;

  const claim = await prisma.warrantyClaim.findFirst({
    where: { id: claimId, companyId: request.user.companyId },
  });
  if (!claim) {
    throw notFound("CLAIM_NOT_FOUND", "Acionamento não encontrado.");
  }

  await assertStoreAccess(request, claim.storeId);

  if (claim.approved !== null) {
    throw badRequest("ALREADY_DECIDED", "Este acionamento já foi decidido.");
  }

  const updated = await prisma.warrantyClaim.update({
    where: { id: claim.id },
    data: {
      approved,
      decisionReason: reason,
      decidedById: request.user.sub,
      decidedAt: new Date(),
    },
  });

  await audit(request, {
    action: "WARRANTY_CLAIM",
    result: approved ? "SUCCESS" : "DENIED",
    userId: request.user.sub,
    companyId: claim.companyId,
    storeId: claim.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "WarrantyClaim",
    entityId: claim.id,
    newData: { aprovado: approved },
    reason,
  });

  return updated;
}

// =====================================================================
// CERTIFICADOS DE AUTENTICIDADE
// =====================================================================

export async function issueCertificate(params: {
  input: { saleItemId: string; details?: string | undefined };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const saleItem = await prisma.saleItem.findFirst({
    where: { id: input.saleItemId, sale: { companyId: request.user.companyId } },
    include: {
      product: { select: { material: true, weightGrams: true } },
      variation: { select: { weightGrams: true } },
      sale: { select: { storeId: true, customer: { select: { name: true } } } },
    },
  });
  if (!saleItem) {
    throw notFound("SALE_ITEM_NOT_FOUND", "Item de venda não encontrado.");
  }

  await assertStoreAccess(request, saleItem.sale.storeId);

  const existing = await prisma.certificate.findUnique({
    where: { saleItemId: saleItem.id },
    select: { code: true },
  });
  if (existing) {
    throw conflict(
      "CERTIFICATE_EXISTS",
      `Esta peça já tem o certificado ${existing.code}. Para uma segunda via, use a reemissão.`,
    );
  }

  const certificate = await prisma.certificate.create({
    data: {
      companyId: request.user.companyId,
      saleItemId: saleItem.id,
      code: await nextCode(request.user.companyId, "CE", "certificate"),
      productName: saleItem.productName,
      productSku: saleItem.productSku,
      material: saleItem.product.material,
      weightGrams: saleItem.variation?.weightGrams ?? saleItem.product.weightGrams,
      details: input.details ?? null,
      customerName: saleItem.sale.customer?.name ?? null,
      issuedById: request.user.sub,
    },
  });

  await audit(request, {
    action: "CERTIFICATE_ISSUE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: saleItem.sale.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Certificate",
    entityId: certificate.id,
    newData: { code: certificate.code, material: certificate.material },
  });

  return certificate;
}

/**
 * Segunda via.
 *
 * Incrementa o contador do MESMO certificado em vez de emitir outro. Dois
 * certificados com códigos diferentes para a mesma peça permitiriam apresentar
 * dois documentos como se fossem duas peças.
 */
export async function reissueCertificate(params: {
  certificateId: string;
  request: FastifyRequest;
}) {
  const { certificateId, request } = params;

  const certificate = await prisma.certificate.findFirst({
    where: { id: certificateId, companyId: request.user.companyId },
  });
  if (!certificate) {
    throw notFound("CERTIFICATE_NOT_FOUND", "Certificado não encontrado.");
  }

  const updated = await prisma.certificate.update({
    where: { id: certificate.id },
    data: { reissueCount: certificate.reissueCount + 1 },
  });

  await audit(request, {
    action: "CERTIFICATE_REISSUE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: certificate.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Certificate",
    entityId: certificate.id,
    newData: { code: certificate.code, viaNumero: updated.reissueCount + 1 },
  });

  return { ...updated, viaNumero: updated.reissueCount + 1 };
}

export async function findCertificate(params: { code: string; request: FastifyRequest }) {
  const certificate = await prisma.certificate.findFirst({
    where: { companyId: params.request.user.companyId, code: params.code },
  });

  if (!certificate) {
    throw notFound("CERTIFICATE_NOT_FOUND", "Certificado não encontrado.");
  }

  return certificate;
}
