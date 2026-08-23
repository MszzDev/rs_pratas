import { describe, expect, it } from "vitest";
import { gerarAfd, type AfdParams } from "../../src/modules/timeclock/afd.js";

const BASE: AfdParams = {
  empregador: {
    tipoIdentificador: 1,
    cnpjOuCpf: "12.345.678/0001-95",
    razaoSocial: "RS Pratas Comércio de Joias LTDA",
    identificacaoRep: "REP-P-0001",
  },
  marcacoes: [],
  inicio: new Date("2026-08-01T03:00:00.000Z"),
  fim: new Date("2026-08-31T03:00:00.000Z"),
  geradoEm: new Date("2026-09-01T14:30:45.000Z"),
  timezone: "America/Sao_Paulo",
};

const linhas = (conteudo: string) => conteudo.split("\r\n").filter(Boolean);

describe("AFD — cabeçalho", () => {
  it("abre com NSR zerado e tipo 1", () => {
    const [cabecalho] = linhas(gerarAfd(BASE));

    expect(cabecalho!.slice(0, 9)).toBe("000000000");
    expect(cabecalho![9]).toBe("1");
  });

  it("guarda só os dígitos do CNPJ, preenchendo à esquerda", () => {
    const [cabecalho] = linhas(gerarAfd(BASE));

    expect(cabecalho!.slice(11, 25)).toBe("12345678000195");
  });

  it("tira acento da razão social — o arquivo é lido como ASCII", () => {
    const [cabecalho] = linhas(
      gerarAfd({
        ...BASE,
        empregador: { ...BASE.empregador, razaoSocial: "Joalheria Ação e Coração" },
      }),
    );

    const razao = cabecalho!.slice(37, 187);
    expect(razao.trimEnd()).toBe("JOALHERIA ACAO E CORACAO");
    // Continua ocupando exatamente 150 colunas.
    expect(razao).toHaveLength(150);
  });

  it("grava as datas do período no fuso da loja, em DDMMAAAA", () => {
    const [cabecalho] = linhas(gerarAfd(BASE));

    expect(cabecalho!.slice(204, 212)).toBe("01082026");
    expect(cabecalho!.slice(212, 220)).toBe("31082026");
  });

  it("grava data e hora da geração convertidas para o fuso da loja", () => {
    const [cabecalho] = linhas(gerarAfd(BASE));

    // 01/09 14:30:45 UTC é 01/09 11:30:45 em São Paulo.
    expect(cabecalho!.slice(220, 228)).toBe("01092026");
    expect(cabecalho!.slice(228, 234)).toBe("113045");
  });
});

describe("AFD — marcações", () => {
  const comMarcacoes = (): string =>
    gerarAfd({
      ...BASE,
      marcacoes: [
        {
          nsr: 12n,
          type: "CLOCK_IN",
          timestamp: new Date("2026-08-20T11:03:00.000Z"),
          cpf: "529.982.247-25",
        },
        {
          nsr: 7n,
          type: "CLOCK_OUT",
          timestamp: new Date("2026-08-20T21:07:30.000Z"),
          cpf: "52998224725",
        },
      ],
    });

  it("usa o tipo 7, que é o de REP-P", () => {
    const [, primeira] = linhas(comMarcacoes());

    expect(primeira![9]).toBe("7");
  });

  it("ordena por NSR, não por horário", () => {
    const [, primeira, segunda] = linhas(comMarcacoes());

    // A de NSR 7 tem horário POSTERIOR, e ainda assim vem primeiro: o arquivo
    // prova a sequência de entrada dos registros.
    expect(primeira!.slice(0, 9)).toBe("000000007");
    expect(segunda!.slice(0, 9)).toBe("000000012");
  });

  it("grava o instante em ISO 8601 com o deslocamento do fuso", () => {
    const [, , segunda] = linhas(comMarcacoes());

    // 11:03 UTC = 08:03 em São Paulo, deslocamento -0300.
    expect(segunda!.slice(10, 34)).toBe("2026-08-20T08:03:00-0300");
  });

  it("aceita CPF pontuado e grava só os dígitos", () => {
    const [, , segunda] = linhas(comMarcacoes());

    expect(segunda![34]).toBe("1"); // identificador = CPF
    expect(segunda!.slice(35, 47)).toBe("052998224725");
  });

  it("toda linha de marcação tem o mesmo tamanho", () => {
    const marcacoes = linhas(comMarcacoes()).slice(1, -1);
    const tamanhos = new Set(marcacoes.map((linha) => linha.length));

    expect(tamanhos.size).toBe(1);
  });
});

describe("AFD — trailer", () => {
  it("conta as marcações do tipo 7", () => {
    const conteudo = gerarAfd({
      ...BASE,
      marcacoes: [1, 2, 3].map((n) => ({
        nsr: BigInt(n),
        type: "CLOCK_IN" as const,
        timestamp: new Date("2026-08-20T11:00:00.000Z"),
        cpf: "52998224725",
      })),
    });

    const todas = linhas(conteudo);
    const trailer = todas[todas.length - 1]!;

    expect(trailer.slice(0, 9)).toBe("000000009");
    expect(trailer.slice(45, 54)).toBe("000000003");
    expect(trailer.at(-1)).toBe("9");
  });

  it("arquivo sem nenhuma marcação ainda tem cabeçalho e trailer", () => {
    const todas = linhas(gerarAfd(BASE));

    expect(todas).toHaveLength(2);
    expect(todas[1]!.slice(45, 54)).toBe("000000000");
  });
});

describe("AFD — formato do arquivo", () => {
  it("termina toda linha com CRLF, inclusive a última", () => {
    const conteudo = gerarAfd({
      ...BASE,
      marcacoes: [
        {
          nsr: 1n,
          type: "CLOCK_IN",
          timestamp: new Date("2026-08-20T11:00:00.000Z"),
          cpf: "52998224725",
        },
      ],
    });

    expect(conteudo.endsWith("\r\n")).toBe(true);
    expect(conteudo.split("\r\n").filter(Boolean)).toHaveLength(3);
  });

  it("não deixa escapar caractere fora do ASCII imprimível", () => {
    const conteudo = gerarAfd({
      ...BASE,
      empregador: { ...BASE.empregador, razaoSocial: "Ourivesaria Trindade — Joias & Cia" },
    });

    expect(/[^\x20-\x7E\r\n]/.test(conteudo)).toBe(false);
  });
});
