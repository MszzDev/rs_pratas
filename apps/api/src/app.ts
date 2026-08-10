import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { registerErrorHandler } from "./core/error-handler.js";

const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-step-up-token']",
  "req.body.password",
  "req.body.newPassword",
  "req.body.tempPassword",
  "req.body.pin",
  "req.body.confirmPin",
  "req.body.totpCode",
  "req.body.refreshToken",
];

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? {
            level: env.LOG_LEVEL,
            transport: { target: "pino-pretty", options: { colorize: true } },
            redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" },
          }
        : {
            level: env.LOG_LEVEL,
            redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" },
          },
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
  });

  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS.length > 0 ? env.CORS_ALLOWED_ORIGINS : false,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });

  registerErrorHandler(app);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok" };
    } catch {
      return reply.status(503).send({ status: "degraded", database: "error" });
    }
  });

  return app;
}
