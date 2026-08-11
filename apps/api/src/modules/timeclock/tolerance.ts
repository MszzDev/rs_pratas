/**
 * Cálculo de atraso em relação à jornada.
 *
 * A tolerância é aplicada apenas à entrada e ao retorno do intervalo — sair
 * antes do fim do turno é assunto de justificativa, não de tolerância.
 */

export interface ToleranceResult {
  isWithinTolerance: boolean;
  minutesLate: number;
}

/** Converte "08:30" em minutos desde a meia-noite. */
export function parseTimeOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/**
 * Minutos decorridos desde a meia-noite no fuso da loja.
 *
 * O horário de referência é sempre o da loja, não o do servidor: uma rede com
 * lojas em fusos diferentes registraria atrasos falsos se comparasse tudo com
 * UTC.
 */
export function minutesOfDayInTimezone(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const [hours, minutes] = formatter.format(instant).split(":").map(Number);
  return hours! * 60 + minutes!;
}

/**
 * Compara a marcação com o horário previsto.
 *
 * Turno que cruza a meia-noite (ex.: 22:00 às 06:00) é tratado escolhendo a
 * distância circular menor: sem isso, bater 22:03 num turno que começa 22:00
 * seria lido como 1.437 minutos de adiantamento.
 */
export function evaluateTolerance(params: {
  actualMinutes: number;
  expectedMinutes: number;
  toleranceMinutes: number;
}): ToleranceResult {
  const { actualMinutes, expectedMinutes, toleranceMinutes } = params;

  const MINUTES_IN_DAY = 24 * 60;
  let difference = actualMinutes - expectedMinutes;

  if (difference > MINUTES_IN_DAY / 2) {
    difference -= MINUTES_IN_DAY;
  } else if (difference < -MINUTES_IN_DAY / 2) {
    difference += MINUTES_IN_DAY;
  }

  // Chegar adiantado nunca é atraso.
  const minutesLate = Math.max(0, difference);

  return {
    isWithinTolerance: minutesLate <= toleranceMinutes,
    minutesLate,
  };
}

/** Dia da semana no fuso da loja, no formato do enum Weekday do Prisma. */
export function weekdayInTimezone(instant: Date, timezone: string): string {
  const weekdays = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ] as const;

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(instant);

  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(formatted);
  return weekdays[index === -1 ? 0 : index]!;
}
