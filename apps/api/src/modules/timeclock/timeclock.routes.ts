import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  correctEntrySchema,
  createWorkScheduleSchema,
  mirrorQuerySchema,
  punchSchema,
} from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import {
  correctEntry,
  createWorkSchedule,
  deactivateWorkSchedule,
  getLastEntry,
  getMirror,
  registerPunch,
  suggestNextEventType,
} from "./timeclock.service.js";

const idParamSchema = z.object({ id: z.string().uuid() });

export async function timeClockRoutes(app: FastifyInstance) {
  /**
   * Tela do tablet logo após o login por PIN: diz qual marcação o funcionário
   * provavelmente vai bater, sem registrar nada. O registro só acontece quando
   * ele confirma — autenticar e bater ponto são dois atos distintos, cada um
   * com seu próprio rastro.
   */
  app.get("/timeclock/next", { preHandler: app.requireAuth }, async (request) => {
    const last = await getLastEntry(request.user.sub);

    return {
      suggestedType: suggestNextEventType(last?.type ?? null),
      lastEntry: last
        ? { type: last.type, timestamp: last.timestamp, nsr: last.nsr.toString() }
        : null,
    };
  });

  app.post("/timeclock/punch", { preHandler: app.requireAuth }, async (request, reply) => {
    const input = punchSchema.parse(request.body);
    const entry = await registerPunch({ input, request });

    return reply.status(201).send({
      id: entry.id,
      nsr: entry.nsr.toString(),
      type: entry.type,
      timestamp: entry.timestamp,
      isWithinTolerance: entry.isWithinTolerance,
      minutesLate: entry.minutesLate,
      justificationPending: entry.justificationPending,
    });
  });

  /** Todo funcionário consulta o próprio espelho — exigência do REP-P. */
  app.get("/timeclock/me/mirror", { preHandler: app.requireAuth }, async (request) => {
    const query = mirrorQuerySchema.parse(request.query);

    return getMirror({
      userId: request.user.sub,
      request,
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
  });

  app.get(
    "/timeclock/users/:id/mirror",
    { preHandler: [app.requireAuth, requirePermission("TIMECLOCK_VIEW_STORE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const query = mirrorQuerySchema.parse(request.query);

      return getMirror({
        userId: id,
        request,
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
      });
    },
  );

  app.post(
    "/timeclock/entries/:id/correct",
    { preHandler: [app.requireAuth, requirePermission("TIMECLOCK_CORRECT")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const input = correctEntrySchema.parse(request.body);
      const correction = await correctEntry({ entryId: id, input, request });

      return reply.status(201).send({
        id: correction.id,
        nsr: correction.nsr.toString(),
        correctsEntryId: correction.correctsEntryId,
        type: correction.type,
        timestamp: correction.timestamp,
      });
    },
  );

  app.get(
    "/timeclock/schedules",
    { preHandler: [app.requireAuth, requirePermission("TIMECLOCK_VIEW_STORE")] },
    async (request) => {
      const query = z.object({ userId: z.string().uuid().optional() }).parse(request.query);

      return prisma.workSchedule.findMany({
        where: {
          companyId: request.user.companyId,
          isActive: true,
          ...(query.userId ? { userId: query.userId } : {}),
        },
        orderBy: [{ userId: "asc" }, { weekday: "asc" }],
      });
    },
  );

  app.post(
    "/timeclock/schedules",
    { preHandler: [app.requireAuth, requirePermission("TIMECLOCK_MANAGE_SCHEDULE")] },
    async (request, reply) => {
      const input = createWorkScheduleSchema.parse(request.body);
      const schedule = await createWorkSchedule({ input, request });
      return reply.status(201).send(schedule);
    },
  );

  /**
   * Encerrar uma jornada não apaga a linha: marca `effectiveTo` e desativa.
   *
   * O cálculo de atraso de uma marcação antiga precisa da jornada que valia
   * naquele dia. Apagar reescreveria o passado do ponto oficial.
   */
  app.delete(
    "/timeclock/schedules/:id",
    { preHandler: [app.requireAuth, requirePermission("TIMECLOCK_MANAGE_SCHEDULE")] },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      return deactivateWorkSchedule({ scheduleId: id, request });
    },
  );
}
