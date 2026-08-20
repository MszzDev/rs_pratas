import type { TimeClockEventType } from "./schemas/timeclock.schema.js";

export interface PunchLike {
  type: TimeClockEventType;
  timestamp: Date;
}

/**
 * Quanto tempo a pessoa esteve efetivamente trabalhando.
 *
 * Conta os trechos em que o relógio estava correndo: da entrada até o começo
 * do intervalo, e da volta do intervalo até a saída. O intervalo não conta —
 * é justamente o tempo em que ela não está à disposição.
 *
 * Se o último evento deixou o relógio correndo (entrou e ainda não saiu), o
 * trecho aberto é contado até `agora`. É isso que permite responder "já deu
 * seis horas?" no momento em que ela pede para sair.
 *
 * Vive aqui, e não no servidor, porque o espelho de ponto na tela precisa
 * chegar exatamente ao mesmo número que a API — duas contas parecidas em
 * lugares diferentes divergem no primeiro caso de borda, e quem descobre é o
 * funcionário conferindo o próprio salário.
 */
export function workedMinutes(entries: PunchLike[], agora: Date): number {
  const ordenados = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  let total = 0;
  let inicioDoTrecho: Date | null = null;

  for (const entry of ordenados) {
    switch (entry.type) {
      case "CLOCK_IN":
      case "BREAK_END":
        // Duas entradas seguidas não somam duas vezes: a segunda só reposiciona
        // o começo do trecho aberto.
        inicioDoTrecho = entry.timestamp;
        break;

      case "BREAK_START":
      case "CLOCK_OUT":
        if (inicioDoTrecho) {
          total += entry.timestamp.getTime() - inicioDoTrecho.getTime();
          inicioDoTrecho = null;
        }
        break;
    }
  }

  if (inicioDoTrecho) {
    total += agora.getTime() - inicioDoTrecho.getTime();
  }

  return Math.max(0, Math.floor(total / 60_000));
}

/**
 * O que faz sentido bater agora.
 *
 * Quem já entrou não entra de novo; quem está no intervalo só volta dele. Isto
 * governa o que a TELA oferece — o servidor continua aceitando qualquer
 * marcação, porque recusar seria impedir alguém de registrar uma jornada que
 * de fato aconteceu, e o REP-P não admite isso. A sequência estranha vira
 * assunto de correção, com o original preservado.
 */
export function allowedNextTypes(last: TimeClockEventType | null): TimeClockEventType[] {
  switch (last) {
    case null:
    case "CLOCK_OUT":
      return ["CLOCK_IN"];
    case "CLOCK_IN":
    case "BREAK_END":
      return ["BREAK_START", "CLOCK_OUT"];
    case "BREAK_START":
      return ["BREAK_END"];
    default:
      return ["CLOCK_IN"];
  }
}

/** Abaixo disto, sair no meio do turno pede explicação. */
export const JORNADA_MINIMA_MINUTOS = 6 * 60;

/** "7h30", "45 min" — duração para gente ler, não para máquina somar. */
export function formatDuration(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
}
