import { describe, expect, it } from "vitest";
import { moldarEmail } from "../../src/core/email/layout.js";
import { credentialsEmail } from "../../src/core/email/templates.js";

/**
 * O que se testa aqui não é gosto — é o que faz o e-mail chegar inteiro.
 *
 * Aparência de e-mail quebra em silêncio: quem manda vê bonito no próprio
 * cliente, e a cliente recebe um quadrado vazio no lugar da marca ou um
 * leiaute desmontado. Não há erro, não há log, e ninguém descobre.
 */
describe("moldura dos e-mails", () => {
  const html = moldarEmail({
    titulo: "Título",
    saudacao: "Olá.",
    paragrafos: ["Primeiro.", "Segundo."],
    destaques: [{ rotulo: "Matrícula", valor: "RS482103" }],
    empresa: "RS Pratas",
  });

  it("não carrega imagem nenhuma", () => {
    // Hospedada quebra quando o endereço muda; `data:` o Gmail remove. As duas
    // viram um quadrado vazio exatamente no lugar da marca.
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/src=/i);
  });

  it("não depende de <style> no cabeçalho", () => {
    // Boa parte dos clientes de e-mail descarta a folha de estilo. O que não
    // estiver escrito na própria tag não existe para eles.
    expect(html).not.toMatch(/<style/i);
    expect(html).toMatch(/style="/);
  });

  it("escapa o que veio de fora, para um nome não virar marcação", () => {
    const comSinal = moldarEmail({
      titulo: "T",
      paragrafos: ["Móveis & Cia <matriz>"],
      empresa: "RS Pratas",
    });

    expect(comSinal).toContain("M&oacute;veis".replace("&oacute;", "ó"));
    expect(comSinal).toContain("&amp;");
    expect(comSinal).toContain("&lt;matriz&gt;");
    expect(comSinal).not.toContain("<matriz>");
  });
});

describe("os e-mails de verdade", () => {
  const mensagem = credentialsEmail({
    to: "a@b.com",
    name: "Juliana Prado",
    employeeCode: "RS482103",
    temporaryPassword: "SenhaTemp123",
    temporaryPin: "418302",
    companyName: "RS Pratas",
  });

  it("mandam texto puro E a versão visual", () => {
    // O texto é o que sobrevive: legível daqui a dois anos e em qualquer
    // programa. A versão visual acompanha, nunca substitui.
    expect(mensagem.text).toContain("RS482103");
    expect(mensagem.html).toBeTruthy();
  });

  it("repetem a credencial nas duas versões", () => {
    // Se só uma delas trouxer o PIN, metade dos funcionários recebe um e-mail
    // que não serve para entrar — e ninguém saberia qual metade.
    for (const credencial of ["RS482103", "418302", "SenhaTemp123"]) {
      expect(mensagem.text).toContain(credencial);
      expect(mensagem.html).toContain(credencial);
    }
  });
});
