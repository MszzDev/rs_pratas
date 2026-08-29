import { createTransport, type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";

/**
 * Quanto tempo esperar antes de desistir.
 *
 * O padrão do nodemailer é de minutos, pensado para fila de servidor. Aqui o
 * envio acontece no meio de uma requisição que alguém está olhando: cadastrar
 * um funcionário, testar a configuração. Uma porta bloqueada ou um servidor
 * que não responde deixaria a tela girando por dois minutos e terminaria com
 * um erro genérico — que foi exatamente o que aconteceu ao ligar o Brevo.
 *
 * Dez segundos é generoso para um SMTP que funciona e curto para um que não
 * vai funcionar. Desistir rápido é o que transforma a espera em resposta.
 */
const LIMITES_DE_ESPERA = {
  /** Abrir a conexão TCP. Estoura quando a porta está bloqueada. */
  connectionTimeout: 10_000,
  /** Esperar o "220" de boas-vindas. Estoura com servidor que aceita e cala. */
  greetingTimeout: 10_000,
  /** Silêncio no meio da conversa, já autenticado. */
  socketTimeout: 20_000,
} as const;

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
        ? createTransport({ url: conexao, ...LIMITES_DE_ESPERA })
        : createTransport({
            host: conexao.host,
            port: conexao.port,
            // 465 fala TLS desde o primeiro byte; 587 começa em claro e sobe
            // para TLS com STARTTLS. Escolher pela porta evita a configuração
            // errada mais comum — "secure: true" na 587, que trava sem dizer
            // por quê.
            secure: conexao.port === 465,
            auth: { user: conexao.user, pass: conexao.password },
            ...LIMITES_DE_ESPERA,
          });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      // Os dois no mesmo envio: o programa de quem recebe escolhe qual mostrar.
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }
}

export interface SmtpEmPedacos {
  host: string;
  port: number;
  user: string;
  password: string;
}
