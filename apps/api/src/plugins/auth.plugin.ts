import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { unauthorized } from "../core/errors.js";
import type { AccessTokenPayload } from "../modules/auth/auth.service.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessTokenPayload;
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
  });
});
