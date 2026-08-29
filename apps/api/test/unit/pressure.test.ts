import { describe, expect, it } from "vitest";
import { escapaDaPressao } from "../../src/core/security/pressure.js";

/**
 * O custo de errar isto não aparece em desenvolvimento.
 *
 * Aparece em produção, de madrugada, como serviço reiniciando em laço: a
 * hospedagem pergunta "está de pé?", recebe 503 de um servidor que está de pé,
 * mata o processo, e a subida seguinte tem a mesma pressão da anterior.
 */
describe("escapaDaPressao", () => {
  it("deixa o health check responder", () => {
    expect(escapaDaPressao({ url: "/health" })).toBe(true);
  });

  it("recusa o resto — é o que impede a fila de crescer até o processo cair", () => {
    expect(escapaDaPressao({ url: "/api/v1/sales" })).toBe(false);
    expect(escapaDaPressao({ url: "/health/ready" })).toBe(false);
  });

  it("ignora a query string, que não muda que rota é", () => {
    expect(escapaDaPressao({ url: "/health?from=render" })).toBe(true);
  });
});
