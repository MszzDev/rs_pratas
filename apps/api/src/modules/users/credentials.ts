import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "../../db/prisma.js";

const EMPLOYEE_CODE_PREFIX = "RS";
const EMPLOYEE_CODE_DIGITS = 6;
const MAX_ATTEMPTS = 10;

/**
 * Gera a matrícula no formato RS + 6 dígitos (ex.: RS482103).
 *
 * O número é aleatório, e não sequencial, por dois motivos: uma matrícula
 * sequencial revela quantos funcionários a empresa tem e a ordem de admissão,
 * e — mais importante aqui — a matrícula é metade da credencial no login por
 * PIN do tablet. Sequencial tornaria trivial enumerar matrículas válidas e
 * concentrar tentativas de PIN nelas.
 */
export async function generateEmployeeCode(companyId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const digits = String(randomInt(10 ** EMPLOYEE_CODE_DIGITS)).padStart(EMPLOYEE_CODE_DIGITS, "0");
    const candidate = `${EMPLOYEE_CODE_PREFIX}${digits}`;

    const taken = await prisma.user.findFirst({
      where: { companyId, employeeCode: candidate },
      select: { id: true },
    });

    if (!taken) {
      return candidate;
    }
  }

  throw new Error("Não foi possível gerar uma matrícula única. Tente novamente.");
}

/**
 * Senha temporária de alta entropia. Não precisa ser memorizável: ela viaja por
 * e-mail e é trocada no primeiro acesso, antes de qualquer outra ação.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url").slice(0, 16);
}
