import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET deve ter ao menos 32 caracteres"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  JWT_ISSUER: z.string().default("rs-pratas-api"),

  REFRESH_TOKEN_PEPPER: z
    .string()
    .min(32, "REFRESH_TOKEN_PEPPER deve ter ao menos 32 caracteres"),

  STEP_UP_TOKEN_TTL: z.string().default("5m"),

  // Limites exigidos pelo próprio argon2 — validar aqui faz o boot falhar com
  // mensagem clara em vez de estourar só na primeira tentativa de hash.
  ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  TOTP_ISSUER: z.string().default("RS Pratas"),
  TOTP_ENCRYPTION_KEY: z.string().min(32, "TOTP_ENCRYPTION_KEY deve ter ao menos 32 caracteres"),

  /** "log" grava o e-mail no log em vez de enviar — proibido em produção. */
  EMAIL_PROVIDER: z.enum(["log", "smtp"]).default("log"),
  EMAIL_FROM: z.string().default("RS Pratas <nao-responda@rspratas.com.br>"),
  APP_LOGIN_URL: z.string().default("http://localhost:5173/login"),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default("1m"),
  /** Teto por IP nos endpoints de login, por minuto (camada separada do bloqueio por usuário). */
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  /** Teto por IP nos desafios de 2FA e step-up — barra força bruta do código de 6 dígitos. */
  TWO_FACTOR_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Configuração de ambiente inválida:");
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
