import { createTransport, type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";

/**
 * Envio real por SMTP.
 *
 * SMTP em vez de uma API de terceiro porque o dono já tem uma caixa de e-mail
 * da loja e não precisa contratar mais nada — basta a senha de aplicativo do
 * provedor dele.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor(url: string) {
    this.transporter = createTransport(url);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
