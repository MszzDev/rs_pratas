import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O deploy declara toda variável obrigatória?
 *
 * Este teste nasceu de uma falha real: `REFRESH_TOKEN_PEPPER` era exigida pelo
 * schema de ambiente e não estava no render.yaml. O processo subia, batia na
 * validação e morria — e de fora isso não parece falta de configuração, parece
 * um serviço que não existe. A mensagem só aparece no log da hospedagem.
 *
 * Lendo os dois arquivos como TEXTO em vez de importar o módulo: importar
 * `env.ts` executa a validação e derrubaria o teste no primeiro `import`,
 * justamente por falta das variáveis que ele quer conferir.
 */

const raiz = join(import.meta.dirname, "..", "..");

function variaveisObrigatorias(): string[] {
  const fonte = readFileSync(join(raiz, "src", "config", "env.ts"), "utf8");

  // Cada entrada do schema: duas colunas de recuo, NOME_EM_CAIXA_ALTA, dois pontos.
  const nomes = [...new Set([...fonte.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!))];

  return nomes.filter((nome) => {
    const inicio = fonte.indexOf(`  ${nome}:`);
    const trecho = fonte.slice(inicio, inicio + 500);

    // A definição vai até a próxima entrada do schema.
    const fim = trecho.search(/\n {2}[A-Z][A-Z0-9_]+:/);
    const definicao = fim > 0 ? trecho.slice(0, fim) : trecho;

    // Com default ou marcada como opcional, a ausência não impede o boot.
    return !/\.default\(/.test(definicao) && !/\.optional\(/.test(definicao);
  });
}

describe("render.yaml cobre o que a API exige para subir", () => {
  const blueprint = readFileSync(join(raiz, "..", "..", "render.yaml"), "utf8");

  it("declara toda variável de ambiente obrigatória", () => {
    const faltando = variaveisObrigatorias().filter(
      (nome) => !blueprint.includes(`key: ${nome}`),
    );

    expect(faltando, `variáveis exigidas pela API e ausentes no render.yaml: ${faltando.join(", ")}`).toEqual([]);
  });

  it("encontra as variáveis obrigatórias — guarda contra a varredura silenciosa", () => {
    // Se a leitura do env.ts parar de casar, a lista vem vazia e o teste acima
    // passa sem conferir nada. Este aqui denuncia esse caso.
    const obrigatorias = variaveisObrigatorias();

    expect(obrigatorias).toContain("DATABASE_URL");
    expect(obrigatorias).toContain("REFRESH_TOKEN_PEPPER");
    expect(obrigatorias.length).toBeGreaterThanOrEqual(4);
  });

  it("gera os segredos em vez de esperar alguém digitá-los", () => {
    for (const segredo of ["JWT_ACCESS_SECRET", "TOTP_ENCRYPTION_KEY", "REFRESH_TOKEN_PEPPER"]) {
      const posicao = blueprint.indexOf(`key: ${segredo}`);
      const seguinte = blueprint.slice(posicao, posicao + 120);

      expect(seguinte, `${segredo} deveria usar generateValue`).toContain("generateValue: true");
    }
  });
});
