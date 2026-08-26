import { createTransport, type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";

/**
 * Envio real por SMTP.
 *
 * SMTP em vez de uma API de terceiro porque a loja já tem uma caixa de e-mail
 * e não precisa contratar mais nada — basta a senha dela (ou uma senha de
 * aplicativo, no caso do Gmail).
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor(conexao: string | SmtpEmPedacos) {
    this.transporter =
      typeof conexao === "string"
        ? createTransport(conexao)
        : createTransport({
            host: conexao.host,
            port: conexao.port,
            // 465 fala TLS desde o primeiro byte; 587 começa em claro e sobe
            // para TLS com STARTTLS. Escolher pela porta evita a configuração
            // errada mais comum — "secure: true" na 587, que trava sem dizer
            // por quê.
            secure: conexao.port === 465,
            auth: { user: conexao.user, pass: conexao.password },
          });
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

export interface SmtpEmPedacos {
  host: string;
  port: number;
  user: string;
  password: string;
}
