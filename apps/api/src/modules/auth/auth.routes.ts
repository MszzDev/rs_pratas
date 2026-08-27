import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  firstAccessCompleteSchema,
  firstAccessFinishSchema,
  firstAccessSetPasswordSchema,
  firstAccessSetPinSchema,
  firstAccessStartSchema,
  loginPasswordSchema,
  loginPinSchema,
  refreshSchema,
} from "@rs-pratas/shared";
import { env } from "../../config/env.js";
import { unauthorized } from "../../core/errors.js";
import {
  listActiveSessions,
  loginWithPassword,
  logout,
  logoutAll,
  refreshSession,
  revokeSessionById,
  type AccessTokenPayload,
} from "./auth.service.js";
import { loginWithPin } from "./pin-login.service.js";
import {
  ONBOARDING_SCOPE,
  completeFirstAccess,
  finishFirstAccess,
  onboardingSignOptions,
  setFirstAccessPassword,
  setFirstAccessPin,
  startFirstAccess,
  type OnboardingTokenPayload,
} from "./first-access.service.js";
import { requireRole } from "../../core/rbac/require-role.hook.js";
import {
  approvePinReset,
  changeOwnPin,
  listPinResets,
  rejectPinReset,
  requestPinReset,
  verifyOwnPin,
} from "./pin.service.js";

