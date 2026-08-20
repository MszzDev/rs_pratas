import { z } from "zod";

export const TIME_CLOCK_EVENT_TYPES = [
  "CLOCK_IN",
  "CLOCK_OUT",
  "BREAK_START",
  "BREAK_END",
] as const;

export const WEEKDAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:mm, por exemplo 08:00.");

export const punchSchema = z.object({
  /**
   * O tablet manda o seu identificador. Quem entra pelo computador da loja não
   * tem um — e a marcação não pode depender disso: recusar a batida por falta
   * de aparelho seria impedir o funcionário de comprovar a jornada que
   * cumpriu. Sem tablet, o servidor resolve a loja pelo vínculo do usuário.
   */
  deviceId: z.string().uuid().optional(),
  type: z.enum(TIME_CLOCK_EVENT_TYPES),
  /**
   * Obrigatória quando o funcionário sai durante o turno. A validação real é
   * feita no servidor, que conhece a jornada — aqui é só o transporte.
   */
  justification: z.string().max(500).optional(),
  clientTimestamp: z.string().datetime().optional(),
});

export const correctEntrySchema = z.object({
  type: z.enum(TIME_CLOCK_EVENT_TYPES),
  timestamp: z.string().datetime(),
  reason: z.string().min(5, "Descreva o motivo da correção.").max(500),
});

export const createWorkScheduleSchema = z.object({
  userId: z.string().uuid(),
  storeId: z.string().uuid(),
  weekday: z.enum(WEEKDAYS),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  breakStartTime: timeOfDaySchema.optional(),
  breakEndTime: timeOfDaySchema.optional(),
  toleranceMinutes: z.number().int().min(0).max(60).default(10),
});

export const mirrorQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const timeClockEntrySchema = z.object({
  id: z.string().uuid(),
  nsr: z.string(),
  type: z.enum(TIME_CLOCK_EVENT_TYPES),
  timestamp: z.string(),
  isWithinTolerance: z.boolean().nullable(),
  minutesLate: z.number().nullable(),
  justification: z.string().nullable(),
  justificationPending: z.boolean(),
  correctsEntryId: z.string().uuid().nullable(),
  correctionReason: z.string().nullable(),
  storeId: z.string().uuid(),
  deviceId: z.string().uuid(),
});

export type TimeClockEventType = (typeof TIME_CLOCK_EVENT_TYPES)[number];
export type Weekday = (typeof WEEKDAYS)[number];

export type PunchInput = z.infer<typeof punchSchema>;
export type CorrectEntryInput = z.infer<typeof correctEntrySchema>;
export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;
export type TimeClockEntryDto = z.infer<typeof timeClockEntrySchema>;
