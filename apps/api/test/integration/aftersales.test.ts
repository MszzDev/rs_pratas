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

async function authenticate(employeeCode: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: employeeCode, password },
  });
  return response.json().accessToken as string;
}

/** Uma venda concluída de 3 peças a R$ 100, com caixa aberto. */
async function scenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);

  const station = await prisma.pOSStation.create({
    data: { storeId: store.id, code: "E01", name: "Estação" },
  });
  const cashRegister = await prisma.cashRegister.create({
    data: { posStationId: station.id, code: "C01", name: "Caixa" },
  });

  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.employeeCode, password);

  const product = (
    await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: {
        sku: "AN-001",
        name: "Anel",
        costPrice: 40,
        salePrice: 100,
        weightGrams: 2.5,
      },
    })
  ).json();

  await app.inject({
    method: "POST",
    url: "/api/v1/stock/entries",
    headers: auth(token),
    payload: { storeId: store.id, productId: product.id, quantity: 20, reason: "compra" },
  });

  const session = (
    await app.inject({
      method: "POST",
      url: "/api/v1/cash/sessions",
      headers: auth(token),
      payload: { cashRegisterId: cashRegister.id, openingAmount: 1000 },
    })
  ).json();

  const customer = (
    await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: auth(token),
      payload: { name: "Maria Silva", phone: "11988887777" },
    })
  ).json();

  const sale = (
    await app.inject({
      method: "POST",
      url: "/api/v1/sales",
      headers: auth(token),
      payload: {
        storeId: store.id,
        sessionId: session.id,
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 3 }],
        payments: [{ method: "DINHEIRO", amount: 300 }],
      },
    })
  ).json();

  return { company, store, cashRegister, owner, token, product, session, customer, sale };
}

