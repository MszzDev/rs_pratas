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

/** Loja com caixa aberto, produto custando 40 e vendendo a 100, 20 em estoque. */
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
      payload: { sku: "AN-001", name: "Anel", costPrice: 40, salePrice: 100 },
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
      payload: { cashRegisterId: cashRegister.id, openingAmount: 0 },
    })
  ).json();

  return { company, store, owner, token, product, session };
}

async function sell(
  token: string,
  params: { storeId: string; sessionId: string; productId: string; quantity: number; method?: string },
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/sales",
    headers: auth(token),
    payload: {
      storeId: params.storeId,
      sessionId: params.sessionId,
      items: [{ productId: params.productId, quantity: params.quantity }],
      payments: [{ method: params.method ?? "DINHEIRO", amount: 100 * params.quantity }],
    },
  });
}

const wideRange = () => {
  const to = new Date(Date.now() + 86_400_000).toISOString();
  const from = new Date(Date.now() - 86_400_000).toISOString();
  return { from, to };
};

describe("relatório de vendas", () => {
  it("faturamento, custo e margem saem da venda, não de acumulado", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 3 });

    const { from, to } = wideRange();
    const summary = (
      await app.inject({
        method: "GET",
        url: `/api/v1/reports/sales-summary?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(summary.vendas).toBe(1);
    expect(summary.pecas).toBe(3);
    expect(summary.faturamento).toBe("300.00");
    expect(summary.custo).toBe("120.00");
    expect(summary.margem).toBe("180.00");
    expect(summary.margemPercentual).toBe("60.00");
    expect(summary.ticketMedio).toBe("300.00");
  });

  it("venda cancelada sai do faturamento", async () => {
    const { store, session, token, product } = await scenario();

    const sale = (
      await sell(token, {
        storeId: store.id,
        sessionId: session.id,
        productId: product.id,
        quantity: 2,
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/sales/${sale.id}/cancel`,
      headers: auth(token),
      payload: { reason: "cliente desistiu na porta" },
    });

    const { from, to } = wideRange();
    const summary = (
      await app.inject({
        method: "GET",
        url: `/api/v1/reports/sales-summary?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(summary.vendas).toBe(0);
    expect(summary.faturamento).toBe("0.00");
  });

  it("a margem usa o custo congelado, não o custo atual", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 1 });

    // O fornecedor aumenta o preço depois. A margem de ontem não muda.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${product.id}`,
      headers: auth(token),
      payload: { costPrice: 90 },
    });

    const { from, to } = wideRange();
    const summary = (
      await app.inject({
        method: "GET",
        url: `/api/v1/reports/sales-summary?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(summary.custo).toBe("40.00");
    expect(summary.margem).toBe("60.00");
  });

  it("separa o faturamento por forma de pagamento", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 1 });
    await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      productId: product.id,
      quantity: 2,
      method: "PIX",
    });

    const { from, to } = wideRange();
    const breakdown = (
      await app.inject({
        method: "GET",
        url: `/api/v1/reports/payments?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    const pix = breakdown.find((row: { metodo: string }) => row.metodo === "PIX");
    expect(pix.total).toBe("200.00");
  });

  it("o vendedor não abre relatório da loja", async () => {
    const { company } = await scenario();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    const token = await authenticate(seller.employeeCode, password);

    const { from, to } = wideRange();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/reports/sales-summary?from=${from}&to=${to}`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(403);
  });

  it("o relatório de diferenças de caixa mostra o turno que não bateu", async () => {
    const { session, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/close`,
      headers: auth(token),
      payload: { countedAmount: 15, differenceReason: "sobra sem explicação" },
    });

    const { from, to } = wideRange();
    const report = (
      await app.inject({
        method: "GET",
        url: `/api/v1/reports/cash-differences?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(report.turnosComDiferenca).toBe(1);
    expect(report.diferencaAcumulada).toBe("15.00");
    expect(report.turnos[0].motivo).toBe("sobra sem explicação");
  });
});

describe("comissões", () => {
  it("calcula sobre o faturamento pela regra vigente", async () => {
    const { store, session, token, product, owner } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Padrão da rede", percent: 3 },
    });

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 5 });

    const { from, to } = wideRange();
    const result = (
      await app.inject({
        method: "GET",
        url: `/api/v1/commissions?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    const linha = result.vendedores.find((row: { sellerId: string }) => row.sellerId === owner.id);
    expect(linha.faturamento).toBe("500.00");
    // 3% de 500
    expect(linha.comissao).toBe("15.00");
  });

  it("comissão sobre margem não paga pelo que virou desconto", async () => {
    const { store, session, token, product } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Sobre margem", percent: 10, basis: "MARGEM" },
    });

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 1 });

    const { from, to } = wideRange();
    const result = (
      await app.inject({
        method: "GET",
        url: `/api/v1/commissions?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    // Faturou 100, custou 40 → margem 60 → 10% = 6.
    expect(result.vendedores[0].margem).toBe("60.00");
    expect(result.vendedores[0].comissao).toBe("6.00");
  });

  it("abaixo do mínimo não comissiona, e diz por quê", async () => {
    const { store, session, token, product } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Com piso", percent: 5, minimumSalesAmount: 1000 },
    });

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 2 });

    const { from, to } = wideRange();
    const result = (
      await app.inject({
        method: "GET",
        url: `/api/v1/commissions?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(result.vendedores[0].comissao).toBe("0.00");
    expect(result.vendedores[0].observacao).toContain("mínimo");
  });

  it("a regra do vendedor vence a regra da rede", async () => {
    const { store, session, token, product, owner } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Rede", percent: 2 },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Acerto individual", percent: 8, userId: owner.id },
    });

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 1 });

    const { from, to } = wideRange();
    const result = (
      await app.inject({
        method: "GET",
        url: `/api/v1/commissions?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(result.vendedores[0].regra.nome).toBe("Acerto individual");
    expect(result.vendedores[0].comissao).toBe("8.00");
  });

  it("uma regra nova encerra a anterior em vez de sobrescrevê-la", async () => {
    const { company, token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Antiga", percent: 2 },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Nova", percent: 4 },
    });

    const rules = await prisma.commissionRule.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "asc" },
    });

    expect(rules).toHaveLength(2);
    expect(rules[0]?.isActive).toBe(false);
    expect(rules[0]?.effectiveTo).not.toBeNull();
    expect(rules[1]?.isActive).toBe(true);
  });

  it("sem regra cadastrada, avisa em vez de calcular zero em silêncio", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 1 });

    const { from, to } = wideRange();
    const result = (
      await app.inject({
        method: "GET",
        url: `/api/v1/commissions?from=${from}&to=${to}`,
        headers: auth(token),
      })
    ).json();

    expect(result.vendedores[0].regra).toBeNull();
    expect(result.vendedores[0].observacao).toContain("Nenhuma regra");
  });

  it("o gerente não define regra de comissão", async () => {
    const { company, store } = await scenario();

    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
    const token = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/commission-rules",
      headers: auth(token),
      payload: { name: "Minha própria regra", percent: 50 },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("metas", () => {
  it("mostra o realizado calculado das vendas", async () => {
    const { store, session, token, product } = await scenario();

    const periodStart = new Date(Date.now() - 86_400_000).toISOString();
    const periodEnd = new Date(Date.now() + 86_400_000).toISOString();

    await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: auth(token),
      payload: {
        storeId: store.id,
        scope: "LOJA",
        period: "MENSAL",
        periodStart,
        periodEnd,
        targetAmount: 1000,
      },
    });

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 4 });

    const goals = (
      await app.inject({ method: "GET", url: "/api/v1/goals", headers: auth(token) })
    ).json();

    expect(goals[0].realizado).toBe("400.00");
    expect(goals[0].percentual).toBe("40.0");
    expect(goals[0].atingida).toBe(false);
    expect(goals[0].falta).toBe("600.00");
  });

  /**
   * O defeito que isto tranca: removida a loja, a meta dela virava lixo
   * permanente. A verificação de acesso exigia loja VIVA, e a loja não existia
   * mais para autorizar — então a meta ficava na tela, sem realizado nenhum,
   * e o botão de apagar respondia "Loja não encontrada" para sempre.
   *
   * É justamente a meta que mais se quer apagar.
   */
  it("apaga meta de loja que já foi removida", async () => {
    const { store, token } = await scenario();

    const criada = (
      await app.inject({
        method: "POST",
        url: "/api/v1/goals",
        headers: auth(token),
        payload: {
          storeId: store.id,
          scope: "LOJA",
          period: "MENSAL",
          periodStart: new Date(Date.now() - 86_400_000).toISOString(),
          periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
          targetAmount: 18000,
        },
      })
    ).json();

    // A loja sai de cena, como saiu a Loja Centro na vida real.
    await prisma.store.update({
      where: { id: store.id },
      data: { deletedAt: new Date() },
    });

    const resposta = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${criada.id}`,
      headers: auth(token),
      payload: { reason: "loja fechada" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(await prisma.goal.findUnique({ where: { id: criada.id } })).toBeNull();
  });

  /**
   * Uma meta de loja fechada não pode ser batida — a loja não vende mais nada.
   * Ela ficaria em 0% para sempre, somando um alvo inatingível ao painel, ao
   * resultado e à tela de comissões, que leem a mesma lista.
   *
   * Foi o que aconteceu: duas lojas removidas, R$ 36.000,00 de meta pendurados
   * em três telas.
   */
  it("meta de loja removida some da lista", async () => {
    const { store, token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: auth(token),
      payload: {
        storeId: store.id,
        scope: "LOJA",
        period: "MENSAL",
        periodStart: new Date(Date.now() - 86_400_000).toISOString(),
        periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
        targetAmount: 18000,
      },
    });

    const antes = (
      await app.inject({ method: "GET", url: "/api/v1/goals", headers: auth(token) })
    ).json();
    expect(antes).toHaveLength(1);

    await prisma.store.update({
      where: { id: store.id },
      data: { deletedAt: new Date() },
    });

    const depois = (
      await app.inject({ method: "GET", url: "/api/v1/goals", headers: auth(token) })
    ).json();
    expect(depois).toHaveLength(0);
  });

  it("meta batida não mostra falta negativa", async () => {
    const { store, session, token, product } = await scenario();

    const periodStart = new Date(Date.now() - 86_400_000).toISOString();
    const periodEnd = new Date(Date.now() + 86_400_000).toISOString();

    await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: auth(token),
      payload: {
        storeId: store.id,
        scope: "LOJA",
        period: "MENSAL",
        periodStart,
        periodEnd,
        targetAmount: 200,
      },
    });

    await sell(token, { storeId: store.id, sessionId: session.id, productId: product.id, quantity: 5 });

    const goals = (
      await app.inject({ method: "GET", url: "/api/v1/goals", headers: auth(token) })
    ).json();

    expect(goals[0].atingida).toBe(true);
    expect(goals[0].falta).toBe("0.00");
  });

  it("meta de vendedor exige dizer qual vendedor", async () => {
    const { store, token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: auth(token),
      payload: {
        storeId: store.id,
        scope: "VENDEDOR",
        period: "MENSAL",
        periodStart: new Date().toISOString(),
        periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
        targetAmount: 500,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("USER_REQUIRED");
  });

  it("não aceita período invertido", async () => {
    const { store, token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: auth(token),
      payload: {
        storeId: store.id,
        scope: "LOJA",
        period: "MENSAL",
        periodStart: new Date(Date.now() + 86_400_000).toISOString(),
        periodEnd: new Date().toISOString(),
        targetAmount: 500,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PERIOD");
  });
});
