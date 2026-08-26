import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { EmployeeDocumentType } from "@prisma/client";
import { badRequest } from "../../core/errors.js";
import { DatabaseStorage } from "../../core/storage/database.storage.js";
import { RuleBasedDocumentAnalysis } from "../../core/documents/rule-based.analysis.js";
import {
  downloadDocument,
  listDocuments,
  reviewDocument,
  uploadDocument,
} from "./documents.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

const reviewSchema = z.object({
  approve: z.boolean(),
  comment: z.string().min(3, "Descreva o motivo da decisão.").max(500),
});

export async function documentRoutes(app: FastifyInstance) {
  // No banco. Atestado e documento de funcionário sumiam a cada publicação
  // exatamente como as fotos — e este é o material que a lei manda guardar.
  const storage = new DatabaseStorage();
  const analysis = new RuleBasedDocumentAnalysis();

  /**
   * Envio pelo funcionário. Multipart porque o conteúdo é arquivo; os demais
   * campos vêm como campos de formulário.
   */
  app.post("/documents", { preHandler: app.requireAuth }, async (request, reply) => {
    const file = await request.file();

    if (!file) {
      throw badRequest("FILE_REQUIRED", "Anexe o arquivo do documento.");
    }

    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const readField = (name: string) => fields[name]?.value?.trim() || undefined;

    const input = z
      .object({
        type: z.nativeEnum(EmployeeDocumentType),
        title: z.string().min(3, "Descreva o documento.").max(160),
        description: z.string().max(500).optional(),
        referenceStart: z.string().date().optional(),
        referenceEnd: z.string().date().optional(),
      })
      .parse({
        type: readField("type"),
        title: readField("title"),
        description: readField("description"),
        referenceStart: readField("referenceStart"),
        referenceEnd: readField("referenceEnd"),
      });

    const document = await uploadDocument({
      input: {
        type: input.type,
        title: input.title,
        fileName: file.filename,
        mimeType: file.mimetype,
        content: await file.toBuffer(),
        ...(input.description ? { description: input.description } : {}),
        ...(input.referenceStart ? { referenceStart: new Date(input.referenceStart) } : {}),
        ...(input.referenceEnd ? { referenceEnd: new Date(input.referenceEnd) } : {}),
      },
      request,
      storage,
      analysis,
    });

    return reply.status(201).send(document);
  });

  app.get("/documents/mine", { preHandler: app.requireAuth }, async (request) => {
    return listDocuments({ request, scope: "mine" });
  });

  app.get("/documents/review", { preHandler: app.requireAuth }, async (request) => {
    const query = z
      .object({ status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]).optional() })
      .parse(request.query);

    return listDocuments({ request, scope: "review", ...(query.status ? { status: query.status } : {}) });
  });

  /**
   * O arquivo nunca é servido estaticamente: passa por aqui para a permissão
   * ser verificada e o acesso ficar auditado. Atestado é dado de saúde.
   */
  app.get("/documents/:id/file", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const { document, content } = await downloadDocument({ documentId: id, request, storage });

    return reply
      .header("Content-Type", document.fileMimeType)
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(document.fileName)}"`)
      .header("Cache-Control", "private, no-store")
      .send(content);
  });

  app.post("/documents/:id/review", { preHandler: app.requireAuth }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const input = reviewSchema.parse(request.body);

    return reviewDocument({
      documentId: id,
      approve: input.approve,
      comment: input.comment,
      request,
    });
  });
}
