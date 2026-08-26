import { describe, expect, it } from "vitest";
import { COLUNAS, Comprovante } from "./escpos";

/**
 * O comprovante é o único pedaço do sistema que ninguém consegue conferir
 * olhando a tela: ou sai certo no papel, ou sai errado na frente do cliente.
 * Estes testes conferem os bytes antes de a impressora conferir.
 */

function bytes(base64: string): number[] {
  return [...atob(base64)].map((caractere) => caractere.charCodeAt(0));
}

/**
 * O texto legível, sem os bytes de inicialização.
 *
 * Todo comprovante começa com cinco bytes de comando (zerar a impressora e
 * escolher a tabela de caracteres). Eles não são texto e não ocupam coluna no
 * papel — contá-los faria a primeira linha parecer maior do que sai impressa.
 */
function texto(base64: string): string {
  return atob(base64).slice(5);
}

describe("Comprovante", () => {
  it("começa zerando a impressora e escolhendo a tabela do português", () => {
    const saida = bytes(new Comprovante().paraBase64());

    // ESC @ (reset) e depois ESC t 2 (CP850).
    expect(saida.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
  });

  it("escreve acentos na tabela da impressora, não em UTF-8", () => {
    const saida = bytes(new Comprovante().linha("coração").paraBase64());

    // Em UTF-8, "ç" e "ã" ocupariam dois bytes cada. Aqui é um byte por letra,
    // nas posições do CP850 — que é como a impressora entende.
    expect(saida).toContain(0x87); // ç
    expect(saida).toContain(0xc6); // ã
    expect(texto(new Comprovante().linha("coração").paraBase64())).not.toContain("Ã");
  });

  it("tira o acento do que não existe na tabela, em vez de imprimir sujeira", () => {
    // "ǎ" não está no CP850. Deve virar "a" — legível — e não um bloco preto.
    const saida = texto(new Comprovante().linha("ǎnel").paraBase64());
    expect(saida).toContain("anel");
  });

  it("troca travessão e aspas curvas por equivalentes que a impressora tem", () => {
    const saida = texto(new Comprovante().linha("Anel — “prata”").paraBase64());
    expect(saida).toContain('Anel - "prata"');
  });

  it("alinha o valor na margem direita", () => {
    const saida = texto(new Comprovante().entreExtremos("TOTAL", "199,90").paraBase64());
    const linha = saida.split("\n").find((l) => l.includes("TOTAL"));

    expect(linha).toHaveLength(COLUNAS);
    expect(linha?.endsWith("199,90")).toBe(true);
  });

  it("desce o valor para a linha de baixo quando os dois não cabem", () => {
    const rotulo = "Pulseira Veneziana Prata 925";
    const saida = texto(new Comprovante().entreExtremos(rotulo, "1.299,90").paraBase64());
    const linhas = saida.split("\n").filter((l) => l.includes(rotulo) || l.includes("1.299,90"));

    expect(linhas).toHaveLength(2);
    expect(linhas[1]?.trimStart()).toBe("1.299,90");
  });

  it("quebra o nome comprido por palavras, sem partir nenhuma", () => {
    const nome = "Pulseira Veneziana Prata 925 com Fecho Reforcado";
    const saida = texto(new Comprovante().paragrafo(nome).paraBase64());

    const linhas = saida.split("\n").filter((l) => l.trim() !== "");

    for (const linha of linhas) {
      expect(linha.length).toBeLessThanOrEqual(COLUNAS);
    }

    // Nenhuma palavra foi cortada no meio.
    expect(linhas.join(" ").split(/\s+/).filter(Boolean)).toEqual(nome.split(" "));
  });

  it("avança o papel antes de cortar, para a lâmina não passar no texto", () => {
    const saida = bytes(new Comprovante().linha("fim").corta().paraBase64());

    // Três quebras de linha seguidas e então GS V B 0 (corte parcial).
    expect(saida.slice(-7)).toEqual([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00]);
  });
});