describe("devolução", () => {
  it("devolve a peça ao estoque e tira o dinheiro da gaveta de hoje", async () => {
    const { store, token, session, sale } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "cliente não gostou do tamanho",
        items: [{ saleItemId: sale.items[0].id, quantity: 2 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().refundAmount).toBe("200");

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    // 20 entraram, 3 saíram na venda, 2 voltaram.
    expect(stock.quantity).toBe(19);

    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: { sessionId: session.id, type: "DEVOLUCAO" },
    });
    expect(Number(movement.amount)).toBe(-200);
  });

  it("a venda original não é alterada — a devolução é fato novo", async () => {
    const { token, session, sale } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "arrependimento do cliente",
        items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
      },
    });

    const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stored.status).toBe("CONCLUIDA");
    expect(Number(stored.totalAmount)).toBe(300);
  });

  it("não devolve mais do que foi comprado, somando devoluções anteriores", async () => {
    const { token, session, sale } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "primeira devolução parcial",
        items: [{ saleItemId: sale.items[0].id, quantity: 2 }],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "tentando devolver de novo",
        items: [{ saleItemId: sale.items[0].id, quantity: 2 }],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ALREADY_RETURNED");
  });

  it("peça danificada não volta para a prateleira — entra como perda", async () => {
    const { store, token, session, sale } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "peça chegou torta",
        items: [
          {
            saleItemId: sale.items[0].id,
            quantity: 1,
            returnedToStock: false,
            condition: "aro amassado",
          },
        ],
      },
    });

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    // Não voltou ao saldo: 20 − 3 = 17.
    expect(stock.quantity).toBe(17);

    const perda = await prisma.stockMovement.findFirstOrThrow({
      where: { storeId: store.id, type: "PERDA" },
    });
    expect(perda.reason).toContain("aro amassado");
  });

  it("devolve pelo valor pago, não pelo preço de hoje", async () => {
    const { token, session, sale, product } = await scenario();

    // Preço sobe depois da venda.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${product.id}`,
      headers: auth(token),
      payload: { salePrice: 250 },
    });

    const result = (
      await app.inject({
        method: "POST",
        url: "/api/v1/returns",
        headers: auth(token),
        payload: {
          originalSaleId: sale.id,
          sessionId: session.id,
          type: "DEVOLUCAO",
          reason: "cliente desistiu da compra",
          items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
        },
      })
    ).json();

    expect(result.refundAmount).toBe("100");
  });

  it("na troca o dinheiro não sai da gaveta — vira crédito", async () => {
    const { token, session, sale } = await scenario();

    const result = (
      await app.inject({
        method: "POST",
        url: "/api/v1/returns",
        headers: auth(token),
        payload: {
          originalSaleId: sale.id,
          sessionId: session.id,
          type: "TROCA",
          reason: "vai levar outro modelo",
          items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
        },
      })
    ).json();

    expect(result.creditoParaTroca).toBe("100.00");

    const movements = await prisma.cashMovement.findMany({
      where: { sessionId: session.id, type: "DEVOLUCAO" },
    });
    expect(movements).toHaveLength(0);
  });

  it("o item da devolução não pode ser alterado depois", async () => {
    const { token, session, sale } = await scenario();

    const saleReturn = (
      await app.inject({
        method: "POST",
        url: "/api/v1/returns",
        headers: auth(token),
        payload: {
          originalSaleId: sale.id,
          sessionId: session.id,
          type: "DEVOLUCAO",
          reason: "não serviu no dedo",
          items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
        },
      })
    ).json();

    const item = await prisma.saleReturnItem.findFirstOrThrow({
      where: { returnId: saleReturn.id },
    });

    await expect(
      prisma.saleReturnItem.update({ where: { id: item.id }, data: { refundAmount: 1 } }),
    ).rejects.toThrow();
  });

  it("fora do prazo exige autorização", async () => {
    const { company, store, token, session, sale } = await scenario();

    // Empurra a venda para 60 dias atrás.
    await prisma.sale.update({
      where: { id: sale.id },
      data: { completedAt: new Date(Date.now() - 60 * 86_400_000) },
    });

    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    const sellerToken = await authenticate(seller.employeeCode, password);

    // O vendedor não tem SALE_REFUND por padrão — nem chega na regra de prazo.
    const semPermissao = await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(sellerToken),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "fora do prazo",
        items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
      },
    });
    expect(semPermissao.statusCode).toBe(403);

    // O dono, que tem SALE_REFUND, passa sem precisar de terceiro.
    const comPermissao = await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "aceita excepcionalmente pelo dono",
        items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
      },
    });
    expect(comPermissao.statusCode).toBe(201);
  });

  it("mostra o que ainda pode ser devolvido", async () => {
    const { token, session, sale } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/returns",
      headers: auth(token),
      payload: {
        originalSaleId: sale.id,
        sessionId: session.id,
        type: "DEVOLUCAO",
        reason: "devolveu uma peça",
        items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
      },
    });

    const info = (
      await app.inject({
        method: "GET",
        url: `/api/v1/sales/${sale.id}/returnable`,
        headers: auth(token),
      })
    ).json();

    expect(info.items[0].quantidadeVendida).toBe(3);
    expect(info.items[0].quantidadeDevolvida).toBe(1);
    expect(info.items[0].quantidadeDisponivel).toBe(2);
    expect(info.dentroDoPrazo).toBe(true);
  });
});

