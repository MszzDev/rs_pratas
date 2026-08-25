import { describe, expect, it } from "vitest";
import { horarioVazio, resumirHorario, storeHoursSchema } from "./store-hours.js";

const das = (abre: string, fecha: string) => ({ abre, fecha });

describe("resumo do horário da loja", () => {
  it("junta dias seguidos com o mesmo horário", () => {
    const horas = {
      ...horarioVazio(),
      segunda: das("10:00", "19:00"),
      terca: das("10:00", "19:00"),
      quarta: das("10:00", "19:00"),
      quinta: das("10:00", "19:00"),
      sexta: das("10:00", "19:00"),
      sabado: das("10:00", "19:00"),
      domingo: das("10:00", "14:00"),
      feriado: das("10:00", "14:00"),
    };

    expect(resumirHorario(horas)).toBe("Seg–Sáb 10h–19h · Dom 10h–14h · Feriado 10h–14h");
  });

  it("mostra o dia sozinho quando ele não faz sequência", () => {
    const horas = {
      ...horarioVazio(),
      terca: das("10:00", "19:00"),
      quarta: das("10:00", "19:00"),
      sexta: das("09:00", "18:00"),
    };

    expect(resumirHorario(horas)).toBe("Ter–Qua 10h–19h · Sex 9h–18h");
  });

  it("mostra os minutos quando o fechamento não é hora cheia", () => {
    const horas = { ...horarioVazio(), segunda: das("10:00", "18:20") };

    expect(resumirHorario(horas)).toBe("Seg 10h–18h20");
  });

  it("loja sem nenhum dia preenchido não vira linha vazia", () => {
    expect(resumirHorario(horarioVazio())).toBeNull();
    expect(resumirHorario(null)).toBeNull();
  });

  it("recusa fechamento antes da abertura", () => {
    const resultado = storeHoursSchema.safeParse({
      ...horarioVazio(),
      segunda: das("19:00", "10:00"),
    });

    expect(resultado.success).toBe(false);
  });

  it("recusa hora fora do formato", () => {
    const resultado = storeHoursSchema.safeParse({
      ...horarioVazio(),
      segunda: das("10h", "19:00"),
    });

    expect(resultado.success).toBe(false);
  });
});
