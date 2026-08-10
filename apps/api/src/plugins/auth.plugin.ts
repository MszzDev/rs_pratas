import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { unauthorized } from "../core/errors.js";
import type { AccessTokenPayload } from "../modules/auth/auth.service.js";
import type { OnboardingTokenPayload } from "../modules/auth/first-access.service.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /** Sessão normal ou token de propósito único do primeiro acesso. */
    payload: AccessTokenPayload | OnboardingTokenPayload;
    /** Após requireAuth, só um token de sessão real chega aos handlers. */
    user: AccessTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    /** preHandler que exige um access token válido. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      iss: env.JWT_ISSUER,
      expiresIn: env.JWT_ACCESS_TTL,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
    },
  });

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized("UNAUTHENTICATED", "Sessão inválida ou expirada. Entre novamente.");
    }

    // Tokens de propósito único (primeiro acesso) são assinados com o mesmo
    // segredo, mas não carregam sessionId. Sem esta checagem, um token de
    // onboarding — obtido só com a senha temporária — abriria as rotas normais
    // da aplicação.
    const payload = request.user as Partial<AccessTokenPayload> & { scope?: string };

    if (payload.scope || !payload.sessionId) {
      throw unauthorized("UNAUTHENTICATED", "Sessão inválida ou expirada. Entre novamente.");
    }
  });
});
