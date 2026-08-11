import { describe, expect, it } from "vitest";
import {
  evaluateTolerance,
  minutesOfDayInTimezone,
  parseTimeOfDay,
  weekdayInTimezone,
} from "../../src/modules/timeclock/tolerance.js";
import { suggestNextEventType } from "../../src/modules/timeclock/timeclock.service.js";

describe("parseTimeOfDay", () => {
  it("converte HH:mm em minutos desde a meia-noite", () => {
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("08:30")).toBe(510);
    expect(parseTimeOfDay("23:59")).toBe(1439);
  });
});

describe("evaluateTolerance", () => {
  const tolerance = 10;

  it("marca no horário exato como dentro da tolerância", () => {
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("08:00"),
      expectedMinutes: parseTimeOfDay("08:00"),
      toleranceMinutes: tolerance,
    });

    expect(result.isWithinTolerance).toBe(true);
    expect(result.minutesLate).toBe(0);
  });

  it("chegar adiantado nunca conta como atraso", () => {
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("07:45"),
      expectedMinutes: parseTimeOfDay("08:00"),
      toleranceMinutes: tolerance,
    });

    expect(result.isWithinTolerance).toBe(true);
    expect(result.minutesLate).toBe(0);
  });

  it("atraso dentro da tolerância é aceito, mas contabilizado", () => {
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("08:07"),
      expectedMinutes: parseTimeOfDay("08:00"),
      toleranceMinutes: tolerance,
    });

    expect(result.isWithinTolerance).toBe(true);
    expect(result.minutesLate).toBe(7);
  });

  it("a borda exata da tolerância ainda está dentro", () => {
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("08:10"),
      expectedMinutes: parseTimeOfDay("08:00"),
      toleranceMinutes: tolerance,
    });

    expect(result.isWithinTolerance).toBe(true);
    expect(result.minutesLate).toBe(10);
  });

  it("um minuto além da tolerância já é atraso", () => {
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("08:11"),
      expectedMinutes: parseTimeOfDay("08:00"),
      toleranceMinutes: tolerance,
    });

    expect(result.isWithinTolerance).toBe(false);
    expect(result.minutesLate).toBe(11);
  });

  it("turno que cruza a meia-noite não vira atraso de um dia inteiro", () => {
    // Turno começa 22:00; funcionário bate 22:03.
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("22:03"),
      expectedMinutes: parseTimeOfDay("22:00"),
      toleranceMinutes: tolerance,
    });
    expect(result.minutesLate).toBe(3);

    // Bateu 00:05 num turno que começa 23:55 — atraso de 10 minutos, não de 1435.
    const atravessando = evaluateTolerance({
      actualMinutes: parseTimeOfDay("00:05"),
      expectedMinutes: parseTimeOfDay("23:55"),
      toleranceMinutes: tolerance,
    });
    expect(atravessando.minutesLate).toBe(10);
    expect(atravessando.isWithinTolerance).toBe(true);
  });

  it("adiantado atravessando a meia-noite também não é atraso", () => {
    // Turno começa 00:05; funcionário bate 23:55 do dia anterior.
    const result = evaluateTolerance({
      actualMinutes: parseTimeOfDay("23:55"),
      expectedMinutes: parseTimeOfDay("00:05"),
      toleranceMinutes: tolerance,
    });

    expect(result.minutesLate).toBe(0);
    expect(result.isWithinTolerance).toBe(true);
  });

  it("tolerância zero exige pontualidade exata", () => {
    expect(
      evaluateTolerance({
        actualMinutes: parseTimeOfDay("08:01"),
        expectedMinutes: parseTimeOfDay("08:00"),
        toleranceMinutes: 0,
      }).isWithinTolerance,
    ).toBe(false);
  });
});

describe("fuso da loja", () => {
  it("usa o horário da loja, não o do servidor", () => {
    // 2026-03-10T12:00:00Z = 09:00 em São Paulo (UTC-3).
    const instant = new Date("2026-03-10T12:00:00Z");

    expect(minutesOfDayInTimezone(instant, "America/Sao_Paulo")).toBe(9 * 60);
    expect(minutesOfDayInTimezone(instant, "UTC")).toBe(12 * 60);
  });

  it("resolve o dia da semana no fuso da loja", () => {
    // 2026-03-10T12:00:00Z é uma terça-feira.
    expect(weekdayInTimezone(new Date("2026-03-10T12:00:00Z"), "America/Sao_Paulo")).toBe("TUESDAY");

    // 2026-03-10T01:00:00Z ainda é segunda-feira em São Paulo (22:00 do dia 09).
    expect(weekdayInTimezone(new Date("2026-03-10T01:00:00Z"), "America/Sao_Paulo")).toBe("MONDAY");
  });
});

describe("sugestão do próximo evento", () => {
  it("segue a máquina de estados do turno", () => {
    expect(suggestNextEventType(null)).toBe("CLOCK_IN");
    expect(suggestNextEventType("CLOCK_OUT")).toBe("CLOCK_IN");
    expect(suggestNextEventType("CLOCK_IN")).toBe("BREAK_START");
    expect(suggestNextEventType("BREAK_START")).toBe("BREAK_END");
    expect(suggestNextEventType("BREAK_END")).toBe("BREAK_START");
  });
});
