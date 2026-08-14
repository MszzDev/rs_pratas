import { logger } from "../logger.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";

/**
 * Provedor de desenvolvimento: registra que houve um envio, sem enviar nada.
 *
 * O corpo NÃO é registrado. A senha temporária passa por aqui, e um arquivo de
 * log é exatamente o tipo de lugar onde ela ficaria guardada por meses,
 * legível para qualquer um com acesso ao servidor.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = "log";

  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject },
      "E-mail não enviado (transporte de desenvolvimento).",
    );
  }
}
