import type { FastifyBaseLogger } from "fastify";
import { env } from "../../config/env.js";
import type { EmailProvider } from "./email.provider.js";
import { LogEmailProvider } from "./log-email.provider.js";

export * from "./email.provider.js";
export * from "./welcome-email.js";
export { sentEmails, clearSentEmails } from "./log-email.provider.js";

/**
 * Escolhe o provedor conforme o ambiente.
 *
 * Em produção o provedor de log é recusado no boot: ele escreve o corpo do
 * e-mail — incluindo a senha temporária — no arquivo de log. Falhar aqui é
 * melhor que descobrir o vazamento depois.
 */
export function createEmailProvider(logger: FastifyBaseLogger): EmailProvider {
  if (env.EMAIL_PROVIDER === "log") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "EMAIL_PROVIDER=log não pode ser usado em produção: o corpo do e-mail, com a senha temporária, iria para o log.",
      );
    }
    return new LogEmailProvider(logger);
  }

  throw new Error(`Provedor de e-mail não suportado: ${env.EMAIL_PROVIDER}`);
}
