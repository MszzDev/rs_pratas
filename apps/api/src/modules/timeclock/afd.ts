import type { TimeClockEventType } from "@prisma/client";

/**
 * AFD — Arquivo Fonte de Dados do ponto eletrônico.
 *
 * É o arquivo que a fiscalização do trabalho pede. Formato de posição fixa:
 * cada campo ocupa um número exato de colunas, texto alinhado à esquerda com
 * espaços à direita, número alinhado à direita com zeros à esquerda. Uma
 * coluna fora do lugar invalida o arquivo inteiro.
 *
 * Estrutura, conforme a Portaria MTP 671/2021 para REP-P:
 *   tipo 1 — cabeçalho, com o empregador e o período
 *   tipo 7 — marcação de ponto (o tipo próprio de REP-P e REP-A; o tipo 3 é
 *            do relógio físico, REP-C, e não se aplica aqui)
 *   tipo 9 — trailer, com a contagem de cada tipo
 *
 * ATENÇÃO: as larguras e a ordem dos campos abaixo seguem o layout como está
 * documentado aqui, num único lugar, justamente para poderem ser conferidas
 * contra o texto vigente da portaria antes do primeiro uso real. Este módulo
 * produz o arquivo; ele NÃO substitui a validação jurídica/contábil, nem a
 * conferência num validador oficial. Trate como pendência de homologação.
 */

/** Texto à esquerda, espaços à direita. Corta o que exceder. */
function texto(valor: string, tamanho: number): string {
  return valor.slice(0, tamanho).padEnd(tamanho, " ");
}

/** Número à direita, zeros à esquerda. Só dígitos entram. */
function numero(valor: string | number, tamanho: number): string {
  return String(valor).replace(/\D/g, "").slice(-tamanho).padStart(tamanho, "0");
}

/**
 * Remove acento e qualquer caractere fora do ASCII imprimível.
 *
 * O arquivo é lido por sistemas antigos que não falam UTF-8: "José" viraria
 * dois bytes onde o layout espera um, e todo o resto da linha andaria uma
 * coluna. O nome sai como "JOSE" — feio, mas alinhado.
 */
function ascii(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .toUpperCase();
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** DDMMAAAA, no fuso informado. */
function dataAfd(quando: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(quando);

  const pegar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return `${pegar("day")}${pegar("month")}${pegar("year")}`;
}

/** HHMMSS, no fuso informado. */
function horaAfd(quando: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(quando);

  const pegar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return `${pegar("hour")}${pegar("minute")}${pegar("second")}`;
}

/**
 * Data e hora em ISO 8601 com o deslocamento do fuso, como o registro tipo 7
 * exige: 2026-08-20T16:52:00-0300.
 *
 * O deslocamento é calculado a partir do próprio fuso, e não fixado em -0300:
 * o Brasil já teve horário de verão e pode voltar a ter, e uma marcação de
 * janeiro gravada com o deslocamento errado desloca a jornada em uma hora.
 */
function iso8601ComFuso(quando: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(quando);

  const pegar = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";

  // Diferença entre a hora local do fuso e o UTC, em minutos.
  const local = Date.UTC(
    Number(pegar("year")),
    Number(pegar("month")) - 1,
    Number(pegar("day")),
    Number(pegar("hour")),
    Number(pegar("minute")),
    Number(pegar("second")),
  );
  const deslocamentoMin = Math.round((local - quando.getTime()) / 60_000);
  const sinal = deslocamentoMin < 0 ? "-" : "+";
  const abs = Math.abs(deslocamentoMin);

  return (
    `${pegar("year")}-${pegar("month")}-${pegar("day")}` +
    `T${pegar("hour")}:${pegar("minute")}:${pegar("second")}` +
    `${sinal}${doisDigitos(Math.floor(abs / 60))}${doisDigitos(abs % 60)}`
  );
}

export interface AfdEmpregador {
  /** 1 = CNPJ, 2 = CPF. */
  tipoIdentificador: 1 | 2;
  cnpjOuCpf: string;
  razaoSocial: string;
  /** CEI/CNO, quando houver. */
  cei?: string | undefined;
  /** Identificação do REP-P no empregador. */
  identificacaoRep: string;
}

export interface AfdMarcacao {
  nsr: bigint | number;
  type: TimeClockEventType;
  timestamp: Date;
  /** CPF de quem bateu, só dígitos. */
  cpf: string;
}

export interface AfdParams {
  empregador: AfdEmpregador;
  marcacoes: AfdMarcacao[];
  inicio: Date;
  fim: Date;
  geradoEm: Date;
  timezone: string;
}

/** Linha do cabeçalho (tipo 1). */
function cabecalho(params: AfdParams): string {
  const { empregador: e } = params;

  return [
    numero(0, 9), // NSR do cabeçalho é sempre zero
    "1",
    String(e.tipoIdentificador),
    numero(e.cnpjOuCpf, 14),
    numero(e.cei ?? "", 12),
    texto(ascii(e.razaoSocial), 150),
    texto(ascii(e.identificacaoRep), 17),
    dataAfd(params.inicio, params.timezone),
    dataAfd(params.fim, params.timezone),
    dataAfd(params.geradoEm, params.timezone),
    horaAfd(params.geradoEm, params.timezone),
    "003", // versão do layout
  ].join("");
}

/**
 * Linha de marcação (tipo 7).
 *
 * O AFD registra o INSTANTE da batida, não o significado dela: entrada e saída
 * são a mesma linha, e a jornada é reconstruída pela ordem — par a par. Por
 * isso o tipo do evento não aparece aqui.
 */
function marcacao(m: AfdMarcacao, timezone: string): string {
  return [
    numero(m.nsr.toString(), 9),
    "7",
    iso8601ComFuso(m.timestamp, timezone),
    "1", // tipo de identificador do trabalhador: 1 = CPF
    numero(m.cpf, 12),
  ].join("");
}

/** Linha do trailer (tipo 9), com a contagem por tipo de registro. */
function trailer(quantidadeMarcacoes: number): string {
  return [
    numero(9, 9),
    numero(0, 9), // registros tipo 2 (empresa)
    numero(0, 9), // tipo 3 (marcação REP-C)
    numero(0, 9), // tipo 4 (ajuste de relógio)
    numero(0, 9), // tipo 5 (empregado)
    numero(quantidadeMarcacoes, 9), // tipo 7 (marcação REP-P)
    "9",
  ].join("");
}

/**
 * Monta o AFD completo.
 *
 * As marcações saem em ordem de NSR, e não de horário: o NSR é a ordem em que
 * os registros ENTRARAM no sistema, e é essa sequência que o arquivo precisa
 * provar íntegra. Uma correção lançada hoje sobre uma batida de ontem tem NSR
 * maior e aparece depois — é assim que se vê que ela é posterior.
 */
export function gerarAfd(params: AfdParams): string {
  const ordenadas = [...params.marcacoes].sort((a, b) =>
    BigInt(a.nsr) < BigInt(b.nsr) ? -1 : BigInt(a.nsr) > BigInt(b.nsr) ? 1 : 0,
  );

  const linhas = [
    cabecalho(params),
    ...ordenadas.map((m) => marcacao(m, params.timezone)),
    trailer(ordenadas.length),
  ];

  // CRLF e quebra no fim da última linha: é arquivo de posição fixa lido por
  // sistema legado, que costuma exigir o terminador em todas as linhas.
  return `${linhas.join("\r\n")}\r\n`;
}
