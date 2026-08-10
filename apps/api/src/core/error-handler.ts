import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors.js";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      request.log.info({ code: error.code, statusCode: error.statusCode }, "erro de negócio");
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos. Confira os campos e tente novamente.",
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        },
      });
    }

    const statusCode = (error as FastifyError).statusCode ?? 500;

    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: { code: (error as FastifyError).code ?? "BAD_REQUEST", message: error.message },
      });
    }

    // 5xx: o detalhe técnico só vai para o log, nunca para a resposta.
    request.log.error({ err: error }, "erro inesperado");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Não foi possível concluir a operação. Tente novamente em instantes.",
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Registro não encontrado." },
    });
  });
}
