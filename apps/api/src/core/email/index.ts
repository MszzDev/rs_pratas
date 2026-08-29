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
  return (await enviarRelatando(message)).enviado;
}

/**
 * O mesmo envio, dizendo o que deu errado.
 *
 * Quase todo lugar do sistema só quer saber "saiu ou não" — a venda fecha e o
 * funcionário é cadastrado de qualquer forma, e o erro do provedor não ajuda
 * quem está no balcão.
 *
 * A tela de configuração é a exceção: ali o erro É a resposta. "Não foi
 * possível" manda o dono adivinhar entre credencial errada, remetente não
 * verificado e porta bloqueada; "535 authentication failed" diz o que
 * consertar. O texto continua indo para o log também, porque é lá que ele fica
 * depois que a tela fecha.
 */
export async function enviarRelatando(
  message: EmailMessage,
): Promise<{ enviado: boolean; erro: string | null }> {
  try {
    await resolveProvider().send(message);
    return { enviado: true, erro: null };
  } catch (error) {
    logger.error(
      { err: error, to: message.to, subject: message.subject },
      "Falha ao enviar e-mail.",
    );

    return { enviado: false, erro: motivoLegivel(error) };
  }
}

/**
 * O erro do nodemailer em uma linha.
 *
 * Os códigos importam mais que a mensagem: `ETIMEDOUT` e `ECONNECTION` contam
 * uma história (a conexão não se estabeleceu) e `EAUTH` conta outra (o
 * servidor atendeu e recusou quem você diz ser). Confundir as duas faz o dono
 * mexer na credencial quando o problema é a rede.
 */
function motivoLegivel(error: unknown): string {
  const erro = error as { code?: string; responseCode?: number; message?: string };
  const detalhe = (erro.message ?? "").split("\n")[0]?.trim() ?? "";

  switch (erro.code) {
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNECTION":
      return `Não foi possível falar com o servidor de e-mail (${erro.code}). Confira o endereço e a porta — e se a hospedagem permite sair por essa porta.`;
    case "EAUTH":
      return `O servidor de e-mail recusou o usuário ou a senha${detalhe ? `: ${detalhe}` : "."}`;
    case "EENVELOPE":
      return `O servidor recusou o remetente ou o destinatário${detalhe ? `: ${detalhe}` : "."} Verifique o remetente no provedor.`;
    default:
      return detalhe || "O provedor recusou o envio sem dizer o motivo.";
  }
}

/** Só para os testes: força a releitura da configuração. */
export function resetEmailProvider(): void {
  provider = null;
}
