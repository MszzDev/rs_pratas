import { describe, expect, it } from "vitest";
import {
  generateRefreshToken,
  hashRefreshToken,
  parseDuration,
} from "../../src/core/security/token.service.js";

describe("parseDuration", () => {
  it("converte as unidades suportadas", () => {
    expect(parseDuration("45s")).toBe(45_000);
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("30d")).toBe(2_592_000_000);
  });

  it("rejeita formato inválido em vez de assumir um padrão silencioso", () => {
    expect(() => parseDuration("15")).toThrow();
    expect(() => parseDuration("15x")).toThrow();
    expect(() => parseDuration("")).toThrow();
  });
});

describe("refresh token", () => {
  it("gera tokens únicos com 256 bits de entropia", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(500);

    // base64url de 32 bytes = 43 caracteres
    expect(generateRefreshToken()).toHaveLength(43);
  });

  it("produz hash determinístico e diferente do token em claro", () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("gera hashes distintos para tokens distintos", () => {
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(
      hashRefreshToken(generateRefreshToken()),
    );
  });
});
