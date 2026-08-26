import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";
import { LogEmailProvider } from "./log.provider.js";
import { SmtpEmailProvider } from "./smtp.provider.js";

export type { EmailMessage, EmailProvider } from "./email.provider.js";

let provider: EmailProvider | null = null;

/**
 * Está configurado para enviar de verdade?
 *
 * Duas formas de dizer a mesma coisa: a URL inteira, para quem já a tem, ou os
 * quatro campos separados, que é o caminho de quem está copiando do painel do
 * provedor — e onde não há URL para montar errado.
 */
export function emailConfigurado(): boolean {
  if (env.MAIL_TRANSPORT !== "smtp") return false;

  return Boolean(
    env.SMTP_URL || (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD),
  );
}

function resolveProvider(): EmailProvider {
  if (provider) return provider;

  if (!emailConfigurado()) {
    provider = new LogEmailProvider();
    return provider;
  }

  provider = env.SMTP_URL
    ? new SmtpEmailProvider(env.SMTP_URL)
    : new SmtpEmailProvider({
        host: env.SMTP_HOST as string,
        port: env.SMTP_PORT as number,
        user: env.SMTP_USER as string,
        password: env.SMTP_PASSWORD as string,
      });

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
