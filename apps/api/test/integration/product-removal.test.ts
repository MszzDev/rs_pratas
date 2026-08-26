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
 * Tirar uma peça do catálogo.
 *
 * A regra que estes testes seguram é a que separa "cadastro errado" de
 * "história da loja": peça que já foi vendida NUNCA some, porque o item da
 * venda aponta para ela — e sem ela a garantia, a troca e o relatório de
 * margem passariam a apontar para o nada.
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

async function cenario() {
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

  return { company, store, token };
}

async function criarPeca(companyId: string, storeId: string, sku: string, saldo = 3) {
  const produto = await prisma.product.create({
    data: { companyId, sku, name: `Peça ${sku}`, salePrice: 100, costPrice: 40 },
  });

  await prisma.stockItem.create({
    data: { companyId, storeId, productId: produto.id, quantity: saldo },
  });

  return produto;
}

describe("remover peça do catálogo", () => {
  it("peça que nunca vendeu é apagada, com o saldo que estava lançado nela", async () => {
    const { company, store, token } = await cenario();
    const produto = await criarPeca(company.id, store.id, "TESTE-01");

    const resposta = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${produto.id}`,
      headers: auth(token),
      payload: { reason: "cadastro de demonstração" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().removido).toBe("apagado");

    expect(await prisma.product.findUnique({ where: { id: produto.id } })).toBeNull();
    expect(await prisma.stockItem.count({ where: { productId: produto.id } })).toBe(0);
  });

  it("peça que já foi vendida sai do catálogo mas continua no histórico", async () => {
    const { company, store, token } = await cenario();
    const produto = await criarPeca(company.id, store.id, "TESTE-02");

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
        payload: { cashRegisterId: cashRegister.id, openingAmount: 0 },
      })
      .then((r) => r.json());

    const venda = await app
      .inject({
        method: "POST",
        url: "/api/v1/sales",
        headers: auth(token),
        payload: {
          storeId: store.id,
          sessionId: sessao.id,
          items: [{ productId: produto.id, quantity: 1 }],
          payments: [{ method: "DINHEIRO", amount: 100, tenderedAmount: 100 }],
        },
      })
      .then((r) => r.json());

    const resposta = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${produto.id}`,
      headers: auth(token),
      payload: { reason: "saiu de linha" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().removido).toBe("desativado");

    // A peça continua existindo para a venda antiga poder ser explicada.
    const guardado = await prisma.product.findUniqueOrThrow({ where: { id: produto.id } });
    expect(guardado.deletedAt).not.toBeNull();
    expect(guardado.isActive).toBe(false);

    const itens = await prisma.saleItem.findMany({ where: { saleId: venda.id } });
    expect(itens).toHaveLength(1);
    expect(itens[0]?.productId).toBe(produto.id);
  });

  it("recusa remover peça reservada para um cliente", async () => {
    const { company, store, token } = await cenario();
    const produto = await criarPeca(company.id, store.id, "TESTE-03");

    const cliente = await prisma.customer.create({
      data: { companyId: company.id, name: "Cliente", phone: "11999990000" },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/reservations",
      headers: auth(token),
      payload: {
        storeId: store.id,
        customerId: cliente.id,
        productId: produto.id,
        quantity: 1,
      },
    });

    const resposta = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${produto.id}`,
      headers: auth(token),
      payload: { reason: "limpeza" },
    });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error.code).toBe("HAS_RESERVATION");
  });

  it("exige motivo — é o que explica a remoção seis meses depois", async () => {
    const { company, store, token } = await cenario();
    const produto = await criarPeca(company.id, store.id, "TESTE-04");

    const resposta = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${produto.id}`,
      headers: auth(token),
      payload: { reason: "" },
    });

    expect(resposta.statusCode).toBe(400);
  });
});
