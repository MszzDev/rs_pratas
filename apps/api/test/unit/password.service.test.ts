import { describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "../../src/core/security/password.service.js";

describe("password service (argon2id)", () => {
  it("gera hash no formato argon2id e confere a senha correta", async () => {
    const hash = await hashSecret("senha-super-secreta-123");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("senha-super-secreta-123");
    await expect(verifySecret(hash, "senha-super-secreta-123")).resolves.toBe(true);
  });

  it("rejeita senha incorreta", async () => {
    const hash = await hashSecret("senha-super-secreta-123");
    await expect(verifySecret(hash, "senha-super-secreta-124")).resolves.toBe(false);
  });

  it("usa salt aleatório — a mesma senha nunca gera o mesmo hash", async () => {
    const [a, b] = await Promise.all([hashSecret("mesma-senha-aqui"), hashSecret("mesma-senha-aqui")]);
    expect(a).not.toBe(b);
  });

  it("não lança exceção com hash corrompido, apenas não confere", async () => {
    await expect(verifySecret("nao-e-um-hash-valido", "qualquer")).resolves.toBe(false);
  });

  it("funciona com PIN numérico curto", async () => {
    const hash = await hashSecret("4821");
    await expect(verifySecret(hash, "4821")).resolves.toBe(true);
    await expect(verifySecret(hash, "4822")).resolves.toBe(false);
  });
});
