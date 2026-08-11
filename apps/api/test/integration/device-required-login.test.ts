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
  grantOffDeviceAccess,
  resetDatabase,
} from "./helpers.js";

/**
 * Regra: funcionário só entra pelos tablets da loja.
 *
 * Fora deles, apenas o dono — e quem o dono liberar nominalmente, matrícula por
 * matrícula. É a regra que impede alguém levar o acesso ao caixa para casa.
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

const login = (identifier: string, password: string, deviceId?: string) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier, password, ...(deviceId ? { deviceId } : {}) },
  });

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

/** Loja com tablet ativo, um vendedor e o dono. */
async function storeWithTablet() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);

  const station = await prisma.pOSStation.create({
    data: { storeId: store.id, code: "E01", name: "Estação 01" },
  });
  const cashRegister = await prisma.cashRegister.create({
    data: { posStationId: station.id, code: "C01", name: "Caixa 01" },
  });
  const device = await prisma.device.create({
    data: {
      cashRegisterId: cashRegister.id,
      companyId: company.id,
      storeId: store.id,
      name: "Tablet 01",
      status: "ACTIVE",
      deviceUuid: `uuid-${crypto.randomUUID()}`,
    },
  });

  // allowOffDevice: false — este arquivo testa exatamente a regra padrão.
  const { user: seller, password: sellerPassword } = await createTestUser({
    companyId: company.id,
    role: "VENDEDOR",
    allowOffDevice: false,
  });
  await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

  const { user: manager, password: managerPassword } = await createTestUser({
    companyId: company.id,
    role: "GERENTE",
    allowOffDevice: false,
  });
  await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });

  const { user: owner, password: ownerPassword } = await createTestUser({
    companyId: company.id,
    role: "DONO",
  });

  return {
    company,
    store,
    device,
    seller,
    sellerPassword,
    manager,
    managerPassword,
    owner,
    ownerPassword,
  };
}

