import { describe, expect, it } from "vitest";
import { formatCpf, isValidCpf, onlyDigits } from "./cpf.js";

describe("CPF", () => {
  it("aceita um CPF válido, com ou sem pontuação", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(isValidCpf("529.982.247-26")).toBe(false);
  });

  it("recusa sequência repetida, que passa na conta mas não é de ninguém", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
  });

  it("recusa tamanho errado", () => {
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });

  it("guarda só os dígitos e exibe pontuado", () => {
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });
});
