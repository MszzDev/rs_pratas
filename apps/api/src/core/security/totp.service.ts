import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { env } from "../../config/env.js";

/**
 * O segredo TOTP é equivalente à segunda credencial do dono: vazou o segredo,
 * vazou o segundo fator. Por isso fica cifrado em repouso (AES-256-GCM) com uma
 * chave que vive só no ambiente — um dump do banco, sozinho, não permite gerar
 * códigos válidos.
 */
const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  // Deriva 32 bytes da variável de ambiente, aceitando qualquer comprimento.
  return createHash("sha256").update(env.TOTP_ENCRYPTION_KEY).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Segredo TOTP com formato inválido.");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

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
