import { randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { env } from "../../config/env.js";

/**
 * O segredo TOTP e equivalente a segunda credencial do dono: vazou o segredo,
 * vazou o segundo fator. A cifra em repouso vive em core/security/crypto.ts,
 * compartilhada com os tokens de integracao — sao o mesmo problema.
 */
export { decryptSecret, encryptSecret } from "./crypto.js";

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
}

/**
 * SHA1 / 6 dígitos / 30s: não é a configuração mais forte no papel, mas é a que
 * o Microsoft Authenticator e o Google Authenticator realmente suportam. Um
 * segundo fator que o app do usuário não consegue ler não protege ninguém.
 */
export function createTotpSetup(accountLabel: string): TotpSetup {
  const secret = new Secret({ size: 20 });

  const totp = new TOTP({
    issuer: env.TOTP_ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  return { secret: secret.base32, otpauthUrl: totp.toString() };
}

function buildTotp(secretBase32: string, accountLabel: string): TOTP {
  return new TOTP({
    issuer: env.TOTP_ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

export interface TotpVerification {
  valid: boolean;
  /** Janela usada, guardada para impedir replay do mesmo código. */
  step: number | null;
}

/**
 * Aceita ±1 janela (30s) para tolerar relógio dessincronizado, e devolve o step
 * usado. O chamador precisa recusar um step já consumido: sem isso, um código
 * interceptado continua válido pelos segundos restantes da janela.
 */
export function verifyTotp(params: {
  secretBase32: string;
  accountLabel: string;
  code: string;
}): TotpVerification {
  const totp = buildTotp(params.secretBase32, params.accountLabel);
  const delta = totp.validate({ token: params.code, window: 1 });

  if (delta === null) {
    return { valid: false, step: null };
  }

  const currentStep = Math.floor(Date.now() / 1000 / 30);
  return { valid: true, step: currentStep + delta };
}

/** Códigos de recuperação: mostrados uma única vez, guardados como hash. */
export function generateRecoveryCodes(quantity = 10): string[] {
  return Array.from({ length: quantity }, () =>
    randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"),
  );
}
