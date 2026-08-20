import type { TimeClockEventType, Weekday } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { CorrectEntryInput, CreateWorkScheduleInput, PunchInput } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess, userCanAccessStore } from "../../core/rbac/require-role.hook.js";
import {
  evaluateTolerance,
  minutesOfDayInTimezone,
  parseTimeOfDay,
  weekdayInTimezone,
} from "./tolerance.js";

/** Tipos de marcação que exigem justificativa obrigatória. */
const REQUIRES_JUSTIFICATION: TimeClockEventType[] = ["CLOCK_OUT", "BREAK_START"];

/**
 * Sugere o próximo evento a partir do último registrado, para o tablet mostrar
 * o botão certo em vez de fazer o funcionário escolher entre quatro opções.
 */
export function suggestNextEventType(last: TimeClockEventType | null): TimeClockEventType {
  switch (last) {
    case null:
    case "CLOCK_OUT":
      return "CLOCK_IN";
    case "CLOCK_IN":
    case "BREAK_END":
      return "BREAK_START";
    case "BREAK_START":
      return "BREAK_END";
    default:
      return "CLOCK_OUT";
  }
}

/**
 * Em qual loja este funcionário bate ponto quando não há tablet.
 *
 * Usa a loja marcada como principal; se não houver marcação, a única a que ele
 * está vinculado. Com mais de uma e nenhuma principal, devolve a primeira por
 * ordem de vínculo — determinístico de propósito: o espelho de ponto precisa
 * cair sempre na mesma loja, senão a jornada de uma pessoa se espalha por
 * várias e ninguém consegue conferir.
 */