export async function authRoutes(app: FastifyInstance) {
  const signAccessToken = (payload: AccessTokenPayload) => app.jwt.sign(payload);

  /**
   * Rate limit próprio, bem mais apertado que o global: endpoints de login são
   * o alvo natural de força bruta. A contagem por IP aqui soma-se ao bloqueio
   * por usuário (passwordFailedAttempts) — camadas diferentes, ataques
   * diferentes: uma barra o atacante distribuído no mesmo IP, a outra barra a
   * tentativa concentrada numa conta específica.
   */
  const loginRateLimit = {
    rateLimit: {
      max: env.LOGIN_RATE_LIMIT_PER_MINUTE,
      timeWindow: "1 minute",
    },
  };

  app.post("/login/password", { config: loginRateLimit }, async (request, reply) => {
    const input = loginPasswordSchema.parse(request.body);
    const result = await loginWithPassword({ input, request, signAccessToken });
    return reply.status(200).send(result);
  });

  app.post("/login/pin", { config: loginRateLimit }, async (request, reply) => {
    const input = loginPinSchema.parse(request.body);
    const result = await loginWithPin({ input, request, signAccessToken });
    return reply.status(200).send(result);
  });

  /**
   * Token de propósito único do primeiro acesso. É assinado com o mesmo segredo
   * do access token, mas carrega `scope: first_access` e nenhum sessionId — o
   * `requireAuth` das rotas normais recusa qualquer token com esse escopo.
   */
  const signOnboardingToken = (payload: OnboardingTokenPayload) =>
    app.jwt.sign(payload, onboardingSignOptions);

  const readOnboardingUserId = (token: string): string => {
    try {
      const payload = app.jwt.verify<OnboardingTokenPayload>(token);
      if (payload.scope !== ONBOARDING_SCOPE) {
        throw new Error("escopo inválido");
      }
      return payload.sub;
    } catch {
      throw unauthorized(
        "INVALID_ONBOARDING_TOKEN",
        "Sua sessão de primeiro acesso expirou. Comece novamente.",
      );
    }
  };

  app.post("/first-access/start", { config: loginRateLimit }, async (request, reply) => {
    const input = firstAccessStartSchema.parse(request.body);
    const result = await startFirstAccess({ input, request, signOnboardingToken });
    return reply.status(200).send(result);
  });

  app.post("/first-access/set-password", async (request, reply) => {
    const input = firstAccessSetPasswordSchema.parse(request.body);
    const userId = readOnboardingUserId(input.onboardingToken);
    await setFirstAccessPassword({ userId, input, request });
    return reply.status(204).send();
  });

  app.post("/first-access/set-pin", async (request, reply) => {
    const input = firstAccessSetPinSchema.parse(request.body);
    const userId = readOnboardingUserId(input.onboardingToken);
    await setFirstAccessPin({ userId, input, request });
    return reply.status(204).send();
  });

  /**
   * Senha e PIN de uma vez, gravados juntos.
   *
   * Os passos separados abaixo continuam existindo para não quebrar quem já
   * está no meio do fluxo com uma tela antiga aberta, mas a tela nova usa só
   * este: era o estado intermediário entre eles que trancava a conta.
   */
  app.post("/first-access/finish", async (request, reply) => {
    const input = firstAccessFinishSchema.parse(request.body);
    const userId = readOnboardingUserId(input.onboardingToken);
    await finishFirstAccess({ userId, input, request });
    return reply.status(204).send();
  });

  app.post("/first-access/complete", async (request, reply) => {
    const input = firstAccessCompleteSchema.parse(request.body);
    const userId = readOnboardingUserId(input.onboardingToken);
    await completeFirstAccess({ userId, request });
    return reply.status(204).send();
  });

  app.post("/refresh", { config: loginRateLimit }, async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const result = await refreshSession({ refreshToken, request, signAccessToken });
    return reply.status(200).send(result);
  });

  app.post("/logout", async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    await logout({ refreshToken, request });
    return reply.status(204).send();
  });

  app.post("/logout-all", { preHandler: app.requireAuth }, async (request, reply) => {
    const revoked = await logoutAll({ userId: request.user.sub, request });
    return reply.status(200).send({ revokedSessions: revoked });
  });

  app.get("/sessions", { preHandler: app.requireAuth }, async (request) => {
    const sessions = await listActiveSessions(request.user.sub);

    return sessions.map((session) => ({
      id: session.id,
      deviceId: session.deviceId,
      deviceName: session.device?.name ?? null,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      current: session.id === request.user.sessionId,
    }));
  });

  app.delete("/sessions/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await revokeSessionById({ sessionId: id, request });
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: app.requireAuth }, async (request) => {
    return {
      id: request.user.sub,
      companyId: request.user.companyId,
      role: request.user.role,
      storeIds: request.user.storeIds,
      sessionId: request.user.sessionId,
      deviceId: request.user.deviceId,
    };
  });

  // ------------------------------------------------------------------ PIN

  /** O funcionario troca o proprio PIN. Exige o atual. */
  app.post("/pin/change", { preHandler: app.requireAuth }, async (request) => {
    const body = z
      .object({
        currentPin: z.string().min(4).max(8),
        newPin: z.string().regex(/^[0-9]{6}$/, "O PIN novo precisa ter 6 numeros."),
      })
      .parse(request.body);

    return changeOwnPin({ ...body, request });
  });

  /** Destrava a tela do tablet depois da inatividade. Nao emite sessao nova. */
  app.post(
    "/pin/verify",
    { preHandler: app.requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const { pin } = z.object({ pin: z.string().min(4).max(8) }).parse(request.body);
      return verifyOwnPin({ pin, request });
    },
  );

  /**
   * Pedido de PIN temporario, feito da tela de login.
   *
   * Sem sessao: quem nao consegue entrar nao tem sessao para pedir com ela.
   * Pedir nao concede nada — so o dono ou o gerente aprovam.
   */
  app.post("/pin/reset-request", async (request) => {
    const body = z
      .object({
        employeeCode: z.string().min(3).max(20),
        /**
         * O que a pessoa perdeu. PIN é o padrão porque foi o primeiro caminho
         * e é o que as telas antigas continuam mandando.
         */
        type: z.enum(["PIN", "SENHA"]).optional(),
        deviceId: z.string().uuid().optional(),
      })
      .parse(request.body);

    return requestPinReset(body);
  });

  app.get(
    "/pin/reset-requests",
    { preHandler: [app.requireAuth, requireRole("DONO", "GERENTE")] },
    async (request) => listPinResets(request),
  );

  app.post(
    "/pin/reset-requests/:id/approve",
    { preHandler: [app.requireAuth, requireRole("DONO", "GERENTE")] },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      return approvePinReset({ requestId: id, request });
    },
  );

  app.post(
    "/pin/reset-requests/:id/reject",
    { preHandler: [app.requireAuth, requireRole("DONO", "GERENTE")] },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { reason } = z
        .object({ reason: z.string().min(3, "Diga por que esta recusando.").max(300) })
        .parse(request.body);

      return rejectPinReset({ requestId: id, reason, request });
    },
  );
}
