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

/** Empresa com uma loja e um dono já autenticado. */
async function scenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.employeeCode, password);
  return { company, store, owner, token };
}

async function createProduct(
  token: string,
  payload: Record<string, unknown> = {},
): Promise<{ id: string; sku: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/products",
    headers: auth(token),
    payload: {
      sku: "AN-001",
      name: "Anel Solitário",
      costPrice: 40,
      salePrice: 120,
      ...payload,
    },
  });

  return response.json();
}

describe("catálogo", () => {
  it("cria produto simples", async () => {
    const { token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: { sku: "PI-001", name: "Pingente Coração", costPrice: 15, salePrice: 45 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().hasVariations).toBe(false);
  });

  it("recusa preço de venda abaixo do custo", async () => {
    const { token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: { sku: "PI-002", name: "Pingente", costPrice: 80, salePrice: 50 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PRICE_BELOW_COST");
  });

  it("recusa SKU repetido na mesma empresa", async () => {
    const { token } = await scenario();
    await createProduct(token);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: { sku: "AN-001", name: "Outro anel", costPrice: 10, salePrice: 30 },
    });

    expect(response.statusCode).toBe(409);
  });

  it("cria as variações a partir da grade de anéis", async () => {
    const { token } = await scenario();

    const grade = (
      await app.inject({
        method: "POST",
        url: "/api/v1/size-grades",
        headers: auth(token),
        payload: { code: "ANEL", name: "Grade de anéis", sizes: ["14", "16", "18", "20"] },
      })
    ).json();

    const product = await createProduct(token, {
      sku: "AN-100",
      sizeGradeId: grade.id,
      sizes: ["16", "18"],
    });

    const variations = await prisma.productVariation.findMany({
      where: { productId: product.id },
      orderBy: { size: "asc" },
    });

    expect(variations).toHaveLength(2);
    expect(variations.map((v) => v.size)).toEqual(["16", "18"]);
    // O SKU da variação deriva do produto para a etiqueta ser rastreável.
    expect(variations[0]?.sku).toBe("AN-100-16");
  });

  it("recusa tamanho que não existe na grade", async () => {
    const { token } = await scenario();

    const grade = (
      await app.inject({
        method: "POST",
        url: "/api/v1/size-grades",
        headers: auth(token),
        payload: { code: "ANEL", name: "Grade", sizes: ["14", "16"] },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: {
        sku: "AN-200",
        name: "Anel",
        costPrice: 10,
        salePrice: 30,
        sizeGradeId: grade.id,
        sizes: ["16", "99"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("SIZE_OUT_OF_GRADE");
  });

  it("não deixa desativar produto com peça em estoque", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: {
        storeId: store.id,
        productId: product.id,
        quantity: 3,
        reason: "compra do fornecedor",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/products/${product.id}/deactivate`,
      headers: auth(token),
      payload: { reason: "saiu de linha" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("STOCK_REMAINING");
  });

  it("o vendedor não cria produto", async () => {
    const company = await createTestCompany();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    const token = await authenticate(seller.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: { sku: "X-1", name: "Peça", costPrice: 1, salePrice: 2 },
    });

    expect(response.statusCode).toBe(403);
  });

  it("não enxerga produto de outra empresa", async () => {
    const { token } = await scenario();

    const outra = await createTestCompany("Concorrente");
    await prisma.product.create({
      data: { companyId: outra.id, sku: "SEGREDO", name: "Peça da concorrente" },
    });

    const produtos = (await app.inject({ method: "GET", url: "/api/v1/products", headers: auth(token) })).json();

    expect(produtos.every((p: { sku: string }) => p.sku !== "SEGREDO")).toBe(true);
  });
});

describe("estoque", () => {
  it("entrada soma ao saldo e grava o movimento", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: {
        storeId: store.id,
        productId: product.id,
        quantity: 10,
        reason: "compra do fornecedor",
        unitCost: 40,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().quantity).toBe(10);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { storeId: store.id },
    });
    expect(movement.type).toBe("ENTRADA");
    expect(movement.quantityBefore).toBe(0);
    expect(movement.quantityAfter).toBe(10);
  });

  it("o saldo nunca fica negativo", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, quantity: 2, reason: "compra" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/adjustments",
      headers: auth(token),
      payload: {
        storeId: store.id,
        productId: product.id,
        newQuantity: 0,
        reason: "quebrou tudo na limpeza",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().quantity).toBe(0);
  });

  it("o movimento de estoque não pode ser alterado nem apagado", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, quantity: 5, reason: "compra" },
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { storeId: store.id } });

    await expect(
      prisma.stockMovement.update({ where: { id: movement.id }, data: { quantity: 999 } }),
    ).rejects.toThrow();

    await expect(
      prisma.stockMovement.delete({ where: { id: movement.id } }),
    ).rejects.toThrow();

    const stored = await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } });
    expect(stored.quantity).toBe(5);
  });

  it("produto com tamanhos exige dizer qual tamanho está entrando", async () => {
    const { store, token } = await scenario();

    const grade = (
      await app.inject({
        method: "POST",
        url: "/api/v1/size-grades",
        headers: auth(token),
        payload: { code: "ANEL", name: "Grade", sizes: ["16", "18"] },
      })
    ).json();

    const product = await createProduct(token, {
      sku: "AN-300",
      sizeGradeId: grade.id,
      sizes: ["16", "18"],
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, quantity: 1, reason: "compra" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VARIATION_REQUIRED");
  });

  it("não mexe no estoque de loja que não alcança", async () => {
    const company = await createTestCompany();
    const storeA = await createTestStore(company.id, "LA");
    const storeB = await createTestStore(company.id, "LB");

    const { user: owner, password: ownerPassword } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const ownerToken = await authenticate(owner.employeeCode, ownerPassword);
    const product = await createProduct(ownerToken);

    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: storeA.id } });
    const managerToken = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(managerToken),
      payload: { storeId: storeB.id, productId: product.id, quantity: 1, reason: "compra" },
    });

    // 404, não 403: negar sem confirmar que a loja existe.
    expect(response.statusCode).toBe(404);
  });

  it("o desenvolvedor não escreve no estoque", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    const company = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    const { user: dev, password } = await createTestUser({
      companyId: company.companyId,
      role: "DESENVOLVEDOR",
    });
    const devToken = await authenticate(dev.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(devToken),
      payload: { storeId: store.id, productId: product.id, quantity: 1, reason: "teste" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVELOPER_READ_ONLY");
  });
});

describe("transferência entre lojas", () => {
  async function transferScenario() {
    const company = await createTestCompany();
    const origem = await createTestStore(company.id, "LA");
    const destino = await createTestStore(company.id, "LB");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: origem.id, productId: product.id, quantity: 10, reason: "compra" },
    });

    return { company, origem, destino, token, product };
  }

  it("a peça sai da origem ao despachar e só entra no destino ao receber", async () => {
    const { origem, destino, token, product } = await transferScenario();

    const transfer = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/transfers",
        headers: auth(token),
        payload: {
          fromStoreId: origem.id,
          toStoreId: destino.id,
          items: [{ productId: product.id, quantity: 4 }],
        },
      })
    ).json();

    // Rascunho não mexe em saldo nenhum.
    let saldoOrigem = await prisma.stockItem.findFirstOrThrow({ where: { storeId: origem.id } });
    expect(saldoOrigem.quantity).toBe(10);

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/transfers/${transfer.id}/send`,
      headers: auth(token),
    });

    saldoOrigem = await prisma.stockItem.findFirstOrThrow({ where: { storeId: origem.id } });
    expect(saldoOrigem.quantity).toBe(6);

    // Em trânsito: não está em loja nenhuma.
    expect(await prisma.stockItem.findFirst({ where: { storeId: destino.id } })).toBeNull();

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/transfers/${transfer.id}/receive`,
      headers: auth(token),
      payload: {
        counted: [{ itemId: transfer.items[0].id, quantityReceived: 4 }],
      },
    });

    const saldoDestino = await prisma.stockItem.findFirstOrThrow({
      where: { storeId: destino.id },
    });
    expect(saldoDestino.quantity).toBe(4);
  });

  it("chegando menos que o enviado, a divergência é registrada", async () => {
    const { origem, destino, token, product } = await transferScenario();

    const transfer = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/transfers",
        headers: auth(token),
        payload: {
          fromStoreId: origem.id,
          toStoreId: destino.id,
          items: [{ productId: product.id, quantity: 5 }],
        },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/transfers/${transfer.id}/send`,
      headers: auth(token),
    });

    const result = (
      await app.inject({
        method: "POST",
        url: `/api/v1/stock/transfers/${transfer.id}/receive`,
        headers: auth(token),
        payload: { counted: [{ itemId: transfer.items[0].id, quantityReceived: 3 }] },
      })
    ).json();

    expect(result.divergencias).toHaveLength(1);
    expect(result.divergencias[0]).toMatchObject({ enviado: 5, recebido: 3 });

    // As 2 peças que faltaram não entram em lugar nenhum — saíram da origem e
    // não chegaram. É essa lacuna que denuncia a perda.
    const saldoDestino = await prisma.stockItem.findFirstOrThrow({ where: { storeId: destino.id } });
    expect(saldoDestino.quantity).toBe(3);
  });

  it("não transfere mais do que existe na origem", async () => {
    const { origem, destino, token, product } = await transferScenario();

    const transfer = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/transfers",
        headers: auth(token),
        payload: {
          fromStoreId: origem.id,
          toStoreId: destino.id,
          items: [{ productId: product.id, quantity: 50 }],
        },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/stock/transfers/${transfer.id}/send`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INSUFFICIENT_STOCK");

    // A falha não pode ter comido saldo pela metade.
    const saldo = await prisma.stockItem.findFirstOrThrow({ where: { storeId: origem.id } });
    expect(saldo.quantity).toBe(10);
  });

  it("transferência despachada não pode ser cancelada", async () => {
    const { origem, destino, token, product } = await transferScenario();

    const transfer = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/transfers",
        headers: auth(token),
        payload: {
          fromStoreId: origem.id,
          toStoreId: destino.id,
          items: [{ productId: product.id, quantity: 2 }],
        },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/transfers/${transfer.id}/send`,
      headers: auth(token),
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/stock/transfers/${transfer.id}/cancel`,
      headers: auth(token),
      payload: { reason: "desisti" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("TRANSFER_ALREADY_SENT");
  });
});

describe("inventário cego", () => {
  it("quem conta não vê o saldo do sistema", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, quantity: 7, reason: "compra" },
    });

    const inventory = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/inventories",
        headers: auth(token),
        payload: { storeId: store.id },
      })
    ).json();

    const sheet = (
      await app.inject({
        method: "GET",
        url: `/api/v1/stock/inventories/${inventory.id}`,
        headers: auth(token),
      })
    ).json();

    // O número não sai do servidor — esconder só na tela não esconderia nada.
    expect(sheet.items[0].systemQuantity).toBeNull();
    expect(sheet.items[0].name).toBe("Anel Solitário");
  });

  it("fechar ajusta o saldo e registra a diferença como perda", async () => {
    const { store, token, owner } = await scenario();
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, quantity: 7, reason: "compra" },
    });

    const inventory = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/inventories",
        headers: auth(token),
        payload: { storeId: store.id },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/inventories/${inventory.id}/counts`,
      headers: auth(token),
      payload: { productId: product.id, countedQuantity: 5 },
    });

    const result = (
      await app.inject({
        method: "POST",
        url: `/api/v1/stock/inventories/${inventory.id}/close`,
        headers: auth(token),
      })
    ).json();

    expect(result.divergencias[0]).toMatchObject({ sistema: 7, contado: 5, diferenca: -2 });

    const saldo = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(saldo.quantity).toBe(5);

    // A saída fica como PERDA, com nome honesto, e não como "acerto".
    const perda = await prisma.stockMovement.findFirstOrThrow({
      where: { storeId: store.id, type: "PERDA" },
    });
    expect(perda.quantity).toBe(-2);
    expect(perda.userId).toBe(owner.id);
  });

  it("depois de fechado o saldo do sistema aparece na folha", async () => {
    const { store, token } = await scenario();
    const product = await createProduct(token);

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/entries",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, quantity: 4, reason: "compra" },
    });

    const inventory = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/inventories",
        headers: auth(token),
        payload: { storeId: store.id },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/inventories/${inventory.id}/counts`,
      headers: auth(token),
      payload: { productId: product.id, countedQuantity: 4 },
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/inventories/${inventory.id}/close`,
      headers: auth(token),
    });

    const sheet = (
      await app.inject({
        method: "GET",
        url: `/api/v1/stock/inventories/${inventory.id}`,
        headers: auth(token),
      })
    ).json();

    expect(sheet.items[0].systemQuantity).toBe(4);
  });

  it("não abre duas contagens na mesma loja", async () => {
    const { store, token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/inventories",
      headers: auth(token),
      payload: { storeId: store.id },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/inventories",
      headers: auth(token),
      payload: { storeId: store.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVENTORY_ALREADY_OPEN");
  });

  it("o gerente não abre contagem com o saldo à vista", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
    const token = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/stock/inventories",
      headers: auth(token),
      payload: { storeId: store.id, isBlind: false },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("BLIND_INVENTORY_REQUIRED");
  });

  it("quem contou sozinho não encerra a própria contagem", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);

    const { user: owner, password: ownerPassword } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const ownerToken = await authenticate(owner.employeeCode, ownerPassword);
    const product = await createProduct(ownerToken);

    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
    const managerToken = await authenticate(manager.employeeCode, password);

    const inventory = (
      await app.inject({
        method: "POST",
        url: "/api/v1/stock/inventories",
        headers: auth(managerToken),
        payload: { storeId: store.id },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/stock/inventories/${inventory.id}/counts`,
      headers: auth(managerToken),
      payload: { productId: product.id, countedQuantity: 3 },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/stock/inventories/${inventory.id}/close`,
      headers: auth(managerToken),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("COUNTER_CANNOT_CLOSE");
  });
});
