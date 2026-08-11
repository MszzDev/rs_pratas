import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Secret, TOTP } from "otpauth";
import { prisma } from "../../src/db/prisma.js";
import { decryptSecret } from "../../src/core/security/totp.service.js";
import {
  createTestApp,
  createTestCompany,
  createTestStore,
  createTestUser,
  disconnectAll,
  resetDatabase,
} from "./helpers.js";

/**
 * Regressões de isolamento entre lojas.
 *
 * Cada caso aqui corresponde a uma falha real encontrada em revisão: o acesso
 * era barrado num caminho e passava por outro. São exatamente os buracos que
 * voltam sozinhos quando alguém adiciona um endpoint novo.
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

async function authenticate(email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: email, password },
  });
  return response.json().accessToken as string;
}

async function currentTotpCode(userId: string, accountLabel: string) {
  const credential = await prisma.twoFactorCredential.findUniqueOrThrow({ where: { userId } });
  return new TOTP({
    issuer: "RS Pratas",
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(decryptSecret(credential.secretEncrypted)),
  }).generate();
}

/** Duas lojas na mesma empresa, cada uma com seu tablet e seu vendedor. */
async function twoStores() {
  const company = await createTestCompany();
  const storeA = await createTestStore(company.id, "LA");
  const storeB = await createTestStore(company.id, "LB");

  async function tabletFor(storeId: string, code: string) {
    const station = await prisma.pOSStation.create({
      data: { storeId, code: `E-${code}`, name: `Estação ${code}` },
    });
    const cashRegister = await prisma.cashRegister.create({
      data: { posStationId: station.id, code: `C-${code}`, name: `Caixa ${code}` },
    });
    return prisma.device.create({
      data: {
        cashRegisterId: cashRegister.id,
        companyId: company.id,
        storeId,
        name: `Tablet ${code}`,
        status: "ACTIVE",
        deviceUuid: `uuid-${crypto.randomUUID()}`,
      },
    });
  }

  const deviceA = await tabletFor(storeA.id, "A");
  const deviceB = await tabletFor(storeB.id, "B");

  const { user: sellerA, password: passwordA } = await createTestUser({
    companyId: company.id,
    role: "VENDEDOR",
  });
  await prisma.userStore.create({ data: { userId: sellerA.id, storeId: storeA.id } });

  const { user: sellerB, password: passwordB } = await createTestUser({
    companyId: company.id,
    role: "VENDEDOR",
  });
  await prisma.userStore.create({ data: { userId: sellerB.id, storeId: storeB.id } });

  const { user: managerA, password: managerPasswordA } = await createTestUser({
    companyId: company.id,
    role: "GERENTE",
  });
  await prisma.userStore.create({ data: { userId: managerA.id, storeId: storeA.id } });

  return {
    company,
    storeA,
    storeB,
    deviceA,
    deviceB,
    sellerA,
    passwordA,
    sellerB,
    passwordB,
    managerA,
    managerPasswordA,
  };
}

