import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { assertTerminalCanCharge } from "../../src/modules/terminals/terminals.service.js";
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

/** Monta a cadeia completa loja → estação → caixa → tablet pareado. */
async function createChain(companyId: string, storeId: string, suffix: string) {
  const station = await prisma.pOSStation.create({
    data: { storeId, code: `E${suffix}`, name: `Estação ${suffix}` },
  });
  const cashRegister = await prisma.cashRegister.create({
    data: { posStationId: station.id, code: `C${suffix}`, name: `Caixa ${suffix}` },
  });
  const device = await prisma.device.create({
    data: {
      cashRegisterId: cashRegister.id,
      companyId,
      storeId,
      name: `Tablet ${suffix}`,
      status: "ACTIVE",
    },
  });

  return { station, cashRegister, device };
}

describe("cadastro de maquininhas", () => {
  it("nasce amarrada a empresa, loja, estação, caixa e tablet — nenhum campo vazio", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "01");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    const token = await authenticate(owner.employeeCode, password);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: auth(token),
      payload: { deviceId: chain.device.id, provider: "Mercado Pago", serialNumber: "MP-001" },
    });

    expect(response.statusCode).toBe(201);
    const terminal = response.json();

    expect(terminal.companyId).toBe(company.id);
    expect(terminal.storeId).toBe(store.id);
    expect(terminal.posStationId).toBe(chain.station.id);
    expect(terminal.cashRegisterId).toBe(chain.cashRegister.id);
    expect(terminal.deviceId).toBe(chain.device.id);
  });

  it("recusa vincular a um tablet que ainda não foi pareado", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "02");
    await prisma.device.update({ where: { id: chain.device.id }, data: { status: "PENDING" } });

    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: auth(token),
      payload: { deviceId: chain.device.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("DEVICE_NOT_ACTIVE");
  });

  it("o vendedor não cadastra maquininha", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "03");
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    const token = await authenticate(seller.employeeCode, password);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: auth(token),
      payload: { deviceId: chain.device.id },
    });

    expect(response.statusCode).toBe(403);
  });

  it("não cadastra em tablet de outra empresa", async () => {
    const companyA = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: companyA.id,
      role: "DONO",
    });

    const companyB = await createTestCompany("Concorrente");
    const storeB = await createTestStore(companyB.id, "XX");
    const chainB = await createChain(companyB.id, storeB.id, "04");

    const token = await authenticate(owner.employeeCode, password);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: auth(token),
      payload: { deviceId: chainB.device.id },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("substituição de maquininha", () => {
  it("a antiga vira RETIRED e continua no banco, preservando o histórico", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "05");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/terminals",
        headers: auth(token),
        payload: { deviceId: chain.device.id, serialNumber: "ANTIGA-1" },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${created.id}/replace`,
      headers: auth(token),
      payload: { newSerialNumber: "NOVA-1", reason: "aparelho com defeito" },
    });

    expect(response.statusCode).toBe(201);

    const old = await prisma.paymentTerminal.findUniqueOrThrow({ where: { id: created.id } });
    expect(old.status).toBe("RETIRED");
    expect(old.serialNumber).toBe("ANTIGA-1");

    const replacement = await prisma.paymentTerminal.findUniqueOrThrow({
      where: { id: response.json().replacement.id },
    });
    expect(replacement.serialNumber).toBe("NOVA-1");
    // A nova herda a mesma cadeia — a troca é de aparelho, não de caixa.
    expect(replacement.cashRegisterId).toBe(old.cashRegisterId);
  });

  it("uma maquininha substituída não volta a operar", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "06");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/terminals",
        headers: auth(token),
        payload: { deviceId: chain.device.id, serialNumber: "VELHA-2" },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${created.id}/replace`,
      headers: auth(token),
      payload: { newSerialNumber: "NOVA-2", reason: "troca" },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/terminals/${created.id}/status`,
      headers: auth(token),
      payload: { status: "ACTIVE", reason: "tentativa de reativar" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("TERMINAL_RETIRED");
  });
});

describe("principal e reserva", () => {
  it("eleger uma principal rebaixa a anterior do mesmo caixa", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "11");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const base = {
      deviceId: chain.device.id,
      cashRegisterId: chain.cashRegister.id,
      posStationId: chain.station.id,
      storeId: store.id,
      companyId: company.id,
      status: "ACTIVE" as const,
    };

    const first = await prisma.paymentTerminal.create({
      data: { ...base, serialNumber: "P-1", isPrimary: true },
    });
    const second = await prisma.paymentTerminal.create({
      data: { ...base, serialNumber: "P-2" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${second.id}/primary`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(200);

    const [a, b] = await Promise.all([
      prisma.paymentTerminal.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.paymentTerminal.findUniqueOrThrow({ where: { id: second.id } }),
    ]);

    expect(a.isPrimary).toBe(false);
    expect(b.isPrimary).toBe(true);
  });

  it("bloquear a principal tira o posto dela", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "12");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const terminal = await prisma.paymentTerminal.create({
      data: {
        deviceId: chain.device.id,
        cashRegisterId: chain.cashRegister.id,
        posStationId: chain.station.id,
        storeId: store.id,
        companyId: company.id,
        status: "ACTIVE",
        isPrimary: true,
      },
    });

    await app.inject({
      method: "PATCH",
      url: `/api/v1/terminals/${terminal.id}/status`,
      headers: auth(token),
      payload: { status: "BLOCKED", reason: "aparelho sumiu" },
    });

    const stored = await prisma.paymentTerminal.findUniqueOrThrow({ where: { id: terminal.id } });
    expect(stored.isPrimary).toBe(false);
  });

  it("o banco recusa duas principais no mesmo caixa", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "13");

    const base = {
      deviceId: chain.device.id,
      cashRegisterId: chain.cashRegister.id,
      posStationId: chain.station.id,
      storeId: store.id,
      companyId: company.id,
      status: "ACTIVE" as const,
      isPrimary: true,
    };

    await prisma.paymentTerminal.create({ data: { ...base, serialNumber: "D-1" } });

    // Insert direto, contornando o serviço: é a trava do banco que está sob teste.
    await expect(
      prisma.paymentTerminal.create({ data: { ...base, serialNumber: "D-2" } }),
    ).rejects.toThrow();
  });

  it("maquininha bloqueada não pode virar principal", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "14");
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const terminal = await prisma.paymentTerminal.create({
      data: {
        deviceId: chain.device.id,
        cashRegisterId: chain.cashRegister.id,
        posStationId: chain.station.id,
        storeId: store.id,
        companyId: company.id,
        status: "BLOCKED",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${terminal.id}/primary`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("TERMINAL_NOT_ACTIVE");
  });
});

describe("trava de cobrança", () => {
  it("recusa cobrar por maquininha de outro caixa", async () => {
    const company = await createTestCompany();
    const storeA = await createTestStore(company.id, "LA");
    const storeB = await createTestStore(company.id, "LB");
    const chainA = await createChain(company.id, storeA.id, "07");
    const chainB = await createChain(company.id, storeB.id, "08");

    const terminal = await prisma.paymentTerminal.create({
      data: {
        deviceId: chainA.device.id,
        cashRegisterId: chainA.cashRegister.id,
        posStationId: chainA.station.id,
        storeId: storeA.id,
        companyId: company.id,
        status: "ACTIVE",
      },
    });

    // Mesma maquininha, mas apontando para o caixa e a loja errados.
    await expect(
      assertTerminalCanCharge({
        terminalId: terminal.id,
        storeId: storeB.id,
        cashRegisterId: chainB.cashRegister.id,
        deviceId: chainB.device.id,
      }),
    ).rejects.toMatchObject({ code: "TERMINAL_WRONG_BINDING" });
  });

  it("recusa cobrar por maquininha bloqueada", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "09");

    const terminal = await prisma.paymentTerminal.create({
      data: {
        deviceId: chain.device.id,
        cashRegisterId: chain.cashRegister.id,
        posStationId: chain.station.id,
        storeId: store.id,
        companyId: company.id,
        status: "BLOCKED",
      },
    });

    await expect(
      assertTerminalCanCharge({
        terminalId: terminal.id,
        storeId: store.id,
        cashRegisterId: chain.cashRegister.id,
        deviceId: chain.device.id,
      }),
    ).rejects.toMatchObject({ code: "TERMINAL_NOT_ACTIVE" });
  });

  it("aceita quando toda a cadeia bate e a maquininha está ativa", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const chain = await createChain(company.id, store.id, "10");

    const terminal = await prisma.paymentTerminal.create({
      data: {
        deviceId: chain.device.id,
        cashRegisterId: chain.cashRegister.id,
        posStationId: chain.station.id,
        storeId: store.id,
        companyId: company.id,
        status: "ACTIVE",
      },
    });

    await expect(
      assertTerminalCanCharge({
        terminalId: terminal.id,
        storeId: store.id,
        cashRegisterId: chain.cashRegister.id,
        deviceId: chain.device.id,
      }),
    ).resolves.toBeUndefined();
  });
});
