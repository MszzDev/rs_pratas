import type { FastifyBaseLogger } from "fastify";
import type { EmailDeliveryResult, EmailMessage, EmailProvider } from "./email.provider.js";

/**
 * Provedor de desenvolvimento: registra o e-mail no log em vez de enviar.
 *
 * O corpo é logado porque em desenvolvimento é assim que se recupera a senha
 * temporária de um funcionário recém-criado. Por isso mesmo este provedor é
 * recusado em produção (ver createEmailProvider) — lá, credencial em arquivo de
 * log seria um vazamento.
 */
/**
 * Últimos e-mails "enviados", só em ambiente de teste.
 *
 * Existe para que a suíte possa afirmar o que o funcionário realmente recebe —
 * a senha temporária nunca volta pela API, então sem isso não haveria como
 * testar o fluxo completo de criação de usuário até o primeiro acesso.
 */
export const sentEmails: EmailMessage[] = [];

export function clearSentEmails(): void {
  sentEmails.length = 0;
}

export class LogEmailProvider implements EmailProvider {
  readonly name = "log";

  constructor(private readonly logger: FastifyBaseLogger) {}

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    this.logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "e-mail (modo desenvolvimento — não enviado)",
    );

    if (process.env.NODE_ENV === "test") {
      sentEmails.push(message);
    }

    return { delivered: true, providerMessageId: `log-${Date.now()}` };
  }
}
