import { describe, expect, it } from "vitest";
import { allowedNextTypes, workedMinutes } from "@rs-pratas/shared";

const em = (hora: string) => new Date(`2026-08-20T${hora}:00.000Z`);

describe("horas trabalhadas no dia", () => {
  it("conta da entrada até a saída", () => {
    const total = workedMinutes(
      [
        { type: "CLOCK_IN", timestamp: em("09:00") },
        { type: "CLOCK_OUT", timestamp: em("18:00") },
      ],
      em("20:00"),
    );

    expect(total).toBe(9 * 60);
  });

  it("desconta o intervalo", () => {
    const total = workedMinutes(
      [
        { type: "CLOCK_IN", timestamp: em("09:00") },
        { type: "BREAK_START", timestamp: em("12:00") },
        { type: "BREAK_END", timestamp: em("13:00") },
        { type: "CLOCK_OUT", timestamp: em("18:00") },
      ],
      em("20:00"),
    );

    expect(total).toBe(8 * 60);
  });

  it("conta o turno ainda aberto até agora", () => {
    const total = workedMinutes([{ type: "CLOCK_IN", timestamp: em("09:00") }], em("11:30"));

    expect(total).toBe(150);
  });

  it("não conta o tempo parado dentro do intervalo em aberto", () => {
    const total = workedMinutes(
      [
        { type: "CLOCK_IN", timestamp: em("09:00") },
        { type: "BREAK_START", timestamp: em("12:00") },
      ],
      em("14:00"),
    );

    // Três horas antes do intervalo. As duas horas de almoço não entram.
    expect(total).toBe(3 * 60);
  });

  it("marcação fora de ordem não soma o mesmo trecho duas vezes", () => {
    const total = workedMinutes(
      [
        { type: "CLOCK_IN", timestamp: em("09:00") },
        { type: "CLOCK_IN", timestamp: em("10:00") },
        { type: "CLOCK_OUT", timestamp: em("11:00") },
      ],
      em("12:00"),
    );

    // Da última entrada até a saída — e não 2h + 1h.
    expect(total).toBe(60);
  });

  it("dia sem marcação nenhuma dá zero", () => {
    expect(workedMinutes([], em("12:00"))).toBe(0);
  });

  it("ordena antes de contar — a lista pode chegar embaralhada", () => {
    const total = workedMinutes(
      [
        { type: "CLOCK_OUT", timestamp: em("18:00") },
        { type: "CLOCK_IN", timestamp: em("09:00") },
      ],
      em("20:00"),
    );

    expect(total).toBe(9 * 60);
  });
});

describe("o que faz sentido bater agora", () => {
  it("quem não bateu nada só pode entrar", () => {
    expect(allowedNextTypes(null)).toEqual(["CLOCK_IN"]);
  });

  it("quem já entrou não entra de novo", () => {
    expect(allowedNextTypes("CLOCK_IN")).not.toContain("CLOCK_IN");
    expect(allowedNextTypes("CLOCK_IN")).toEqual(["BREAK_START", "CLOCK_OUT"]);
  });

  it("no intervalo, só a volta", () => {
    expect(allowedNextTypes("BREAK_START")).toEqual(["BREAK_END"]);
  });

  it("depois de voltar do intervalo dá para sair ou pausar de novo", () => {
    expect(allowedNextTypes("BREAK_END")).toEqual(["BREAK_START", "CLOCK_OUT"]);
  });

  it("quem saiu recomeça pela entrada", () => {
    expect(allowedNextTypes("CLOCK_OUT")).toEqual(["CLOCK_IN"]);
  });
});
