import { describe, expect, it } from "vitest";
import { separarRemetente } from "../../src/core/email/brevo.provider.js";

/**
 * `MAIL_FROM` é escrito uma vez, no painel da hospedagem, no formato do SMTP:
 * "RS Pratas <loja@exemplo.com>". A API do Brevo quer nome e endereço
 * separados, e é aqui que a conversão acontece.
 *
 * Errar isto falha em silêncio da pior forma: o Brevo recusa um remetente que
 * "não existe" e o dono vai conferir a chave, o domínio, a verificação — tudo
 * menos o espaço a mais dentro do sinal de menor.
 */
describe("separarRemetente", () => {
  it("separa nome e endereço do formato do SMTP", () => {
    expect(separarRemetente("RS Pratas <loja@exemplo.com>")).toEqual({
      nome: "RS Pratas",
      endereco: "loja@exemplo.com",
    });
  });

  it("aceita só o endereço, sem nome", () => {
    expect(separarRemetente("loja@exemplo.com")).toEqual({
      nome: "loja@exemplo.com",
      endereco: "loja@exemplo.com",
    });
  });

  it("ignora o espaço em volta — é onde a digitação erra", () => {
    expect(separarRemetente("  RS Pratas  <  loja@exemplo.com  >  ")).toEqual({
      nome: "RS Pratas",
      endereco: "loja@exemplo.com",
    });
  });

  it("nome vazio entre aspas vira o próprio endereço", () => {
    // O Brevo recusa remetente sem nome. Repetir o endereço é feio e entrega;
    // mandar vazio não entrega.
    expect(separarRemetente("<loja@exemplo.com>")).toEqual({
      nome: "loja@exemplo.com",
      endereco: "loja@exemplo.com",
    });
  });
});
