/**
 * Erro de negócio com mensagem segura para exibição ao usuário final.
 * Erros que não são AppError nunca têm sua mensagem exposta na resposta —
 * o error handler central devolve texto genérico e loga o detalhe técnico.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    /** Mensagem amigável, exibível ao usuário (pt-BR). */
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);

export const unauthorized = (code: string, message = "Sessão inválida ou expirada.") =>
  new AppError(401, code, message);

export const forbidden = (code: string, message = "Você não tem permissão para esta ação.") =>
  new AppError(403, code, message);

/** Usado também para negar acesso cross-loja/cross-empresa — não vaza existência do recurso. */
export const notFound = (code: string, message = "Registro não encontrado.") =>
  new AppError(404, code, message);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);

export const tooManyRequests = (code: string, message: string) =>
  new AppError(429, code, message);
