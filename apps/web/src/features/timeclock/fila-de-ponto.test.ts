import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import {
  enviarMarcacoesPendentes,
  guardarMarcacao,
  marcacoesPendentes,
} from "./fila-de-ponto";

/**
 * O que se testa aqui é o registro de jornada de uma pessoa.
 *
 * Errar custa caro e custa devagar: a marcação some, ninguém percebe no dia, e
 * a falta só aparece no fechamento do mês — quando não há mais como saber que
 * horas ela chegou.
 */

/**
 * Um `localStorage` de mentira.
 *
 * Os testes rodam em Node, sem DOM. Acrescentar o jsdom só por causa deste
 * arquivo pesaria em todo build do servidor — e o que a fila usa do
 * armazenamento são três métodos.
 */
const guardado = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (chave: string) => guardado.get(chave) ?? null,
  setItem: (chave: string, valor: string) => void guardado.set(chave, valor),
  removeItem: (chave: string) => void guardado.delete(chave),
  clear: () => guardado.clear(),
});

vi.mock("@/lib/api-client", async () => {
  const real = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");

  return {
    ...real,
    apiFetch: vi.fn(),
  };
});

const { apiFetch } = await import("@/lib/api-client");
const enviar = vi.mocked(apiFetch);

beforeEach(() => {
  localStorage.clear();
  enviar.mockReset();
});

describe("fila de marcações de ponto", () => {
  it("guarda a marcação com o horário em que a pessoa apertou", () => {
    const antes = Date.now();
    const guardada = guardarMarcacao({ type: "CLOCK_IN", deviceId: "tablet-1" });
    const depois = Date.now();

    // O horário do aparelho viaja junto porque o servidor carimba o dele na
    // chegada. Numa marcação represada por três horas, uma entrada das 8h
    // chegaria como 11h e viraria atraso de quem chegou no horário.
    const registrado = new Date(guardada.registradoEm).getTime();
    expect(registrado).toBeGreaterThanOrEqual(antes);
    expect(registrado).toBeLessThanOrEqual(depois);

    expect(marcacoesPendentes()).toHaveLength(1);
  });

  it("entrega em ordem, uma de cada vez", async () => {
    guardarMarcacao({ type: "CLOCK_IN", deviceId: "t" });
    guardarMarcacao({ type: "BREAK_START", deviceId: "t" });
    guardarMarcacao({ type: "BREAK_END", deviceId: "t" });

    enviar.mockResolvedValue({});

    const resultado = await enviarMarcacoesPendentes();

    expect(resultado).toEqual({ enviadas: 3, restantes: 0 });
    expect(marcacoesPendentes()).toHaveLength(0);

    // A ordem é o que a máquina de estado do ponto exige: a volta do intervalo
    // não pode chegar antes do início dele.
    const tipos = enviar.mock.calls.map(
      (chamada) => (chamada[1] as { body: { type: string } }).body.type,
    );
    expect(tipos).toEqual(["CLOCK_IN", "BREAK_START", "BREAK_END"]);
  });

  it("mantém na fila quando é falha de rede", async () => {
    guardarMarcacao({ type: "CLOCK_IN", deviceId: "t" });
    enviar.mockRejectedValue(new TypeError("Failed to fetch"));

    const resultado = await enviarMarcacoesPendentes();

    expect(resultado).toEqual({ enviadas: 0, restantes: 1 });
    expect(marcacoesPendentes()).toHaveLength(1);
  });

  it("para na primeira falha de rede, sem gastar as seguintes", async () => {
    guardarMarcacao({ type: "CLOCK_IN", deviceId: "t" });
    guardarMarcacao({ type: "CLOCK_OUT", deviceId: "t" });

    enviar.mockRejectedValue(new TypeError("Failed to fetch"));
    await enviarMarcacoesPendentes();

    // Uma tentativa só: sem rede não adianta insistir nas outras, e a ordem
    // precisa ser preservada de qualquer forma.
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(marcacoesPendentes()).toHaveLength(2);
  });

  it("descarta a que o servidor recusou, para não travar a fila", async () => {
    guardarMarcacao({ type: "CLOCK_OUT", deviceId: "t" });
    guardarMarcacao({ type: "CLOCK_IN", deviceId: "t" });

    // A primeira é inválida — saída sem entrada. Se ficasse na fila para
    // sempre, ela seguraria todas as seguintes, e a pessoa nunca saberia.
    enviar.mockRejectedValueOnce(new ApiError(400, "INVALID_SEQUENCE", "Sequência inválida."));
    enviar.mockResolvedValueOnce({});

    const resultado = await enviarMarcacoesPendentes();

    expect(resultado).toEqual({ enviadas: 1, restantes: 0 });
    expect(marcacoesPendentes()).toHaveLength(0);
  });
});
