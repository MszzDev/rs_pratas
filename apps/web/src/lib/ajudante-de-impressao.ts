/**
 * O ajudante de impressão: falar com a impressora de dentro do navegador.
 *
 * O navegador não pode abrir conexão numa porta como a 9100 — é proibido por
 * segurança, em todos eles. A única saída seria o diálogo de impressão, que
 * passa pelo driver do Windows, e é ali que a loja perdeu dias: o navegador
 * escolhe o papel, aplica margem, escala o desenho para caber e cria páginas
 * por conta própria; o driver acrescenta a própria ideia de área imprimível.
 * Nenhuma dessas decisões é deles para tomar quando o papel tem 33 mm e vem
 * picotado, e cada página a mais é uma etiqueta desperdiçada.
 *
 * O ajudante é um programa pequeno rodando no mesmo computador. O sistema
 * desenha a etiqueta — que é o que o navegador sabe fazer bem — e passa os
 * bytes prontos para ele entregar na impressora.
 *
 * ## Por que dá para falar com ele mesmo o sistema estando em HTTPS
 *
 * Página segura não pode chamar endereço inseguro, com uma exceção: os
 * navegadores tratam `127.0.0.1` como confiável, porque é a própria máquina de
 * quem está usando. É o que permite esta ponte existir sem certificado.
 *
 * ## Quando ele não está
 *
 * Nada quebra. Sem ajudante, a impressão continua pelo diálogo do navegador,
 * que é como sempre funcionou — só com os problemas que ele traz.
 */

const ENDERECO = "http://127.0.0.1:9110";

/** Tempo curto: se ele não responde num piscar, não está rodando. */
const ESPERA_MS = 1200;

export interface ImpressoraDoAjudante {
  ip: string;
  porta: number;
}

/**
 * O ajudante está rodando? E em qual impressora?
 *
 * Devolve nulo em vez de lançar: não estar rodando é o caso comum — no tablet,
 * no celular, no computador de quem não instalou — e não é erro nenhum.
 */
export async function situacaoDoAjudante(): Promise<ImpressoraDoAjudante | null> {
  try {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ESPERA_MS);

    const resposta = await fetch(`${ENDERECO}/situacao`, { signal: controle.signal });
    clearTimeout(relogio);

    if (!resposta.ok) return null;

    const corpo = (await resposta.json()) as { ok?: boolean; impressora?: ImpressoraDoAjudante };
    return corpo.ok && corpo.impressora ? corpo.impressora : null;
  } catch {
    return null;
  }
}

/** Diz ao ajudante em qual impressora entregar daqui em diante. */
export async function escolherImpressoraNoAjudante(
  impressora: ImpressoraDoAjudante,
): Promise<void> {
  const resposta = await fetch(`${ENDERECO}/impressora`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(impressora),
  });

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { erro?: string };
    throw new Error(corpo.erro ?? "O ajudante não aceitou o endereço.");
  }
}

/**
 * Manda a etiqueta pronta para o ajudante entregar.
 *
 * `conteudo` vem em base64 porque os comandos da impressora têm bytes que não
 * são texto e não atravessam JSON inteiros de outro jeito.
 *
 * Lança quando falha, com a mensagem que o ajudante devolveu — ela já explica o
 * que fazer ("confira se está ligada e na rede"), o que é mais útil que um
 * código de erro para quem está no balcão.
 */
export async function imprimirPeloAjudante(conteudo: string): Promise<void> {
  const resposta = await fetch(`${ENDERECO}/imprimir`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conteudo }),
  });

  const corpo = (await resposta.json().catch(() => ({}))) as { ok?: boolean; erro?: string };

  if (!resposta.ok || !corpo.ok) {
    throw new Error(corpo.erro ?? "O ajudante não conseguiu imprimir.");
  }
}
