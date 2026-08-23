import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATE_URL: z.string().url(),

  /**
   * Redis guarda só o cache de permissões. Sem ele o RBAC cai para consulta
   * direta ao banco: mais lento, igualmente correto. Por isso tem padrão em
   * vez de ser obrigatório — num ambiente de teste dá para subir sem provisionar
   * mais um serviço, e a ausência aparece como "degraded" no /health/ready.
   */
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),

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

  /**
   * Pasta onde ficam os documentos enviados pelos funcionários.
   *
   * Fora da raiz web de propósito: nada aqui é servido estaticamente, o
   * download passa pela API para a permissão ser checada. Precisa entrar na
   * rotina de backup junto com o banco.
   */
  DOCUMENT_STORAGE_DIR: z.string().default("./storage/documents"),

  /**
   * Canal de e-mail. Fica em "log" por padrão: sem SMTP configurado o sistema
   * segue funcionando e a credencial continua aparecendo na tela do dono, que
   * é a entrega garantida. O e-mail é o atalho, não a única via.
   */
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  /** Ex.: smtps://loja%40dominio.com.br:SENHA_DE_APP@smtp.dominio.com.br:465 */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("RS Pratas <nao-responda@rspratas.com.br>"),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),

  /**
   * Confiar no cabeçalho X-Forwarded-For para descobrir o IP do cliente.
   *
   * Fica FALSO por padrão de propósito. Confiar nesse cabeçalho sem um proxy
   * real na frente permite que qualquer um forje o próprio IP a cada
   * requisição — o que anula todo rate limit por IP (login, PIN, TOTP, código
   * de pareamento) e ainda envenena o IP gravado na auditoria.
   *
   * Só ligue quando a API estiver de fato atrás de um proxy que sobrescreve o
   * cabeçalho. Aceita `true`/`false` ou o número de saltos confiáveis, que é a
   * forma mais segura: com "1", apenas o proxy imediato é considerado.
   */
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((value) => {
      if (value === "true") return true;
      if (value === "false") return false;
      const hops = Number(value);
      return Number.isInteger(hops) && hops > 0 ? hops : false;
    }),

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
