import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";
import { LogEmailProvider } from "./log.provider.js";
import { SmtpEmailProvider } from "./smtp.provider.js";

export type { EmailMessage, EmailProvider } from "./email.provider.js";

let provider: EmailProvider | null = null;

function resolveProvider(): EmailProvider {
  if (provider) return provider;

  provider =
    env.MAIL_TRANSPORT === "smtp" && env.SMTP_URL
      ? new SmtpEmailProvider(env.SMTP_URL)
      : new LogEmailProvider();

  return provider;
}

/**
 * Envia e devolve se conseguiu — nunca lança.
 *
 * Quem chama está sempre no meio de uma operação que já deu certo: o
 * funcionário já foi cadastrado, a senha temporária já existe. Deixar uma falha
 * de SMTP derrubar a resposta faria o dono achar que o cadastro não aconteceu e
 * tentar de novo, criando matrícula duplicada. Por isso a tela sempre mostra a
 * credencial na hora: o e-mail é conveniência, o papel é a garantia.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    await resolveProvider().send(message);
    return true;
  } catch (error) {
    logger.error(
      { err: error, to: message.to, subject: message.subject },
      "Falha ao enviar e-mail.",
    );
    return false;
  }
}

/** Só para os testes: força a releitura da configuração. */
export function resetEmailProvider(): void {
  provider = null;
}
