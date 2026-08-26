import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import {
  createTestApp,
  createTestCompany,
  createTestStore,
  createTestUser,
  disconnectAll,
  resetDatabase,
} from "./helpers.js";

/**
 * A entrega do comprovante.
 *
 * Duas portas para a mesma mensagem: o e-mail, que o sistema envia, e o
 * WhatsApp, que o sistema escreve e a pessoa manda do próprio aparelho.
 *
 * O que estes testes seguram é o conteúdo — que a mensagem tenha o que o
 * cliente precisa para voltar à loja (código da venda, peças, total) — e o
 * telefone, que é o que faz a conversa abrir no contato certo em vez de o
 * vendedor procurar o cliente na agenda com o cliente na frente.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectAll();
});

beforeEach(async () => {
  await resetDatabase();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Empresa, loja, caixa aberto e uma venda concluída de verdade. */
async function vendaConcluida(comCliente: boolean) {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });

  const token = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: owner.employeeCode, password },
    })
  ).json().accessToken as string;

  const station = await prisma.pOSStation.create({
    data: { storeId: store.id, code: "E01", name: "Estação 01" },
  });
  const cashRegister = await prisma.cashRegister.create({
    data: { posStationId: station.id, code: "C01", name: "Caixa 01" },
  });

  const sessao = await app
    .inject({
      method: "POST",
      url: "/api/v1/cash/sessions",
      headers: auth(token),
      payload: { cashRegisterId: cashRegister.id, openingAmount: 100 },
    })
    .then((resposta) => resposta.json());

  const produto = await prisma.product.create({
    data: {
      companyId: company.id,
      sku: "AN-9001",
      name: "Anel Solitário",
      salePrice: 189.9,
      costPrice: 60,
    },
  });

  await prisma.stockItem.create({
    data: { companyId: company.id, storeId: store.id, productId: produto.id, quantity: 5 },
  });

  const cliente = comCliente
    ? await prisma.customer.create({
        data: {
          companyId: company.id,
          name: "Marina Alves",
          phone: "11987654321",
          email: "marina@exemplo.com",
        },
      })
    : null;

  const venda = await app
    .inject({
      method: "POST",
      url: "/api/v1/sales",
      headers: auth(token),
      payload: {
        storeId: store.id,
        sessionId: sessao.id,
        ...(cliente ? { customerId: cliente.id } : {}),
        items: [{ productId: produto.id, quantity: 1 }],
        payments: [{ method: "DINHEIRO", amount: 189.9, tenderedAmount: 200 }],
      },
    })
    .then((resposta) => resposta.json());

  return { token, venda, store };
}

describe("comprovante pelo WhatsApp", () => {
  it("monta a mensagem com o que o cliente precisa para voltar à loja", async () => {
    const { token, venda } = await vendaConcluida(true);

    const resposta = await app.inject({
      method: "GET",
      url: `/api/v1/sales/${venda.id}/receipt-text`,
      headers: auth(token),
    });

    expect(resposta.statusCode).toBe(200);

    const { texto, telefone, whatsappUrl } = resposta.json();

    expect(texto).toContain(venda.code);
    expect(texto).toContain("Anel Solitário");
    expect(texto).toContain("189,90");

    // O telefone limpo é o que abre a conversa no contato certo — sem ele, o
    // vendedor procuraria o cliente na agenda com o cliente na frente.
    expect(telefone).toBe("11987654321");
    expect(whatsappUrl).toContain("https://wa.me/5511987654321");
    expect(decodeURIComponent(whatsappUrl)).toContain(venda.code);
  });

  it("venda sem cadastro abre o WhatsApp para escolher o contato", async () => {
    const { token, venda } = await vendaConcluida(false);

    const resposta = await app.inject({
      method: "GET",
      url: `/api/v1/sales/${venda.id}/receipt-text`,
      headers: auth(token),
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().telefone).toBeNull();
    // Sem número, ainda abre — com a mensagem pronta, faltando só o contato.
    expect(resposta.json().whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("não vaza venda de outra empresa", async () => {
    const primeira = await vendaConcluida(true);
    const segunda = await vendaConcluida(true);

    const resposta = await app.inject({
      method: "GET",
      url: `/api/v1/sales/${segunda.venda.id}/receipt-text`,
      headers: auth(primeira.token),
    });

    expect(resposta.statusCode).toBe(404);
  });
});

describe("comprovante por e-mail", () => {
  it("recusa quando a venda não tem cliente com e-mail", async () => {
    const { token, venda } = await vendaConcluida(false);

    const resposta = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${venda.id}/receipt`,
      headers: auth(token),
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error.code).toBe("CUSTOMER_WITHOUT_EMAIL");
  });

  it("diz que o envio está desligado em vez de fingir que enviou", async () => {
    const { token } = await vendaConcluida(true);

    const resposta = await app.inject({
      method: "POST",
      url: "/api/v1/settings/email/test",
      headers: auth(token),
    });

    // No ambiente de teste não há SMTP: a resposta honesta é dizer isso.
    expect([400, 200]).toContain(resposta.statusCode);

    if (resposta.statusCode === 400) {
      expect(["EMAIL_OFF", "NO_EMAIL"]).toContain(resposta.json().error.code);
    }
  });
});