describe("login preso à loja do dispositivo", () => {
  it("login por senha num tablet de outra loja é recusado", async () => {
    const { sellerA, passwordA, deviceB } = await twoStores();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: sellerA.email, password: passwordA, deviceId: deviceB.id },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STORE_ACCESS_DENIED");
  });

  it("login por senha no tablet da própria loja funciona", async () => {
    const { sellerA, passwordA, deviceA } = await twoStores();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: sellerA.email, password: passwordA, deviceId: deviceA.id },
    });

    expect(response.statusCode).toBe(200);
  });

  it("o dono entra em qualquer tablet da empresa", async () => {
    const { company, deviceB } = await twoStores();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: owner.email, password, deviceId: deviceB.id },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("ponto preso à loja do dispositivo", () => {
  it("não registra ponto no tablet de outra loja", async () => {
    const { sellerA, passwordA, deviceB } = await twoStores();
    const token = await authenticate(sellerA.email!, passwordA);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/punch",
      headers: auth(token),
      payload: { deviceId: deviceB.id, type: "CLOCK_IN" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STORE_ACCESS_DENIED");

    // Nenhuma marcação foi gravada.
    expect(await prisma.timeClockEntry.count({ where: { userId: sellerA.id } })).toBe(0);
  });

  it("a tentativa negada fica registrada na auditoria", async () => {
    const { sellerA, passwordA, deviceB } = await twoStores();
    const token = await authenticate(sellerA.email!, passwordA);

    await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/punch",
      headers: auth(token),
      payload: { deviceId: deviceB.id, type: "CLOCK_IN" },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { userId: sellerA.id, action: "TIMECLOCK_ENTRY_CREATE", result: "DENIED" },
    });
    expect(entry?.reason).toContain("sem acesso à loja");
  });

  it("registra normalmente no tablet da própria loja", async () => {
    const { sellerA, passwordA, deviceA } = await twoStores();
    const token = await authenticate(sellerA.email!, passwordA);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/punch",
      headers: auth(token),
      payload: { deviceId: deviceA.id, type: "CLOCK_IN" },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe("espelho de ponto preso à loja do gerente", () => {
  it("gerente não vê o ponto de funcionário de outra loja", async () => {
    const { managerA, managerPasswordA, sellerB } = await twoStores();
    const token = await authenticate(managerA.email!, managerPasswordA);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/timeclock/users/${sellerB.id}/mirror`,
      headers: auth(token),
    });

    // 404 e não 403 — confirmar que o funcionário existe já seria informação.
    expect(response.statusCode).toBe(404);
  });

  it("gerente vê o ponto de funcionário da própria loja", async () => {
    const { managerA, managerPasswordA, sellerA } = await twoStores();
    const token = await authenticate(managerA.email!, managerPasswordA);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/timeclock/users/${sellerA.id}/mirror`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(sellerA.id);
  });

  it("o dono vê o ponto de qualquer loja da empresa", async () => {
    const { company, sellerB } = await twoStores();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.email!, password);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/timeclock/users/${sellerB.id}/mirror`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("rotação de refresh token sob concorrência", () => {
  it("duas renovações simultâneas com o mesmo token não criam duas cadeias", async () => {
    const { sellerA, passwordA } = await twoStores();

    const tokens = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login/password",
        payload: { identifier: sellerA.email, password: passwordA },
      })
    ).json();

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: tokens.refreshToken },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: tokens.refreshToken },
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();

    // Exatamente uma vence; a outra é recusada em vez de gerar uma segunda cadeia.
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);

    const rotations = await prisma.refreshToken.count({ where: { rotatedFromId: { not: null } } });
    expect(rotations).toBe(1);
  });
});

describe("mudança de perfil encerra as sessões", () => {
  it("rebaixar alguém invalida o token que ainda carregava o perfil antigo", async () => {
    const { company, storeA, sellerA, passwordA } = await twoStores();

    const { user: owner, password: ownerPassword } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const ownerToken = await authenticate(owner.email!, ownerPassword);

    // O vendedor entra e vira gerente.
    const sellerTokens = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login/password",
        payload: { identifier: sellerA.email, password: passwordA },
      })
    ).json();

    await prisma.userStore.upsert({
      where: { userId_storeId: { userId: sellerA.id, storeId: storeA.id } },
      update: {},
      create: { userId: sellerA.id, storeId: storeA.id },
    });

    // O dono tem 2FA ativo, então a reautenticação usa o segundo fator.
    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: auth(ownerToken),
      payload: {
        purpose: "CREATE_OR_PROMOTE_OWNER",
        totpCode: await currentTotpCode(owner.id, owner.email!),
      },
    });
    expect(stepUp.statusCode).toBe(200);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${sellerA.id}/role`,
      headers: { ...auth(ownerToken), "x-step-up-token": stepUp.json().stepUpToken },
      payload: { role: "GERENTE", reason: "promoção" },
    });

    const afterChange = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: sellerTokens.refreshToken },
    });

    expect(afterChange.statusCode).toBe(401);
  });
});
