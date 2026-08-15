import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import underPressure from "@fastify/under-pressure";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { redis } from "./db/redis.js";
import { registerErrorHandler } from "./core/error-handler.js";
import { maskMoneyDeep } from "./core/security/money-mask.js";
import { authPlugin } from "./plugins/auth.plugin.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { twoFactorRoutes } from "./modules/auth/two-factor.routes.js";
import { deviceRoutes } from "./modules/devices/devices.routes.js";
import { userRoutes } from "./modules/users/users.routes.js";
import { storeRoutes } from "./modules/stores/stores.routes.js";
import { timeClockRoutes } from "./modules/timeclock/timeclock.routes.js";
import { settingsRoutes } from "./modules/settings/settings.routes.js";
import { documentRoutes } from "./modules/documents/documents.routes.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { terminalRoutes } from "./modules/terminals/terminals.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { stockRoutes } from "./modules/stock/stock.routes.js";
import { customerRoutes } from "./modules/customers/customers.routes.js";
import { cashRoutes } from "./modules/cash/cash.routes.js";
import { saleRoutes } from "./modules/sales/sales.routes.js";
import { labelRoutes } from "./modules/labels/labels.routes.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { afterSalesRoutes } from "./modules/aftersales/aftersales.routes.js";

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
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
  });

  await app.register(sensible);

  // Envio de documentos do funcionário (atestado, comprovante de horas).
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    attachFieldsToBody: false,
  });
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

  /**
   * Sob sobrecarga, recusar rápido é melhor que aceitar e travar.
   *
   * O tablet do PDV tem um usuário esperando na frente do cliente: um 503
   * imediato deixa a tela dizer "tente de novo", enquanto uma requisição
   * pendurada por 30s trava a venda sem explicar nada. Os limites são
   * generosos de propósito — isto é rede de proteção, não controle de vazão.
   */
  await app.register(underPressure, {
    maxEventLoopDelay: 2_000,
    maxHeapUsedBytes: 1_500_000_000,
    retryAfter: 5,
    message: "Servidor sobrecarregado. Tente novamente em alguns segundos.",
  });

  registerErrorHandler(app);

  await app.register(authPlugin);

  /**
   * Mascaramento monetário do perfil DESENVOLVEDOR, no último ponto antes de a
   * resposta sair pela rede. Fica em onSend (e não em cada handler) para que uma
   * rota criada no futuro já nasça coberta, sem depender de alguém lembrar.
   */
  app.addHook("onSend", async (request, _reply, payload) => {
    const role = (request.user as { role?: string } | undefined)?.role;

    if (role !== "DESENVOLVEDOR" || typeof payload !== "string" || payload.length === 0) {
      return payload;
    }

    try {
      return JSON.stringify(maskMoneyDeep(JSON.parse(payload)));
    } catch {
      // Resposta não-JSON não carrega valor monetário estruturado.
      return payload;
    }
  });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(twoFactorRoutes, { prefix: "/api/v1/auth" });
  await app.register(deviceRoutes, { prefix: "/api/v1" });
  await app.register(userRoutes, { prefix: "/api/v1" });
  await app.register(storeRoutes, { prefix: "/api/v1" });
  await app.register(timeClockRoutes, { prefix: "/api/v1" });
  await app.register(settingsRoutes, { prefix: "/api/v1" });
  await app.register(documentRoutes, { prefix: "/api/v1" });
  await app.register(auditRoutes, { prefix: "/api/v1" });
  await app.register(terminalRoutes, { prefix: "/api/v1" });
  await app.register(catalogRoutes, { prefix: "/api/v1" });
  await app.register(stockRoutes, { prefix: "/api/v1" });
  await app.register(customerRoutes, { prefix: "/api/v1" });
  await app.register(cashRoutes, { prefix: "/api/v1" });
  await app.register(saleRoutes, { prefix: "/api/v1" });
  await app.register(labelRoutes, { prefix: "/api/v1" });
  await app.register(reportRoutes, { prefix: "/api/v1" });
  await app.register(afterSalesRoutes, { prefix: "/api/v1" });

  app.get("/health", async () => ({ status: "ok" }));

  /**
   * Prontidão real: consulta banco e Redis de verdade.
   *
   * O Redis é reportado como "degraded" e não derruba a prontidão, porque ele
   * só guarda cache de permissões — sem ele o motor de RBAC cai para consulta
   * direta ao banco e o sistema continua correto, apenas mais lento. Já o banco
   * fora do ar é indisponibilidade real.
   */
  app.get("/health/ready", async (_request, reply) => {
    const [database, cache] = await Promise.all([
      prisma
        .$queryRaw`SELECT 1`.then(() => "ok" as const)
        .catch(() => "error" as const),
      redis
        .ping()
        .then(() => "ok" as const)
        .catch(() => "error" as const),
    ]);

    const body = {
      status: database === "ok" ? (cache === "ok" ? "ok" : "degraded") : "unavailable",
      database,
      cache,
    };

    return reply.status(database === "ok" ? 200 : 503).send(body);
  });

  return app;
}
