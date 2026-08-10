import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

/**
 * Refresh token: 256 bits de aleatoriedade criptográfica. Como já tem entropia
 * máxima, guardá-lo com Argon2 só gastaria CPU sem ganho — SHA-256 com pepper
 * basta. Argon2id fica reservado para segredos de baixa entropia (senha, PIN),
 * que é onde o custo alto realmente protege contra força bruta offline.
 *
 * O pepper vive só no ambiente (nunca no banco): um dump do banco sozinho não
 * permite reconstruir os tokens.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(`${token}${env.REFRESH_TOKEN_PEPPER}`).digest("hex");
}

/** Converte "15m", "30d", "1h", "45s" em milissegundos. */
export function parseDuration(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Duração inválida: "${duration}". Use por exemplo 15m, 1h, 30d.`);
  }

  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";

  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return value * multipliers[unit];
}
