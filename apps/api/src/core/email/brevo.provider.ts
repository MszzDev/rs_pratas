import { env } from "../../config/env.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";

/**
 * Envio pela API do Brevo, por HTTPS.
 *
 * Existe porque hospedagem bloqueia SMTP. O Render — e a maioria das
 * plataformas do tipo — fecha a saída pelas portas 25, 465 e 587 para conter
 * spam vindo de aplicações comprometidas. O sintoma é o pior possível: a
 * conexão não é recusada, ela simplesmente nunca completa, e o envio fica
 * esperando até estourar o tempo. Foi o `ETIMEDOUT` que apareceu ao ligar o
 * Brevo neste servidor.
 *
 * Porta 443 nenhuma hospedagem bloqueia — é por onde o próprio sistema fala
 * com o banco e com a loja virtual. Trocar o protocolo resolve de vez, em vez
 * de procurar uma porta alternativa que pode fechar amanhã.
 *
 * O SMTP continua existindo e continua sendo o padrão: serve a quem hospeda em
 * servidor próprio e já tem uma caixa de e-mail, sem contratar mais nada.
 */

const ENDERECO = "https://api.brevo.com/v3/smtp/email";

/** Mesma paciência do SMTP: dez segundos e desiste. */
const ESPERA_MS = 10_000;

export class BrevoEmailProvider implements EmailProvider {
  readonly name = "brevo";

  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<void> {
    // `MAIL_FROM` vem no formato "Nome <endereco>", que é o que o SMTP usa. A
    // API quer os dois separados, então desmontamos aqui — e não pedimos ao
    // dono para preencher a mesma coisa de duas formas.
    const { nome, endereco } = separarRemetente(env.MAIL_FROM);

    const resposta = await fetch(ENDERECO, {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: nome, email: endereco },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
      }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });

    if (!resposta.ok) {
      // A mensagem do Brevo vai junto: é ela que diz "remetente não
      // verificado" ou "chave inválida", e é isso que o dono precisa ler na
      // tela de configuração em vez de um número de status.
      const corpo = await resposta.text().catch(() => "");
      const detalhe = extrairMensagem(corpo);

      throw Object.assign(
        new Error(
          detalhe
            ? `O Brevo recusou o envio: ${detalhe}`
            : `O Brevo respondeu ${resposta.status}.`,
        ),
        // O tradutor de erros de envio reconhece este código e não confunde
        // com falha de rede.
        { code: resposta.status === 401 ? "EAUTH" : "EENVELOPE" },
      );
    }
  }
}

/** "RS Pratas <loja@exemplo.com>" vira as duas partes; só o endereço também vale. */
export function separarRemetente(valor: string): { nome: string; endereco: string } {
  const comNome = /^\s*(.*?)\s*<([^>]*)>\s*$/.exec(valor);

  if (comNome) {
    // O que vem dentro do sinal de menor é aparado à parte: `[^>]*` engole os
    // espaços internos, e um endereço com espaço colado é recusado pelo Brevo
    // como se não existisse — mandando o dono conferir chave e domínio quando
    // o problema é a digitação.
    const endereco = (comNome[2] ?? "").trim();
    if (endereco) {
      return { nome: comNome[1]?.trim() || endereco, endereco };
    }
  }

  const endereco = valor.trim();
  return { nome: endereco, endereco };
}

function extrairMensagem(corpo: string): string | null {
  try {
    const json = JSON.parse(corpo) as { message?: string; code?: string };
    return json.message ?? null;
  } catch {
    return corpo.slice(0, 200) || null;
  }
}
