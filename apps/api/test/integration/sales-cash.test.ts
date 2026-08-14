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

/**
 * Loja com caixa aberto, um produto e 10 peças em estoque — o mínimo para
 * conseguir vender.
 */
async function scenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);

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
    },
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
    payload: { storeId: store.id, productId: product.id, quantity: 10, reason: "compra" },
  });

  const session = (
    await app.inject({
      method: "POST",
      url: "/api/v1/cash/sessions",
      headers: auth(token),
      payload: { cashRegisterId: cashRegister.id, openingAmount: 100 },
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

  return { company, store, cashRegister, device, owner, token, product, session, customer };
}

const sell = (token: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/v1/sales", headers: auth(token), payload });

describe("venda", () => {
  it("o preço vem do servidor, não do aplicativo", async () => {
    const { store, session, token, product } = await scenario();

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: "DINHEIRO", amount: 100 }],
      // Tentativa de comprar um anel de R$ 100 por R$ 1: os campos de preço
      // simplesmente não existem no contrato, então são ignorados.
      unitPrice: 1,
      totalAmount: 1,
    });

    expect(response.statusCode).toBe(201);
    expect(Number(response.json().totalAmount)).toBe(100);
  });

  it("recusa quando os pagamentos não somam o total", async () => {
    const { store, session, token, product } = await scenario();

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 2 }],
      payments: [{ method: "DINHEIRO", amount: 150 }],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PAYMENT_MISMATCH");
  });

  it("aceita pagamento dividido que soma exatamente o total", async () => {
    const { store, session, token, product } = await scenario();

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 3 }],
      payments: [
        { method: "DINHEIRO", amount: 100 },
        { method: "PIX", amount: 200 },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().payments).toHaveLength(2);
  });

  it("baixa o estoque na mesma transação da venda", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 4 }],
      payments: [{ method: "DINHEIRO", amount: 400 }],
    });

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(stock.quantity).toBe(6);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { storeId: store.id, type: "VENDA" },
    });
    expect(movement.quantity).toBe(-4);
  });

  it("não vende mais peças do que existem, e não deixa rastro parcial", async () => {
    const { store, session, token, product } = await scenario();

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 50 }],
      payments: [{ method: "DINHEIRO", amount: 5000 }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INSUFFICIENT_STOCK");

    // A transação inteira voltou atrás: nem venda gravada, nem saldo mexido.
    expect(await prisma.sale.count()).toBe(0);
    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(stock.quantity).toBe(10);
  });

  it("não vende com o caixa fechado", async () => {
    const { store, session, token, product } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/close`,
      headers: auth(token),
      payload: { countedAmount: 100 },
    });

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: "DINHEIRO", amount: 100 }],
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("SESSION_CLOSED");
  });

  it("cartão exige maquininha vinculada", async () => {
    const { store, session, token, product, device } = await scenario();

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      deviceId: device.id,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: "CREDITO", amount: 100 }],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("TERMINAL_REQUIRED");
  });

  it("recusa maquininha de outro caixa", async () => {
    const { company, store, session, token, product, device } = await scenario();

    const outraLoja = await createTestStore(company.id, "LB");
    const outraStation = await prisma.pOSStation.create({
      data: { storeId: outraLoja.id, code: "E02", name: "Estação B" },
    });
    const outroCaixa = await prisma.cashRegister.create({
      data: { posStationId: outraStation.id, code: "C02", name: "Caixa B" },
    });
    const outroTablet = await prisma.device.create({
      data: {
        cashRegisterId: outroCaixa.id,
        companyId: company.id,
        storeId: outraLoja.id,
        name: "Tablet B",
        status: "ACTIVE",
      },
    });
    const terminalDaOutraLoja = await prisma.paymentTerminal.create({
      data: {
        deviceId: outroTablet.id,
        cashRegisterId: outroCaixa.id,
        posStationId: outraStation.id,
        storeId: outraLoja.id,
        companyId: company.id,
        status: "ACTIVE",
      },
    });

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      deviceId: device.id,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: "CREDITO", amount: 100, terminalId: terminalDaOutraLoja.id }],
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TERMINAL_WRONG_BINDING");
  });

  it("congela nome e preço do item — renomear o produto não reescreve a nota", async () => {
    const { store, session, token, product } = await scenario();

    const sale = (
      await sell(token, {
        storeId: store.id,
        sessionId: session.id,
        items: [{ productId: product.id, quantity: 1 }],
        payments: [{ method: "DINHEIRO", amount: 100 }],
      })
    ).json();

    await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${product.id}`,
      headers: auth(token),
      payload: { name: "Anel renomeado", salePrice: 250 },
    });

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(item.productName).toBe("Anel");
    expect(Number(item.unitPrice)).toBe(100);
  });

  it("o item de venda não pode ser alterado depois", async () => {
    const { store, session, token, product } = await scenario();

    const sale = (
      await sell(token, {
        storeId: store.id,
        sessionId: session.id,
        items: [{ productId: product.id, quantity: 1 }],
        payments: [{ method: "DINHEIRO", amount: 100 }],
      })
    ).json();

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: sale.id } });

    await expect(
      prisma.saleItem.update({ where: { id: item.id }, data: { unitPrice: 1 } }),
    ).rejects.toThrow();
  });

  it("desconto acima do limite do vendedor exige autorização", async () => {
    const { company, store, session, product } = await scenario();

    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });
    const sellerToken = await authenticate(seller.employeeCode, password);

    // 30 de 100 = 30%, muito acima dos 5% que o vendedor pode dar sozinho.
    const response = await sell(sellerToken, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 1 }],
      discountAmount: 30,
      payments: [{ method: "DINHEIRO", amount: 70 }],
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DISCOUNT_NEEDS_AUTHORIZATION");

    // Desconto dentro do limite passa sem autorização.
    const dentroDoLimite = await sell(sellerToken, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 1 }],
      discountAmount: 4,
      payments: [{ method: "DINHEIRO", amount: 96 }],
    });

    expect(dentroDoLimite.statusCode).toBe(201);
    // Sem token de gerente envolvido, o campo fica vazio.
    expect(dentroDoLimite.json().discountAuthorizedById).toBeNull();
  });

  it("cancelar devolve a peça ao estoque e a venda continua no histórico", async () => {
    const { store, session, token, product } = await scenario();

    const sale = (
      await sell(token, {
        storeId: store.id,
        sessionId: session.id,
        items: [{ productId: product.id, quantity: 3 }],
        payments: [{ method: "DINHEIRO", amount: 300 }],
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${sale.id}/cancel`,
      headers: auth(token),
      payload: { reason: "cliente desistiu na porta" },
    });

    expect(response.statusCode).toBe(200);

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(stock.quantity).toBe(10);

    // Não apagou: mudou de status e guardou o motivo.
    const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stored.status).toBe("CANCELADA");
    expect(stored.cancelReason).toBe("cliente desistiu na porta");
  });
});

describe("caixa com fechamento cego", () => {
  it("a tela de fechamento não entrega o valor esperado", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 2 }],
      payments: [{ method: "DINHEIRO", amount: 200 }],
    });

    const closing = (
      await app.inject({
        method: "GET",
        url: `/api/v1/cash/sessions/${session.id}/closing`,
        headers: auth(token),
      })
    ).json();

    expect(closing.salesCount).toBe(1);
    // Nenhum campo de valor sai do servidor — nem esperado, nem total vendido.
    expect(JSON.stringify(closing)).not.toContain("300");
    expect(closing.expectedAmount).toBeUndefined();
  });

  it("o detalhe do turno aberto também não mostra os valores", async () => {
    const { session, token } = await scenario();

    const detalhe = (
      await app.inject({
        method: "GET",
        url: `/api/v1/cash/sessions/${session.id}`,
        headers: auth(token),
      })
    ).json();

    expect(detalhe.openingAmount).toBeNull();
    expect(detalhe.avisoFechamentoCego).toBeTruthy();
  });

  it("só dinheiro conta para a gaveta — cartão não entra na conferência", async () => {
    const { store, session, token, product } = await scenario();

    await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: "DINHEIRO", amount: 100 }],
    });
    await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 1 }],
      payments: [{ method: "PIX", amount: 100 }],
    });

    // Fundo de 100 + 100 em dinheiro. O PIX é receita, mas não está na gaveta.
    const result = (
      await app.inject({
        method: "POST",
        url: `/api/v1/cash/sessions/${session.id}/close`,
        headers: auth(token),
        payload: { countedAmount: 200 },
      })
    ).json();

    expect(Number(result.expectedAmount)).toBe(200);
    expect(Number(result.differenceAmount)).toBe(0);
    expect(result.conferido).toBe(true);
  });

  it("caixa que não bate exige explicação escrita", async () => {
    const { session, token } = await scenario();

    const semMotivo = await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/close`,
      headers: auth(token),
      payload: { countedAmount: 80 },
    });

    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.json().error.code).toBe("DIFFERENCE_REASON_REQUIRED");

    const comMotivo = await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/close`,
      headers: auth(token),
      payload: { countedAmount: 80, differenceReason: "faltou troco na abertura" },
    });

    expect(comMotivo.statusCode).toBe(200);
    expect(Number(comMotivo.json().differenceAmount)).toBe(-20);
  });

  it("não abre dois turnos no mesmo caixa", async () => {
    const { cashRegister, token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cash/sessions",
      headers: auth(token),
      payload: { cashRegisterId: cashRegister.id, openingAmount: 50 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SESSION_ALREADY_OPEN");
  });

  it("não retira mais dinheiro do que há na gaveta", async () => {
    const { session, token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/withdrawal`,
      headers: auth(token),
      payload: { amount: 500, reason: "levar ao banco" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INSUFFICIENT_CASH");
  });

  it("sangria reduz o esperado do fechamento", async () => {
    const { session, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/withdrawal`,
      headers: auth(token),
      payload: { amount: 60, reason: "levar ao cofre" },
    });

    const result = (
      await app.inject({
        method: "POST",
        url: `/api/v1/cash/sessions/${session.id}/close`,
        headers: auth(token),
        payload: { countedAmount: 40 },
      })
    ).json();

    expect(Number(result.expectedAmount)).toBe(40);
    expect(result.conferido).toBe(true);
  });

  it("o movimento de dinheiro não pode ser alterado nem apagado", async () => {
    const { session, token } = await scenario();

    await app.inject({
      method: "POST",
      url: `/api/v1/cash/sessions/${session.id}/withdrawal`,
      headers: auth(token),
      payload: { amount: 30, reason: "cofre" },
    });

    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: { sessionId: session.id, type: "SANGRIA" },
    });

    await expect(
      prisma.cashMovement.update({ where: { id: movement.id }, data: { amount: 0 } }),
    ).rejects.toThrow();
    await expect(
      prisma.cashMovement.delete({ where: { id: movement.id } }),
    ).rejects.toThrow();
  });
});

describe("reservas", () => {
  it("reservar tira do disponível sem tirar do estoque", async () => {
    const { store, token, product, customer } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/reservations",
      headers: auth(token),
      payload: { storeId: store.id, customerId: customer.id, productId: product.id, quantity: 3 },
    });

    expect(response.statusCode).toBe(201);

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    // A peça continua na loja...
    expect(stock.quantity).toBe(10);
    // ...mas não está disponível para outro cliente.
    expect(stock.reservedQuantity).toBe(3);
  });

  it("não vende a peça que está reservada para outro cliente", async () => {
    const { store, session, token, product, customer } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/reservations",
      headers: auth(token),
      payload: { storeId: store.id, customerId: customer.id, productId: product.id, quantity: 8 },
    });

    // Sobram 2 disponíveis. Tentar levar 5 tem que bater na trava.
    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      items: [{ productId: product.id, quantity: 5 }],
      payments: [{ method: "DINHEIRO", amount: 500 }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("RESERVED_STOCK");
  });

  it("converter a reserva em venda libera a reserva e baixa o estoque", async () => {
    const { store, session, token, product, customer } = await scenario();

    const reservation = (
      await app.inject({
        method: "POST",
        url: "/api/v1/reservations",
        headers: auth(token),
        payload: { storeId: store.id, customerId: customer.id, productId: product.id, quantity: 2 },
      })
    ).json();

    const response = await sell(token, {
      storeId: store.id,
      sessionId: session.id,
      customerId: customer.id,
      reservationId: reservation.id,
      items: [{ productId: product.id, quantity: 2 }],
      payments: [{ method: "DINHEIRO", amount: 200 }],
    });

    expect(response.statusCode).toBe(201);

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(stock.quantity).toBe(8);
    expect(stock.reservedQuantity).toBe(0);

    const stored = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(stored.status).toBe("CONVERTIDA");
  });

  it("cancelar a reserva devolve a peça ao disponível", async () => {
    const { store, token, product, customer } = await scenario();

    const reservation = (
      await app.inject({
        method: "POST",
        url: "/api/v1/reservations",
        headers: auth(token),
        payload: { storeId: store.id, customerId: customer.id, productId: product.id, quantity: 4 },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/reservations/${reservation.id}/cancel`,
      headers: auth(token),
      payload: { reason: "cliente não voltou" },
    });

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(stock.reservedQuantity).toBe(0);
  });

  it("não reserva mais do que está disponível", async () => {
    const { store, token, product, customer } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/reservations",
      headers: auth(token),
      payload: { storeId: store.id, customerId: customer.id, productId: product.id, quantity: 30 },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe("orçamentos", () => {
  it("orçamento não mexe no estoque", async () => {
    const { store, token, product } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/quotes",
      headers: auth(token),
      payload: {
        storeId: store.id,
        customerName: "João sem cadastro",
        items: [{ productId: product.id, quantity: 5 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(Number(response.json().totalAmount)).toBe(500);

    const stock = await prisma.stockItem.findFirstOrThrow({ where: { storeId: store.id } });
    expect(stock.quantity).toBe(10);
    expect(stock.reservedQuantity).toBe(0);
  });

  it("o preço do orçamento também vem do servidor", async () => {
    const { store, token, product } = await scenario();

    const quote = (
      await app.inject({
        method: "POST",
        url: "/api/v1/quotes",
        headers: auth(token),
        payload: {
          storeId: store.id,
          customerName: "Cliente",
          items: [{ productId: product.id, quantity: 2 }],
          unitPrice: 1,
        },
      })
    ).json();

    expect(Number(quote.items[0].unitPrice)).toBe(100);
  });

  it("orçamento vencido avisa que os preços serão recalculados", async () => {
    const { store, token, product } = await scenario();

    const quote = (
      await app.inject({
        method: "POST",
        url: "/api/v1/quotes",
        headers: auth(token),
        payload: {
          storeId: store.id,
          customerName: "Cliente",
          items: [{ productId: product.id, quantity: 1 }],
        },
      })
    ).json();

    // Empurra a validade para ontem, sem passar pelo serviço.
    await prisma.quote.update({
      where: { id: quote.id },
      data: { validUntil: new Date(Date.now() - 86_400_000) },
    });

    const conversion = (
      await app.inject({
        method: "GET",
        url: `/api/v1/quotes/${quote.id}/conversion`,
        headers: auth(token),
      })
    ).json();

    expect(conversion.expirado).toBe(true);
    expect(conversion.aviso).toContain("recalculados");
  });
});

describe("clientes", () => {
  it("não duplica cliente pelo mesmo telefone", async () => {
    const { token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: auth(token),
      payload: { name: "Maria de novo", phone: "(11) 98888-7777" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CUSTOMER_EXISTS");
  });

  it("o cadastro rápido do balcão reaproveita quem já existe", async () => {
    const { token, customer } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/customers/quick",
      headers: auth(token),
      payload: { name: "Maria S.", phone: "11988887777" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBe(customer.id);
  });

  it("recusa CPF inválido em vez de guardar número errado", async () => {
    const { token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/customers",
      headers: auth(token),
      payload: { name: "Cliente", phone: "11977776666", cpf: "111.111.111-11" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_CPF");
  });
});