export async function resolveStoreForPunch(
  userId: string,
): Promise<{ id: string; timezone: string } | null> {
  const link = await prisma.userStore.findFirst({
    where: { userId, store: { deletedAt: null } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { store: { select: { id: true, timezone: true } } },
  });

  return link?.store ?? null;
}

/**
 * As marcações de hoje, no fuso da loja onde a pessoa trabalha.
 *
 * "Hoje" precisa ser o dia da loja, não o do servidor: com a virada em UTC às
 * 21h de Brasília, quem fecha a loja às 22h teria o próprio expediente
 * contado no dia seguinte.
 */
export async function getTodayEntries(userId: string, timezone: string) {
  const agora = new Date();
  const diaLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);

  // Uma janela generosa em volta do dia local, refinada em memória: comparar a
  // data no fuso certo dentro do SQL exigiria função específica do banco.
  const inicio = new Date(`${diaLocal}T00:00:00.000Z`);
  const janela = new Date(inicio.getTime() - 24 * 3600_000);
  const fim = new Date(inicio.getTime() + 48 * 3600_000);

  const entries = await prisma.timeClockEntry.findMany({
    where: {
      userId,
      correctsEntryId: null,
      timestamp: { gte: janela, lte: fim },
    },
    orderBy: { timestamp: "asc" },
  });

  const mesmoDia = (data: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(data) === diaLocal;

  return entries.filter((entry) => mesmoDia(entry.timestamp));
}

export async function getLastEntry(userId: string) {
  return prisma.timeClockEntry.findFirst({
    where: { userId, correctsEntryId: null },
    orderBy: { timestamp: "desc" },
  });
}

/**
 * Registra uma marcação de ponto.
 *
 * Princípio central do REP-P: o sistema NUNCA recusa uma marcação. Faltando
 * justificativa, o registro entra assim mesmo com justificationPending, e a
 * pendência é resolvida depois por uma correção — que também é um registro
 * novo. Bloquear a batida seria impedir o trabalhador de comprovar a jornada
 * que efetivamente cumpriu.
 */
export async function registerPunch(params: { input: PunchInput; request: FastifyRequest }) {
  const { input, request } = params;

  // O tablet informa quem ele é; a sessão sabe de qual aparelho o login partiu.
  // Qualquer um dos dois serve — e nenhum dos dois é obrigatório.
  const deviceId = input.deviceId ?? request.user.deviceId;

  const device = deviceId
    ? await prisma.device.findFirst({
        where: { id: deviceId, deletedAt: null },
        include: { store: { select: { id: true, timezone: true } } },
      })
    : null;

  if (deviceId && !device) {
    throw badRequest("DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
  }

  if (device && device.companyId !== request.user.companyId) {
    throw forbidden("DEVICE_WRONG_COMPANY", "Dispositivo não pertence à sua empresa.");
  }

  // Sem tablet, a loja vem do vínculo do funcionário. Quem trabalha em uma só
  // loja — a esmagadora maioria — bate ponto sem escolher nada.
  const store = device ? device.store : await resolveStoreForPunch(request.user.sub);

  if (!store) {
    throw badRequest(
      "NO_STORE_LINKED",
      "Sua matrícula não está vinculada a nenhuma loja. Peça ao dono para vincular antes de bater o ponto.",
    );
  }

  // Não basta o tablet ser da mesma empresa: o funcionário precisa ter acesso
  // àquela loja. Sem isso, quem entrasse por senha (sessão sem dispositivo)
  // poderia registrar ponto no tablet de qualquer outra loja da rede.
  const canUseStore = await userCanAccessStore({
    userId: request.user.sub,
    role: request.user.role,
    companyId: request.user.companyId,
    storeId: store.id,
  });

  if (!canUseStore) {
    await audit(request, {
      action: "TIMECLOCK_ENTRY_CREATE",
      result: "DENIED",
      userId: request.user.sub,
      companyId: request.user.companyId,
      storeId: store.id,
      ...(device ? { deviceId: device.id } : {}),
      userRoleSnapshot: request.user.role,
      reason: "usuário sem acesso à loja do dispositivo",
    });
    throw forbidden("STORE_ACCESS_DENIED", "Você não tem acesso a esta loja.");
  }

  const timestamp = new Date();
  const timezone = store.timezone;
  const weekday = weekdayInTimezone(timestamp, timezone) as Weekday;

  const schedule = await prisma.workSchedule.findFirst({
    where: {
      userId: request.user.sub,
      weekday,
      isActive: true,
      effectiveFrom: { lte: timestamp },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: timestamp } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  let isWithinTolerance: boolean | null = null;
  let minutesLate: number | null = null;

  // A tolerância é calculada contra a jornada vigente HOJE e congelada na
  // linha: se a jornada mudar amanhã, o histórico continua contando a verdade
  // do dia em que aconteceu.
  if (schedule) {
    const expected = expectedMinutesFor(input.type, schedule);

    if (expected !== null) {
      const result = evaluateTolerance({
        actualMinutes: minutesOfDayInTimezone(timestamp, timezone),
        expectedMinutes: expected,
        toleranceMinutes: schedule.toleranceMinutes,
      });
      isWithinTolerance = result.isWithinTolerance;
      minutesLate = result.minutesLate;
    }
  }

  const needsJustification = REQUIRES_JUSTIFICATION.includes(input.type);
  const justification = input.justification?.trim() ?? null;

  const entry = await prisma.timeClockEntry.create({
    data: {
      userId: request.user.sub,
      companyId: request.user.companyId,
      storeId: store.id,
      deviceId: device?.id ?? null,
      type: input.type,
      timestamp,
      clientTimestamp: input.clientTimestamp ? new Date(input.clientTimestamp) : null,
      isWithinTolerance,
      minutesLate,
      justification,
      justificationPending: needsJustification && !justification,
      sourceIp: request.ip,
    },
  });

  await audit(request, {
    action: "TIMECLOCK_ENTRY_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: store.id,
    ...(device ? { deviceId: device.id } : {}),
    userRoleSnapshot: request.user.role,
    entityType: "TimeClockEntry",
    entityId: entry.id,
    newData: {
      type: entry.type,
      nsr: entry.nsr.toString(),
      isWithinTolerance,
      minutesLate,
      justificationPending: entry.justificationPending,
    },
  });

  return entry;
}

function expectedMinutesFor(
  type: TimeClockEventType,
  schedule: { startTime: string; endTime: string; breakStartTime: string | null; breakEndTime: string | null },
): number | null {
  switch (type) {
    case "CLOCK_IN":
      return parseTimeOfDay(schedule.startTime);
    case "BREAK_END":
      return schedule.breakEndTime ? parseTimeOfDay(schedule.breakEndTime) : null;
    // Saída e início do intervalo não geram atraso — antecipar a saída é
    // assunto de justificativa, e o cálculo aqui só confundiria o espelho.
    case "CLOCK_OUT":
    case "BREAK_START":
    default:
      return null;
  }
}

/**
 * Registra uma correção. Nunca altera o registro original — grava um evento
 * novo apontando para ele. A trava no banco (trigger + REVOKE) garante isso
 * mesmo que alguém tente contornar pela aplicação.
 */
export async function correctEntry(params: {
  entryId: string;
  input: CorrectEntryInput;
  request: FastifyRequest;
}) {
  const { entryId, input, request } = params;

  const original = await prisma.timeClockEntry.findFirst({
    where: { id: entryId, companyId: request.user.companyId },
  });
  if (!original) {
    throw notFound("TIMECLOCK_ENTRY_NOT_FOUND", "Marcação não encontrada.");
  }

  await assertStoreAccess(request, original.storeId);

  const correction = await prisma.timeClockEntry.create({
    data: {
      userId: original.userId,
      companyId: original.companyId,
      storeId: original.storeId,
      deviceId: original.deviceId,
      type: input.type,
      timestamp: new Date(input.timestamp),
      correctsEntryId: original.id,
      correctionReason: input.reason,
      sourceIp: request.ip,
    },
  });

  await audit(request, {
    action: "TIMECLOCK_CORRECTION",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: original.companyId,
    storeId: original.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "TimeClockEntry",
    entityId: correction.id,
    previousData: {
      originalId: original.id,
      type: original.type,
      timestamp: original.timestamp.toISOString(),
    },
    newData: { type: correction.type, timestamp: correction.timestamp.toISOString() },
    reason: input.reason,
  });

  return correction;
}

/**
 * Espelho de ponto. Mostra o registro original E suas correções encadeadas —
 * nunca esconde o original, que é justamente o que dá validade ao documento.
 */
export async function getMirror(params: {
  userId: string;
  from?: Date;
  to?: Date;
  request: FastifyRequest;
}) {
  const { userId, from, to, request } = params;

  const isSelf = userId === request.user.sub;
  const canSeeOthers =
    request.user.role === "DONO" ||
    request.user.role === "GERENTE" ||
    request.user.role === "DESENVOLVEDOR";

  if (!isSelf && !canSeeOthers) {
    throw forbidden("FORBIDDEN_ROLE", "Você só pode consultar o seu próprio espelho de ponto.");
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      employeeCode: true,
      userStores: { select: { storeId: true } },
    },
  });
  if (!target) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  // O gerente enxerga o ponto da SUA loja, não o da rede inteira. Sem esta
  // checagem, o perfil de gerente daria acesso à jornada de qualquer
  // funcionário da empresa — inclusive de lojas onde ele não atua.
  if (!isSelf && request.user.role === "GERENTE") {
    const sharesStore = target.userStores.some((link) =>
      request.user.storeIds.includes(link.storeId),
    );

    if (!sharesStore) {
      // 404 e não 403: confirmar que o funcionário existe já seria informação.
      throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
    }
  }

  const entries = await prisma.timeClockEntry.findMany({
    where: {
      userId,
      companyId: request.user.companyId,
      ...(from || to
        ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    include: { corrections: true },
    orderBy: { timestamp: "asc" },
  });

  return {
    user: { id: target.id, name: target.name, employeeCode: target.employeeCode },
    entries: entries
      .filter((entry) => entry.correctsEntryId === null)
      .map((entry) => ({
        id: entry.id,
        nsr: entry.nsr.toString(),
        type: entry.type,
        timestamp: entry.timestamp,
        isWithinTolerance: entry.isWithinTolerance,
        minutesLate: entry.minutesLate,
        justification: entry.justification,
        justificationPending: entry.justificationPending,
        storeId: entry.storeId,
        deviceId: entry.deviceId,
        corrections: entry.corrections.map((correction) => ({
          id: correction.id,
          nsr: correction.nsr.toString(),
          type: correction.type,
          timestamp: correction.timestamp,
          reason: correction.correctionReason,
        })),
      })),
  };
}

export async function createWorkSchedule(params: {
  input: CreateWorkScheduleInput;
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  const user = await prisma.user.findFirst({
    where: { id: input.userId, companyId: request.user.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  // Uma jornada nova encerra a anterior daquele dia em vez de substituí-la: o
  // histórico precisa continuar explicando os registros antigos.
  const now = new Date();
  await prisma.workSchedule.updateMany({
    where: { userId: input.userId, weekday: input.weekday, isActive: true, effectiveTo: null },
    data: { effectiveTo: now, isActive: false },
  });

  const schedule = await prisma.workSchedule.create({
    data: {
      userId: input.userId,
      companyId: request.user.companyId,
      storeId: input.storeId,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      breakStartTime: input.breakStartTime ?? null,
      breakEndTime: input.breakEndTime ?? null,
      toleranceMinutes: input.toleranceMinutes,
      createdById: request.user.sub,
      effectiveFrom: now,
    },
  });

  await audit(request, {
    action: "WORK_SCHEDULE_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "WorkSchedule",
    entityId: schedule.id,
    newData: {
      targetUserId: input.userId,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      toleranceMinutes: input.toleranceMinutes,
    },
  });

  return schedule;
}

/**
 * Encerra uma jornada sem apagá-la.
 *
 * A linha continua no banco com `effectiveTo` preenchido porque o cálculo de
 * atraso de qualquer marcação antiga depende da jornada que valia no dia. Um
 * DELETE reescreveria o passado de um registro que tem valor legal.
 */
export async function deactivateWorkSchedule(params: {
  scheduleId: string;
  request: FastifyRequest;
}) {
  const { scheduleId, request } = params;

  const schedule = await prisma.workSchedule.findFirst({
    where: { id: scheduleId, companyId: request.user.companyId },
  });
  if (!schedule) {
    throw notFound("SCHEDULE_NOT_FOUND", "Jornada não encontrada.");
  }

  await assertStoreAccess(request, schedule.storeId);

  const updated = await prisma.workSchedule.update({
    where: { id: schedule.id },
    data: { isActive: false, effectiveTo: schedule.effectiveTo ?? new Date() },
  });

  await audit(request, {
    action: "WORK_SCHEDULE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: schedule.companyId,
    storeId: schedule.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "WorkSchedule",
    entityId: schedule.id,
    previousData: { isActive: schedule.isActive, effectiveTo: schedule.effectiveTo },
    newData: { isActive: updated.isActive, effectiveTo: updated.effectiveTo },
    reason: "jornada encerrada",
  });

  return updated;
}
