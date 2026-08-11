import type { EmployeeDocumentType } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import type { StorageProvider } from "../../core/storage/storage.provider.js";
import type { DocumentAnalysisProvider } from "../../core/documents/analysis.provider.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function uploadDocument(params: {
  input: {
    type: EmployeeDocumentType;
    title: string;
    description?: string;
    referenceStart?: Date;
    referenceEnd?: Date;
    fileName: string;
    mimeType: string;
    content: Buffer;
  };
  request: FastifyRequest;
  storage: StorageProvider;
  analysis: DocumentAnalysisProvider;
}) {
  const { input, request, storage, analysis } = params;

  if (input.content.byteLength === 0) {
    throw badRequest("EMPTY_FILE", "O arquivo está vazio.");
  }

  if (input.content.byteLength > MAX_FILE_BYTES) {
    throw badRequest("FILE_TOO_LARGE", "O arquivo passa de 20 MB. Tire uma foto menor ou envie em PDF.");
  }

  const employee = await prisma.user.findFirstOrThrow({
    where: { id: request.user.sub },
    select: {
      id: true,
      name: true,
      employeeCode: true,
      companyId: true,
      userStores: { select: { storeId: true }, take: 1 },
    },
  });

  const stored = await storage.save({
    content: input.content,
    fileName: input.fileName,
    scope: employee.companyId,
  });

  // Mesmo arquivo enviado antes pelo mesmo funcionário. Compara o conteúdo, não
  // o nome — renomear não engana.
  const duplicate = await prisma.employeeDocument.findFirst({
    where: { userId: employee.id, fileChecksum: stored.checksum },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  const context = await buildAnalysisContext({
    userId: employee.id,
    referenceStart: input.referenceStart ?? null,
    referenceEnd: input.referenceEnd ?? null,
  });

  const result = await analysis.analyze({
    type: input.type,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: stored.sizeBytes,
    checksum: stored.checksum,
    referenceStart: input.referenceStart ?? null,
    referenceEnd: input.referenceEnd ?? null,
    employee: { id: employee.id, name: employee.name, employeeCode: employee.employeeCode },
    context: { ...context, duplicateOfDocumentId: duplicate?.id ?? null },
  });

  const document = await prisma.employeeDocument.create({
    data: {
      companyId: employee.companyId,
      storeId: employee.userStores[0]?.storeId ?? null,
      userId: employee.id,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      referenceStart: input.referenceStart ?? null,
      referenceEnd: input.referenceEnd ?? null,
      fileName: input.fileName,
      fileMimeType: input.mimeType,
      fileSizeBytes: stored.sizeBytes,
      fileStorageKey: stored.storageKey,
      fileChecksum: stored.checksum,
      analysisVerdict: result.verdict,
      analysisSummary: result.summary,
      analysisFindings: result.findings,
      analysisExtracted: result.extracted as never,
      analyzedAt: new Date(),
    },
  });

  await audit(request, {
    action: "DATA_EXPORT",
    result: "SUCCESS",
    userId: employee.id,
    companyId: employee.companyId,
    storeId: document.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "EmployeeDocument",
    entityId: document.id,
    reason: "documento enviado pelo funcionário",
    newData: { type: document.type, title: document.title, verdict: result.verdict },
  });

  return document;
}

/**
 * Reúne o que a análise consegue conferir no banco: quantos dias úteis o
 * período abrange e em quantos deles houve falta de fato.
 *
 * É a checagem mais reveladora e não depende de ler o documento — um atestado
 * cobrindo dias em que a pessoa bateu ponto normalmente é o sinal que importa.
 */
async function buildAnalysisContext(params: {
  userId: string;
  referenceStart: Date | null;
  referenceEnd: Date | null;
}) {
  if (!params.referenceStart) {
    return { absencesInPeriod: 0, workingDaysInPeriod: 0 };
  }

  const start = startOfDay(params.referenceStart);
  const end = endOfDay(params.referenceEnd ?? params.referenceStart);

  const entries = await prisma.timeClockEntry.findMany({
    where: { userId: params.userId, timestamp: { gte: start, lte: end } },
    select: { timestamp: true },
  });

  const daysWithPresence = new Set(
    entries.map((entry) => entry.timestamp.toISOString().slice(0, 10)),
  );

  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  );

  return {
    workingDaysInPeriod: totalDays,
    absencesInPeriod: totalDays - daysWithPresence.size,
  };
}

const startOfDay = (date: Date) => new Date(new Date(date).setHours(0, 0, 0, 0));
const endOfDay = (date: Date) => new Date(new Date(date).setHours(23, 59, 59, 999));

export async function listDocuments(params: {
  request: FastifyRequest;
  scope: "mine" | "review";
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
}) {
  const { request, scope, status } = params;

  if (scope === "mine") {
    return prisma.employeeDocument.findMany({
      where: { userId: request.user.sub, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, employeeCode: true } } },
    });
  }

  const canReview = ["DONO", "GERENTE", "DESENVOLVEDOR"].includes(request.user.role);
  if (!canReview) {
    throw forbidden("FORBIDDEN_ROLE", "Você não tem permissão para conferir documentos.");
  }

  // O gerente confere quem é da loja dele; o dono e o desenvolvedor veem tudo
  // da empresa — mesma regra do espelho de ponto.
  const restrictToStores = request.user.role === "GERENTE";

  return prisma.employeeDocument.findMany({
    where: {
      companyId: request.user.companyId,
      ...(status ? { status } : {}),
      ...(restrictToStores
        ? { user: { userStores: { some: { storeId: { in: request.user.storeIds } } } } }
        : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { user: { select: { name: true, employeeCode: true } } },
  });
}

async function loadReviewableDocument(documentId: string, request: FastifyRequest) {
  const document = await prisma.employeeDocument.findFirst({
    where: { id: documentId, companyId: request.user.companyId },
    include: { user: { select: { id: true, name: true, userStores: { select: { storeId: true } } } } },
  });

  if (!document) {
    throw notFound("DOCUMENT_NOT_FOUND", "Documento não encontrado.");
  }

  const isOwnDocument = document.userId === request.user.sub;
  const canReview = ["DONO", "GERENTE", "DESENVOLVEDOR"].includes(request.user.role);

  if (request.user.role === "GERENTE") {
    const sharesStore = document.user.userStores.some((link) =>
      request.user.storeIds.includes(link.storeId),
    );
    if (!sharesStore) {
      throw notFound("DOCUMENT_NOT_FOUND", "Documento não encontrado.");
    }
  }

  return { document, isOwnDocument, canReview };
}

export async function downloadDocument(params: {
  documentId: string;
  request: FastifyRequest;
  storage: StorageProvider;
}) {
  const { documentId, request, storage } = params;
  const { document, isOwnDocument, canReview } = await loadReviewableDocument(documentId, request);

  // Atestado é dado de saúde: só o próprio funcionário e quem confere alcançam.
  if (!isOwnDocument && !canReview) {
    throw forbidden("FORBIDDEN_ROLE", "Você não tem permissão para ver este documento.");
  }

  const content = await storage.read(document.fileStorageKey);

  await audit(request, {
    action: "DATA_EXPORT",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: document.companyId,
    storeId: document.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "EmployeeDocument",
    entityId: document.id,
    reason: "download de documento",
  });

  return { document, content };
}

export async function reviewDocument(params: {
  documentId: string;
  approve: boolean;
  comment: string;
  request: FastifyRequest;
}) {
  const { documentId, approve, comment, request } = params;
  const { document, canReview } = await loadReviewableDocument(documentId, request);

  if (!canReview) {
    throw forbidden("FORBIDDEN_ROLE", "Você não tem permissão para conferir documentos.");
  }

  if (document.userId === request.user.sub) {
    throw badRequest(
      "CANNOT_REVIEW_OWN_DOCUMENT",
      "Você não pode conferir o próprio documento.",
    );
  }

  if (document.status !== "PENDING_REVIEW") {
    throw badRequest("ALREADY_REVIEWED", "Este documento já foi conferido.");
  }

  const updated = await prisma.employeeDocument.update({
    where: { id: document.id },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedAt: new Date(),
      reviewedById: request.user.sub,
      reviewComment: comment,
    },
  });

  await audit(request, {
    action: approve ? "USER_UPDATE" : "USER_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: document.companyId,
    storeId: document.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "EmployeeDocument",
    entityId: document.id,
    previousData: { status: document.status },
    newData: { status: updated.status, decidedBy: request.user.sub },
    reason: comment,
    // Deixa explícito no histórico que a decisão foi humana, e qual era a
    // sugestão automática no momento — se um dia a análise errar, dá para
    // auditar se ela influenciou a decisão.
    metadata: { analysisVerdict: document.analysisVerdict, decision: "human" },
  });

  return updated;
}
