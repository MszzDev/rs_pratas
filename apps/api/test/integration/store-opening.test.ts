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

/** Loja FECHADA com um tablet pareado — o cenário do começo do expediente. */
async function scenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id, "L01", false);

  const station = await prisma.pOSStation.create({
    data: { storeId: store.id, code: "E01", name: "Estação" },
  });
  const cashRegister = await prisma.cashRegister.create({
    data: { posStationId: station.id, code: "C01", name: "Caixa" },
  });
  const device = await prisma.device.create({
    data: {
      cashRegisterId: cashRegister.id,
      companyId: company.id,
      storeId: store.id,
      name: "Tablet",
      status: "ACTIVE",
      deviceUuid: "tablet-teste-01",
    },
  });

  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.employeeCode, password);

  return { company, store, station, cashRegister, device, owner, token };
}

describe("abertura de loja", () => {
  it("a loja abre sozinha quando alguém entra por PIN no tablet dela", async () => {
    const { company, store, device } = await scenario();

    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
      pin: "246810",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    expect((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).isOpen).toBe(false);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/pin",
      payload: { deviceId: device.id, employeeCode: seller.employeeCode, pin: "246810" },
    });

    expect(response.statusCode).toBe(200);

    const reaberta = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(reaberta.isOpen).toBe(true);
    expect(reaberta.openedById).toBe(seller.id);
    // Guardar o tablet distingue "abriu sozinha" de "alguém abriu na mão".
    expect(reaberta.openedByDeviceId).toBe(device.id);

    void password;
  });

  it("o dono abre e fecha a loja de onde estiver", async () => {
    const { store, token } = await scenario();

    const abrir = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/open`,
      headers: auth(token),
      payload: {},
    });
    expect(abrir.statusCode).toBe(200);
    expect(abrir.json().isOpen).toBe(true);
    // Aberta na mão não tem tablet associado.
    expect(abrir.json().openedByDeviceId).toBeNull();

    const fechar = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/close`,
      headers: auth(token),
      payload: { reason: "fim do expediente" },
    });
    expect(fechar.statusCode).toBe(200);
    expect(fechar.json().isOpen).toBe(false);
  });

  it("não abre caixa com a loja fechada", async () => {
    const { cashRegister, token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash/sessions",
      headers: auth(token),
      payload: { cashRegisterId: cashRegister.id, openingAmount: 100 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STORE_CLOSED");
  });

  it("fechar o último caixa fecha a loja junto", async () => {
    const { store, cashRegister, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/open`,
      headers: auth(token),
      payload: {},
    });

    const session = (
      await app.inject({
        method: "POST",
        url: "/api/v1/cash/sessions",
        headers: auth(token),
        payload: { cashRegisterId: cashRegister.id, openingAmount: 100 },
      })
    ).json();

    const result = (
      await app.inject({
        method: "POST",
        url: `/api/v1/cash/sessions/${session.id}/close`,
        headers: auth(token),
        payload: { countedAmount: 100 },
      })
    ).json();

    expect(result.lojaFechada).toBe(true);

    const fechada = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(fechada.isOpen).toBe(false);
  });

  it("não fecha a loja com caixa ainda aberto", async () => {
    const { store, cashRegister, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/open`,
      headers: auth(token),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/cash/sessions",
      headers: auth(token),
      payload: { cashRegisterId: cashRegister.id, openingAmount: 100 },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/close`,
      headers: auth(token),
      payload: { reason: "quero fechar" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CASH_STILL_OPEN");
  });

  it("o painel da rede mostra o estado de cada loja", async () => {
    const { company, store, token } = await scenario();
    await createTestStore(company.id, "L02", false);

    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/open`,
      headers: auth(token),
      payload: {},
    });

    const status = (
      await app.inject({
        method: "GET",
        url: "/api/v1/stores/network-status",
        headers: auth(token),
      })
    ).json();

    expect(status).toHaveLength(2);
    expect(status.filter((row: { isOpen: boolean }) => row.isOpen)).toHaveLength(1);
  });

  it("caixa aberto desde ontem aparece na lista de pendentes", async () => {
    const { store, cashRegister, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/open`,
      headers: auth(token),
      payload: {},
    });

    const session = (
      await app.inject({
        method: "POST",
        url: "/api/v1/cash/sessions",
        headers: auth(token),
        payload: { cashRegisterId: cashRegister.id, openingAmount: 50 },
      })
    ).json();

    // Empurra a abertura para ontem.
    await prisma.cashSession.update({
      where: { id: session.id },
      data: { openedAt: new Date(Date.now() - 2 * 86_400_000) },
    });

    const overdue = (
      await app.inject({
        method: "GET",
        url: "/api/v1/cash/sessions/overdue",
        headers: auth(token),
      })
    ).json();

    expect(overdue).toHaveLength(1);
    expect(overdue[0].diasEmAberto).toBeGreaterThanOrEqual(1);
  });
});

describe("remoções", () => {
  it("categoria sem produto é apagada; com produto é desativada e os produtos ficam sem categoria", async () => {
    const { company, token } = await scenario();

    const vazia = (
      await app.inject({
        method: "POST",
        url: "/api/v1/categories",
        headers: auth(token),
        payload: { code: "VAZIA", name: "Sem produtos" },
      })
    ).json();

    const usada = (
      await app.inject({
        method: "POST",
        url: "/api/v1/categories",
        headers: auth(token),
        payload: { code: "USADA", name: "Com produtos" },
      })
    ).json();

    const produto = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: { sku: "AN-1", name: "Anel", costPrice: 10, salePrice: 30, categoryId: usada.id },
      })
    ).json();

    const apagada = await app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${vazia.id}`,
      headers: auth(token),
      payload: { reason: "criada por engano" },
    });
    expect(apagada.json().removido).toBe("apagado");
    expect(await prisma.category.count({ where: { id: vazia.id } })).toBe(0);

    const desativada = await app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${usada.id}`,
      headers: auth(token),
      payload: { reason: "não usamos mais" },
    });
    expect(desativada.json().removido).toBe("desativado");

    // O produto sobrevive à categoria — perder a peça seria muito pior.
    const sobrevivente = await prisma.product.findUniqueOrThrow({ where: { id: produto.id } });
    expect(sobrevivente.categoryId).toBeNull();

    void company;
  });

  it("cliente com compra é desativado, e o telefone é liberado para recadastro", async () => {
    const { store, cashRegister, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/open`,
      headers: auth(token),
      payload: {},
    });
    const session = (
      await app.inject({
        method: "POST",
        url: "/api/v1/cash/sessions",
        headers: auth(token),
        payload: { cashRegisterId: cashRegister.id, openingAmount: 0 },
      })
    ).json();

    const produto = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: { sku: "AN-2", name: "Anel", costPrice: 10, salePrice: 100 },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: produto.id, quantity: 5, reason: "compra" },
    });

    const cliente = (
      await app.inject({
        method: "POST",
        url: "/api/v1/customers",
        headers: auth(token),
        payload: { name: "Cliente Antigo", phone: "11912345678" },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: "/api/v1/sales",
      headers: auth(token),
      payload: {
        storeId: store.id,
        sessionId: session.id,
        customerId: cliente.id,
        items: [{ productId: produto.id, quantity: 1 }],
        payments: [{ method: "DINHEIRO", amount: 100 }],
      },
    });

    const removido = await app.inject({
      method: "DELETE",
      url: `/api/v1/customers/${cliente.id}`,
      headers: auth(token),
      payload: { reason: "pedido do cliente" },
    });

    expect(removido.json().removido).toBe("desativado");

    // O mesmo telefone volta a poder ser cadastrado.
    const novo = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: auth(token),
      payload: { name: "Cliente Novo", phone: "11912345678" },
    });
    expect(novo.statusCode).toBe(201);
  });

  it("grade em uso não é removida", async () => {
    const { token } = await scenario();

    const grade = (
      await app.inject({
        method: "POST",
        url: "/api/v1/size-grades",
        headers: auth(token),
        payload: { code: "ANEL", name: "Grade", sizes: ["16", "18"] },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: {
        sku: "AN-3",
        name: "Anel",
        costPrice: 10,
        salePrice: 30,
        sizeGradeId: grade.id,
        sizes: ["16"],
      },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/size-grades/${grade.id}`,
      headers: auth(token),
      payload: { reason: "não uso mais" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("GRADE_IN_USE");
  });

  it("toda remoção exige motivo", async () => {
    const { token } = await scenario();

    const categoria = (
      await app.inject({
        method: "POST",
        url: "/api/v1/categories",
        headers: auth(token),
        payload: { code: "X", name: "Teste" },
      })
    ).json();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/categories/${categoria.id}`,
      headers: auth(token),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("etiquetas em lote", () => {
  it("enfileira várias peças de uma vez, cada uma com sua quantidade", async () => {
    const { store, token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: { code: "JOIA", name: "Etiqueta", widthMm: 50, heightMm: 12, isDefault: true },
    });

    const produtos = [];
    for (const sku of ["L-1", "L-2", "L-3"]) {
      const produto = (
        await app.inject({
          method: "POST",
          url: "/api/v1/products",
          headers: auth(token),
          payload: { sku, name: `Peça ${sku}`, costPrice: 10, salePrice: 40 },
        })
      ).json();
      produtos.push(produto);
    }

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/print-jobs/labels/batch",
      headers: auth(token),
      payload: {
        storeId: store.id,
        items: [
          { productId: produtos[0].id, copies: 5 },
          { productId: produtos[1].id, copies: 2 },
          { productId: produtos[2].id, copies: 10 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().enfileirados).toBe(3);
    expect(response.json().etiquetas).toBe(17);

    // Um trabalho por peça, não um bloco só: se a impressora falhar no meio, o
    // que já saiu não é reimpresso.
    const jobs = await prisma.printJob.findMany({ where: { storeId: store.id } });
    expect(jobs).toHaveLength(3);
  });

  it("uma peça com problema não derruba o lote inteiro", async () => {
    const { store, token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: { code: "JOIA", name: "Etiqueta", widthMm: 50, heightMm: 12, isDefault: true },
    });

    const bom = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: { sku: "OK-1", name: "Peça boa", costPrice: 10, salePrice: 40 },
      })
    ).json();

    const grade = (
      await app.inject({
        method: "POST",
        url: "/api/v1/size-grades",
        headers: auth(token),
        payload: { code: "ANEL", name: "Grade", sizes: ["16"] },
      })
    ).json();
    // Produto com tamanho, mandado sem dizer qual — vai falhar sozinho.
    const problemático = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: {
          sku: "PROB-1",
          name: "Anel com tamanho",
          costPrice: 10,
          salePrice: 40,
          sizeGradeId: grade.id,
          sizes: ["16"],
        },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/print-jobs/labels/batch",
      headers: auth(token),
      payload: {
        storeId: store.id,
        items: [
          { productId: bom.id, copies: 3 },
          { productId: problemático.id, copies: 2 },
        ],
      },
    });

    const result = response.json();
    expect(result.enfileirados).toBe(1);
    expect(result.problemas).toHaveLength(1);
    expect(result.problemas[0].motivo).toContain("tamanho");
  });

  it("recusa lote grande demais para um rolo", async () => {
    const { store, token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: { code: "JOIA", name: "Etiqueta", widthMm: 50, heightMm: 12, isDefault: true },
    });

    const produto = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: { sku: "M-1", name: "Peça", costPrice: 10, salePrice: 40 },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/print-jobs/labels/batch",
      headers: auth(token),
      payload: {
        storeId: store.id,
        items: Array.from({ length: 6 }, () => ({ productId: produto.id, copies: 100 })),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BATCH_TOO_LARGE");
  });
});
