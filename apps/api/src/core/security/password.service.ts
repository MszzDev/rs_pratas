import argon2 from "argon2";
import { env } from "../../config/env.js";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
} as const;

/** Hash Argon2id — usado para senha, PIN e códigos de recuperação de 2FA. */
export async function hashSecret(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Hash malformado/corrompido nunca deve derrubar o login — só não confere.
    return false;
  }
}

/**
 * Hash descartável com o mesmo custo de CPU de uma verificação real.
 *
 * Chamado quando o usuário informado não existe (ou não tem senha definida),
 * para que "usuário inexistente" e "senha errada" levem o mesmo tempo. Sem
 * isso, o tempo de resposta vira um oráculo de enumeração de matrículas.
 */
export async function burnVerificationTime(): Promise<void> {
  await argon2.hash("timing-equalizer", ARGON2_OPTIONS);
}
