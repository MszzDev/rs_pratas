import { describe, expect, it } from "vitest";
// A regra de PIN fraco mora no pacote compartilhado: o tablet precisa avisar
// enquanto a pessoa digita, e o servidor precisa recusar de qualquer jeito. Uma
// cópia em cada lado divergiria, e a tela aceitaria um PIN que a API nega.
import { isWeakPin } from "@rs-pratas/shared";

describe("isWeakPin", () => {
  it("rejeita dígitos repetidos", () => {
    expect(isWeakPin("1111")).toBe(true);
    expect(isWeakPin("0000")).toBe(true);
    expect(isWeakPin("999999")).toBe(true);
  });

  it("rejeita sequências crescentes e decrescentes", () => {
    expect(isWeakPin("1234")).toBe(true);
    expect(isWeakPin("4321")).toBe(true);
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("654321")).toBe(true);
  });

  it("aceita PINs sem padrão óbvio", () => {
    expect(isWeakPin("4821")).toBe(false);
    expect(isWeakPin("9174")).toBe(false);
    expect(isWeakPin("305182")).toBe(false);
  });

  it("não confunde sequência parcial com sequência completa", () => {
    // Começa em sequência mas quebra no fim — não é padrão previsível.
    expect(isWeakPin("1239")).toBe(false);
  });
});
