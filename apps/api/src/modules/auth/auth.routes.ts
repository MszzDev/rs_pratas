import type { FastifyInstance } from "fastify";
import { loginPasswordSchema, refreshSchema } from "@rs-pratas/shared";
import { env } from "../../config/env.js";
import {
  loginWithPassword,
  logout,
  logoutAll,
  refreshSession,
  type AccessTokenPayload,
} from "./auth.service.js";

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
}