describe("garantia", () => {
  it("conta a partir da venda, não da emissão", async () => {
    const { token, sale } = await scenario();

    // A venda foi há 10 dias; a garantia emitida hoje não estica o prazo.
    const dezDiasAtras = new Date(Date.now() - 10 * 86_400_000);
    await prisma.sale.update({ where: { id: sale.id }, data: { completedAt: dezDiasAtras } });

    const warranty = (
      await app.inject({
        method: "POST",
        url: "/api/v1/warranties",
        headers: auth(token),
        payload: { saleItemId: sale.items[0].id, months: 12 },
      })
    ).json();

    const startsAt = new Date(warranty.startsAt);
    expect(startsAt.toDateString()).toBe(dezDiasAtras.toDateString());
  });

  it("uma peça, uma garantia", async () => {
    const { token, sale } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/warranties",
      headers: auth(token),
      payload: { saleItemId: sale.items[0].id, months: 12 },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/warranties",
      headers: auth(token),
      payload: { saleItemId: sale.items[0].id, months: 24 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("WARRANTY_EXISTS");
  });

  it("a consulta diz se está vigente e quantos dias faltam", async () => {
    const { token, sale } = await scenario();

    const warranty = (
      await app.inject({
        method: "POST",
        url: "/api/v1/warranties",
        headers: auth(token),
        payload: { saleItemId: sale.items[0].id, months: 12 },
      })
    ).json();

    const found = (
      await app.inject({
        method: "GET",
        url: `/api/v1/warranties/${warranty.code}`,
        headers: auth(token),
      })
    ).json();

    expect(found.vigente).toBe(true);
    expect(found.diasRestantes).toBeGreaterThan(300);
  });

  it("o acionamento fica registrado mesmo com a garantia vencida", async () => {
    const { token, sale } = await scenario();

    const warranty = (
      await app.inject({
        method: "POST",
        url: "/api/v1/warranties",
        headers: auth(token),
        payload: { saleItemId: sale.items[0].id, months: 1 },
      })
    ).json();

    // O CHECK do banco exige expiresAt > startsAt, então as duas datas voltam:
    // é uma garantia emitida há dois meses que venceu ontem.
    await prisma.warranty.update({
      where: { id: warranty.id },
      data: {
        startsAt: new Date(Date.now() - 60 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });

    const claim = await app.inject({
      method: "POST",
      url: `/api/v1/warranties/${warranty.id}/claims`,
      headers: auth(token),
      payload: { description: "a pedra caiu depois de dois meses" },
    });

    // A recusa precisa ficar documentada; não registrar apaga metade da história.
    expect(claim.statusCode).toBe(201);

    const decision = await app.inject({
      method: "POST",
      url: `/api/v1/warranty-claims/${claim.json().id}/decide`,
      headers: auth(token),
      payload: { approved: false, reason: "garantia vencida há mais de 30 dias" },
    });

    expect(decision.statusCode).toBe(200);
    expect(decision.json().approved).toBe(false);
  });

  it("não decide o mesmo acionamento duas vezes", async () => {
    const { token, sale } = await scenario();

    const warranty = (
      await app.inject({
        method: "POST",
        url: "/api/v1/warranties",
        headers: auth(token),
        payload: { saleItemId: sale.items[0].id, months: 12 },
      })
    ).json();

    const claim = (
      await app.inject({
        method: "POST",
        url: `/api/v1/warranties/${warranty.id}/claims`,
        headers: auth(token),
        payload: { description: "fecho quebrou sozinho" },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/warranty-claims/${claim.id}/decide`,
      headers: auth(token),
      payload: { approved: true, reason: "defeito de fabricação confirmado" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/warranty-claims/${claim.id}/decide`,
      headers: auth(token),
      payload: { approved: false, reason: "mudei de ideia" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ALREADY_DECIDED");
  });
});

describe("certificado de autenticidade", () => {
  it("copia material e peso da peça vendida", async () => {
    const { token, sale } = await scenario();

    const certificate = (
      await app.inject({
        method: "POST",
        url: "/api/v1/certificates",
        headers: auth(token),
        payload: { saleItemId: sale.items[0].id },
      })
    ).json();

    expect(certificate.material).toBe("PRATA_925");
    expect(certificate.weightGrams).toBe("2.5");
    expect(certificate.customerName).toBe("Maria Silva");
  });

  it("segunda via incrementa o mesmo certificado em vez de criar outro", async () => {
    const { company, token, sale } = await scenario();

    const certificate = (
      await app.inject({
        method: "POST",
        url: "/api/v1/certificates",
        headers: auth(token),
        payload: { saleItemId: sale.items[0].id },
      })
    ).json();

    const reissue = (
      await app.inject({
        method: "POST",
        url: `/api/v1/certificates/${certificate.id}/reissue`,
        headers: auth(token),
      })
    ).json();

    expect(reissue.viaNumero).toBe(2);
    expect(reissue.code).toBe(certificate.code);

    // Um só certificado no banco: dois códigos para a mesma peça permitiriam
    // apresentar dois documentos como se fossem duas peças.
    const all = await prisma.certificate.findMany({ where: { companyId: company.id } });
    expect(all).toHaveLength(1);
  });

  it("uma peça, um certificado", async () => {
    const { token, sale } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/certificates",
      headers: auth(token),
      payload: { saleItemId: sale.items[0].id },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/certificates",
      headers: auth(token),
      payload: { saleItemId: sale.items[0].id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CERTIFICATE_EXISTS");
  });
});