describe("funcionário só entra pelo tablet", () => {
  it("vendedor é recusado fora de um tablet", async () => {
    const { seller, sellerPassword } = await storeWithTablet();

    const response = await login(seller.employeeCode, sellerPassword);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_REQUIRED");
    expect(response.json().error.message).toContain("tablets da loja");
  });

  it("gerente também é recusado fora de um tablet", async () => {
    const { manager, managerPassword } = await storeWithTablet();

    const response = await login(manager.employeeCode, managerPassword);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_REQUIRED");
  });

  it("o mesmo vendedor entra normalmente pelo tablet da loja", async () => {
    const { seller, sellerPassword, device } = await storeWithTablet();

    const response = await login(seller.employeeCode, sellerPassword, device.id);
    expect(response.statusCode).toBe(200);
  });

  it("a recusa fica registrada na auditoria", async () => {
    const { seller, sellerPassword } = await storeWithTablet();
    await login(seller.employeeCode, sellerPassword);

    const entry = await prisma.auditLog.findFirst({
      where: { userId: seller.id, action: "LOGIN_FAILED", result: "DENIED" },
    });
    expect(entry?.reason).toContain("fora do tablet");
  });

  it("senha errada continua respondendo como senha errada, não como bloqueio de aparelho", async () => {
    const { seller } = await storeWithTablet();

    const response = await login(seller.employeeCode, "senha-errada-mesmo");

    // A ordem importa: revelar "seu acesso é só no tablet" antes de validar a
    // senha confirmaria que a matrícula existe.
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("o dono alcança o sistema de qualquer lugar", () => {
  it("entra sem tablet", async () => {
    const { owner, ownerPassword } = await storeWithTablet();

    const response = await login(owner.employeeCode, ownerPassword);
    expect(response.statusCode).toBe(200);
  });
});

describe("liberação nominal concedida pelo dono", () => {
  async function ownerSession() {
    const context = await storeWithTablet();
    const token = (await login(context.owner.employeeCode, context.ownerPassword)).json().accessToken;

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: auth(token),
      payload: {
        purpose: "CHANGE_PERMISSIONS",
        totpCode: await currentTotpCode(context.owner.id, context.owner.employeeCode),
      },
    });

    return { ...context, token, stepUpToken: stepUp.json().stepUpToken as string };
  }

  it("libera uma matrícula específica e ela passa a entrar de fora", async () => {
    const context = await ownerSession();

    const antes = await login(context.seller.employeeCode, context.sellerPassword);
    expect(antes.statusCode).toBe(403);

    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: {
        code: "AUTH_LOGIN_OFF_DEVICE",
        reason: "trabalho remoto durante afastamento",
      },
    });
    expect(grant.statusCode).toBe(201);

    const depois = await login(context.seller.employeeCode, context.sellerPassword);
    expect(depois.statusCode).toBe(200);
  });

  it("a liberação vale só para a matrícula liberada", async () => {
    const context = await ownerSession();

    await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: { code: "AUTH_LOGIN_OFF_DEVICE", reason: "liberação pontual" },
    });

    // O gerente, que não foi liberado, continua preso ao tablet.
    const gerente = await login(context.manager.employeeCode, context.managerPassword);
    expect(gerente.statusCode).toBe(403);
  });

  it("liberação com prazo deixa de valer depois do vencimento", async () => {
    const context = await ownerSession();

    await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: {
        code: "AUTH_LOGIN_OFF_DEVICE",
        reason: "liberação temporária",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    expect((await login(context.seller.employeeCode, context.sellerPassword)).statusCode).toBe(200);

    // Vence a liberação.
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: "AUTH_LOGIN_OFF_DEVICE" },
    });
    await prisma.userPermission.update({
      where: {
        userId_permissionId: { userId: context.seller.id, permissionId: permission.id },
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await invalidateCache(context.seller.id);

    expect((await login(context.seller.employeeCode, context.sellerPassword)).statusCode).toBe(403);
  });

  it("recusa validade no passado", async () => {
    const context = await ownerSession();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: {
        code: "AUTH_LOGIN_OFF_DEVICE",
        reason: "tentativa",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("EXPIRES_IN_PAST");
  });

  it("revogar corta o acesso remoto e derruba a sessão aberta de fora", async () => {
    // A liberação é dada direto na base para que o único step-up deste teste
    // seja o da revogação: dois step-ups seguidos usariam o mesmo código TOTP,
    // e o anti-replay recusaria o segundo — corretamente.
    const context = await ownerSession();
    await grantOffDeviceAccess(context.seller.id);

    const sessaoRemota = (await login(context.seller.employeeCode, context.sellerPassword)).json();
    expect(sessaoRemota.accessToken).toBeTypeOf("string");

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${context.seller.id}/permissions/AUTH_LOGIN_OFF_DEVICE`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: { reason: "fim do afastamento" },
    });
    expect(revoke.statusCode).toBe(204);

    // A sessão remota morre na hora, sem esperar o token expirar.
    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: sessaoRemota.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);

    // E o acesso de fora volta a ser recusado.
    expect((await login(context.seller.employeeCode, context.sellerPassword)).statusCode).toBe(403);
  });

  it("revogar não atrapalha quem está trabalhando no tablet da loja", async () => {
    const context = await ownerSession();
    await grantOffDeviceAccess(context.seller.id);

    const sessaoNoTablet = (
      await login(context.seller.employeeCode, context.sellerPassword, context.device.id)
    ).json();

    await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${context.seller.id}/permissions/AUTH_LOGIN_OFF_DEVICE`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: { reason: "fim do afastamento" },
    });

    // A venda em andamento no balcão não pode cair por causa disso.
    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: sessaoNoTablet.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
  });

  it("conceder permissão exige reautenticação do dono", async () => {
    const context = await storeWithTablet();
    const token = (await login(context.owner.employeeCode, context.ownerPassword)).json().accessToken;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: auth(token),
      payload: { code: "AUTH_LOGIN_OFF_DEVICE", reason: "sem confirmar identidade" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STEP_UP_REQUIRED");
  });

  it("gerente não consegue liberar ninguém", async () => {
    const context = await storeWithTablet();
    const managerToken = (
      await login(context.manager.employeeCode, context.managerPassword, context.device.id)
    ).json().accessToken;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: auth(managerToken),
      payload: { code: "AUTH_LOGIN_OFF_DEVICE", reason: "tentativa indevida" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("a concessão e a revogação ficam auditadas com motivo", async () => {
    const context = await ownerSession();

    await app.inject({
      method: "POST",
      url: `/api/v1/users/${context.seller.id}/permissions`,
      headers: { ...auth(context.token), "x-step-up-token": context.stepUpToken },
      payload: { code: "AUTH_LOGIN_OFF_DEVICE", reason: "home office aprovado" },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: "PERMISSION_GRANT" },
    });
    expect(entry?.reason).toBe("home office aprovado");
    expect(entry?.newData).toMatchObject({
      permission: "AUTH_LOGIN_OFF_DEVICE",
      targetEmployeeCode: context.seller.employeeCode,
    });
  });
});

/** Limpa o cache de permissões para o teste ver o efeito imediato. */
async function invalidateCache(userId: string) {
  const { invalidatePermissionCache } = await import(
    "../../src/core/rbac/permissions.engine.js"
  );
  await invalidatePermissionCache(userId);
}
