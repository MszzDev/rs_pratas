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

async function authenticate(employeeCode: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: employeeCode, password },
  });
  return response.json().accessToken as string;
}

/** Monta empresa + loja + dono autenticado + estação + caixa. */
async function setupStoreWithOwner() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({
    companyId: company.id,
    role: "DONO",
  });
  const token = await authenticate(owner.employeeCode, password);

  const station = await app
    .inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E01", name: "Estação 01" },
    })
    .then((response) => response.json());

  const cashRegister = await app
    .inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { authorization: `Bearer ${token}` },
      payload: { posStationId: station.id, code: "C01", name: "Caixa 01" },
    })
    .then((response) => response.json());

  return { company, store, owner, password, token, station, cashRegister };
}

async function createDevice(token: string, cashRegisterId: string, name = "Tablet 01") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/devices",
    headers: { authorization: `Bearer ${token}` },
    payload: { cashRegisterId, name },
  });
  return response;
}

describe("hierarquia loja → estação → caixa", () => {
  it("cria estação e caixa vinculados à loja", async () => {
    const { station, cashRegister, store } = await setupStoreWithOwner();

    expect(station.storeId).toBe(store.id);
    expect(cashRegister.posStationId).toBe(station.id);
  });

  it("recusa código de estação duplicado na mesma loja", async () => {
    const { store, token } = await setupStoreWithOwner();

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E01", name: "Outra estação" },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("POS_STATION_CODE_TAKEN");
  });

  it("gerente não pode criar estação — é ação do dono", async () => {
    const { company, store } = await setupStoreWithOwner();
    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
    const token = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E99", name: "Estação do gerente" },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("criação de dispositivo", () => {
  it("nasce em PENDING com código de pareamento temporário", async () => {
    const { token, cashRegister, store, company } = await setupStoreWithOwner();

    const response = await createDevice(token, cashRegister.id);
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.device.status).toBe("PENDING");
    expect(body.pairingCode).toMatch(/^[ACDEFGHJKMNPQRTUVWXY34679]{8}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // storeId/companyId derivam da cadeia, não do corpo da requisição.
    expect(body.device.storeId).toBe(store.id);
    expect(body.device.companyId).toBe(company.id);
  });

  it("gera códigos de pareamento distintos a cada dispositivo", async () => {
    const { token, cashRegister } = await setupStoreWithOwner();

    const codes = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      const response = await createDevice(token, cashRegister.id, `Tablet ${index}`);
      codes.add(response.json().pairingCode);
    }

    expect(codes.size).toBe(8);
  });

  it("audita a criação do dispositivo", async () => {
    const { token, cashRegister } = await setupStoreWithOwner();
    const device = (await createDevice(token, cashRegister.id)).json();

    const entry = await prisma.auditLog.findFirst({
      where: { deviceId: device.device.id, action: "DEVICE_PAIR_INITIATED" },
    });
    expect(entry).not.toBeNull();
  });
});

describe("pareamento do tablet (claim)", () => {
  async function pendingDevice() {
    const context = await setupStoreWithOwner();
    const created = (await createDevice(context.token, context.cashRegister.id)).json();
    return { ...context, device: created.device, pairingCode: created.pairingCode as string };
  }

  const claim = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/devices/claim", payload });

  it("ativa o dispositivo e consome o código", async () => {
    const { pairingCode, device } = await pendingDevice();

    const response = await claim({
      pairingCode,
      deviceUuid: "android-uuid-0001",
      model: "Galaxy Tab A9",
      osVersion: "14",
      appVersion: "1.0.0",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ACTIVE");

    const stored = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(stored.status).toBe("ACTIVE");
    expect(stored.deviceUuid).toBe("android-uuid-0001");
    // Uso único: o código não sobrevive ao pareamento.
    expect(stored.pairingCode).toBeNull();
    expect(stored.pairedAt).not.toBeNull();
  });

  it("não aceita o mesmo código duas vezes", async () => {
    const { pairingCode } = await pendingDevice();

    await claim({ pairingCode, deviceUuid: "android-uuid-0001" });
    const second = await claim({ pairingCode, deviceUuid: "android-uuid-0002" });

    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe("INVALID_PAIRING_CODE");
  });

  it("rejeita código inexistente", async () => {
    const response = await claim({ pairingCode: "AAAAAAAA", deviceUuid: "qualquer-uuid" });
    expect(response.statusCode).toBe(400);
  });

  it("rejeita código expirado", async () => {
    const { pairingCode, device } = await pendingDevice();
    await prisma.device.update({
      where: { id: device.id },
      data: { pairingCodeExpiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await claim({ pairingCode, deviceUuid: "android-uuid-0003" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PAIRING_CODE_EXPIRED");
  });

  it("impede que um aparelho assuma dois cadastros", async () => {
    const context = await setupStoreWithOwner();
    const first = (await createDevice(context.token, context.cashRegister.id, "Tablet A")).json();
    const second = (await createDevice(context.token, context.cashRegister.id, "Tablet B")).json();

    await claim({ pairingCode: first.pairingCode, deviceUuid: "mesmo-aparelho" });
    const response = await claim({ pairingCode: second.pairingCode, deviceUuid: "mesmo-aparelho" });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DEVICE_UUID_IN_USE");
  });
});

describe("isolamento entre lojas e empresas (IDOR)", () => {
  it("gerente de outra loja recebe 404 — não 403 — ao mirar loja alheia", async () => {
    const { company, store: storeA } = await setupStoreWithOwner();
    const storeB = await createTestStore(company.id, "L02");

    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: storeB.id } });
    const token = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/devices?storeId=${storeA.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // 404 de propósito: 403 confirmaria que a loja existe.
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("STORE_NOT_FOUND");
  });

  it("dono de uma empresa não enxerga loja de outra empresa nem acertando o ID", async () => {
    const contextA = await setupStoreWithOwner();
    const companyB = await createTestCompany("Concorrente");
    const storeB = await createTestStore(companyB.id, "X01");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/devices?storeId=${storeB.id}`,
      headers: { authorization: `Bearer ${contextA.token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("listagem só devolve dispositivos das lojas autorizadas ao gerente", async () => {
    const contextA = await setupStoreWithOwner();
    await createDevice(contextA.token, contextA.cashRegister.id, "Tablet da loja A");

    const storeB = await createTestStore(contextA.company.id, "L02");
    const { user: manager, password } = await createTestUser({
      companyId: contextA.company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: storeB.id } });
    const token = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(0);
  });
});

describe("perfil DESENVOLVEDOR", () => {
  it("enxerga a listagem mas é barrado em qualquer escrita", async () => {
    const { company, cashRegister } = await setupStoreWithOwner();
    const { user: dev, password } = await createTestUser({
      companyId: company.id,
      role: "DESENVOLVEDOR",
    });
    const token = await authenticate(dev.employeeCode, password);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/v1/devices",
      headers: { authorization: `Bearer ${token}` },
      payload: { cashRegisterId: cashRegister.id, name: "Tablet proibido" },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe("DEVELOPER_READ_ONLY");
  });
});

describe("desvínculo de dispositivo", () => {
  it("exige motivo, derruba as sessões do aparelho e audita", async () => {
    const context = await setupStoreWithOwner();
    const created = (await createDevice(context.token, context.cashRegister.id)).json();

    await app.inject({
      method: "POST",
      url: "/api/v1/devices/claim",
      payload: { pairingCode: created.pairingCode, deviceUuid: "uuid-para-desvincular" },
    });

    // Sessão ativa nesse tablet.
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: {
        identifier: context.owner.employeeCode,
        password: context.password,
        deviceId: created.device.id,
      },
    });
    const tokens = login.json();

    const semMotivo = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${created.device.id}/unlink`,
      headers: { authorization: `Bearer ${context.token}` },
      payload: {},
    });
    expect(semMotivo.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${created.device.id}/unlink`,
      headers: { authorization: `Bearer ${context.token}` },
      payload: { reason: "aparelho furtado na loja" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("UNLINKED");

    // A sessão daquele tablet morre junto.
    const afterUnlink = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(afterUnlink.statusCode).toBe(401);

    const entry = await prisma.auditLog.findFirst({
      where: { deviceId: created.device.id, action: "DEVICE_UNLINK" },
    });
    expect(entry?.reason).toBe("aparelho furtado na loja");
  });

  it("gerente não pode desvincular dispositivo", async () => {
    const context = await setupStoreWithOwner();
    const created = (await createDevice(context.token, context.cashRegister.id)).json();

    const { user: manager, password } = await createTestUser({
      companyId: context.company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: context.store.id } });
    const token = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${created.device.id}/unlink`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "tentativa indevida" },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("login vinculado a dispositivo", () => {
  it("recusa login em dispositivo ainda não pareado", async () => {
    const context = await setupStoreWithOwner();
    const created = (await createDevice(context.token, context.cashRegister.id)).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: {
        identifier: context.owner.employeeCode,
        password: context.password,
        deviceId: created.device.id,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_NOT_ACTIVE");
  });

  it("amarra a sessão à loja do dispositivo quando o login vem de um tablet", async () => {
    const context = await setupStoreWithOwner();
    const created = (await createDevice(context.token, context.cashRegister.id)).json();
    await app.inject({
      method: "POST",
      url: "/api/v1/devices/claim",
      payload: { pairingCode: created.pairingCode, deviceUuid: "uuid-sessao-loja" },
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: {
        identifier: context.owner.employeeCode,
        password: context.password,
        deviceId: created.device.id,
      },
    });

    const session = await prisma.deviceSession.findFirst({
      where: { deviceId: created.device.id },
    });
    expect(session?.storeId).toBe(context.store.id);
  });
});
