import { z } from "zod";

/**
 * Horário de funcionamento da loja.
 *
 * Não é o mesmo que a loja estar aberta agora — isso quem diz é o tablet, no
 * primeiro login do dia. Isto aqui é o horário anunciado: o que vai no
 * comprovante, o que responde "a Vila Matilde abre na segunda?" e o que
 * preenche a jornada de quem for cadastrado na loja, em vez de alguém digitar
 * sete linhas iguais para cada funcionário.
 *
 * Dia sem horário é dia fechado. Guardar `null` em vez de omitir a chave
 * distingue "fecha nesse dia" de "ninguém preencheu ainda" — a diferença
 * importa na hora de decidir se o sistema avisa que falta configurar.
 */

const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const intervaloSchema = z
  .object({
    abre: z.string().regex(HORA, "Use o formato 10:00."),
    fecha: z.string().regex(HORA, "Use o formato 19:00."),
  })
  .refine((valor) => valor.fecha > valor.abre, {
    message: "O fechamento precisa ser depois da abertura.",
  });

export const DIAS_DA_SEMANA = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
] as const;

export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

export const ROTULO_DO_DIA: Record<DiaDaSemana | "feriado", string> = {
  segunda: "Segunda",
  terca: "Terça",
  quarta: "Quarta",
  quinta: "Quinta",
  sexta: "Sexta",
  sabado: "Sábado",
  domingo: "Domingo",
  feriado: "Feriado",
};

export const storeHoursSchema = z.object({
  segunda: intervaloSchema.nullable(),
  terca: intervaloSchema.nullable(),
  quarta: intervaloSchema.nullable(),
  quinta: intervaloSchema.nullable(),
  sexta: intervaloSchema.nullable(),
  sabado: intervaloSchema.nullable(),
  domingo: intervaloSchema.nullable(),
  /**
   * Feriado tem horário próprio porque quase sempre é diferente, e porque
   * cair no horário do dia da semana correspondente daria errado justamente
   * nos dias de maior movimento.
   */
  feriado: intervaloSchema.nullable(),
});

export type Intervalo = z.infer<typeof intervaloSchema>;
export type StoreHours = z.infer<typeof storeHoursSchema>;

/** Horário vazio — todos os dias fechados, para a tela partir de algum lugar. */
export function horarioVazio(): StoreHours {
  return {
    segunda: null,
    terca: null,
    quarta: null,
    quinta: null,
    sexta: null,
    sabado: null,
    domingo: null,
    feriado: null,
  };
}

/**
 * "10:00" vira "10h"; "18:20" vira "18h20"; "09:00" vira "9h".
 *
 * É como se escreve numa placa de vitrine — e é assim que a pessoa que leu a
 * placa espera reencontrar o horário aqui dentro.
 */
function comoNaVitrine(hora: string): string {
  const [horas = "", minutos = ""] = hora.split(":");
  const semZeroInicial = String(Number(horas));

  return minutos === "00" ? `${semZeroInicial}h` : `${semZeroInicial}h${minutos}`;
}

function faixa(intervalo: Intervalo): string {
  return `${comoNaVitrine(intervalo.abre)}–${comoNaVitrine(intervalo.fecha)}`;
}

/**
 * Resume o horário numa linha legível, juntando dias seguidos iguais.
 *
 * "Seg–Sáb 10h–19h · Dom e feriado 10h–14h" diz numa linha o que sete linhas
 * diriam repetindo o mesmo horário seis vezes. É como a loja anuncia na
 * vitrine, e é assim que quem lê espera ver.
 */
export function resumirHorario(horas: StoreHours | null | undefined): string | null {
  if (!horas) return null;

  const abreviacoes: Record<DiaDaSemana, string> = {
    segunda: "Seg",
    terca: "Ter",
    quarta: "Qua",
    quinta: "Qui",
    sexta: "Sex",
    sabado: "Sáb",
    domingo: "Dom",
  };

  const partes: string[] = [];
  let inicio: DiaDaSemana | null = null;
  let anterior: DiaDaSemana | null = null;
  let faixaAtual: string | null = null;

  const fechar = () => {
    if (!inicio || !anterior || !faixaAtual) return;

    const nomes =
      inicio === anterior
        ? abreviacoes[inicio]
        : `${abreviacoes[inicio]}–${abreviacoes[anterior]}`;

    partes.push(`${nomes} ${faixaAtual}`);
  };

  for (const dia of DIAS_DA_SEMANA) {
    const intervalo = horas[dia];
    const atual = intervalo ? faixa(intervalo) : null;

    if (atual && atual === faixaAtual) {
      anterior = dia;
      continue;
    }

    fechar();

    inicio = atual ? dia : null;
    anterior = atual ? dia : null;
    faixaAtual = atual;
  }

  fechar();

  if (horas.feriado) {
    partes.push(`Feriado ${faixa(horas.feriado)}`);
  }

  return partes.length > 0 ? partes.join(" · ") : null;
}
