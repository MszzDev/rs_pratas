import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

/**
 * Cifra simétrica para segredos guardados em repouso.
 *
 * Vale para o segredo de 2FA e para os tokens de integração: os dois são
 * equivalentes a uma credencial viva. Quem tem o segredo do 2FA gera o segundo
 * fator do dono; quem tem o token do Mercado Pago opera pagamentos na conta da
 * loja. Cifrados com uma chave que vive só no ambiente, um dump do banco
 * sozinho não serve para nada.
 *
 * AES-256-GCM porque ele autentica além de cifrar: um valor adulterado no
 * banco falha ao decifrar em vez de devolver lixo que o sistema aceitaria.
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
    throw new Error("Segredo cifrado com formato inválido.");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Mostra só o fim do segredo, para o dono reconhecer qual token está lá sem
 * que o valor inteiro volte para a tela.
 */
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return "••••";
  return `••••${plain.slice(-4)}`;
}
