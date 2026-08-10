import { randomInt } from "node:crypto";

/**
 * Alfabeto sem caracteres ambíguos (0/O, 1/I/L, 2/Z, 5/S, 8/B): o código é lido
 * de uma tela e digitado à mão no tablet, e um "0" confundido com "O" vira
 * chamado de suporte.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
const CODE_LENGTH = 8;

/**
 * randomInt (CSPRNG), não Math.random: o código de pareamento autoriza um
 * aparelho a operar caixa, então precisa ser imprevisível.
 * 25^8 ≈ 1,5×10^11 combinações, com validade curta e uso único.
 */
export function generatePairingCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

export const PAIRING_CODE_TTL_MINUTES = 15;
