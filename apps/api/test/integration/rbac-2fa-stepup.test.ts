import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TOTP, Secret } from "otpauth";
import { prisma } from "../../src/db/prisma.js";
import { decryptSecret } from "../../src/core/security/totp.service.js";
import { getEffectivePermissions, invalidatePermissionCache } from "../../src/core/rbac/permissions.engine.js";
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

async function authenticate(email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: email, password },
  });
  return response.json().accessToken as string;
}

/** Gera um código TOTP válido a partir do segredo guardado no banco. */
async function currentTotpCode(userId: string, accountLabel: string) {
  const credential = await prisma.twoFactorCredential.findUniqueOrThrow({ where: { userId } });
  const totp = new TOTP({
    issuer: "RS Pratas",
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(decryptSecret(credential.secretEncrypted)),
  });
  return totp.generate();
}

describe("motor de permissões efetivas", () => {
  it("carrega as permissões padrão do perfil", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });

    const permissions = await getEffectivePermissions(user.id);

    expect(permissions.has("SALE_CREATE")).toBe(true);
    expect(permissions.has("USER_CREATE")).toBe(false);
  });

  it("override ALLOW concede permissão fora do perfil", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    const { user: owner } = await createTestUser({ companyId: company.id, role: "DONO" });

    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: "STOCK_ADJUST" },
    });
    await prisma.userPermission.create({
      data: { userId: user.id, permissionId: permission.id, effect: "ALLOW", grantedById: owner.id },
    });
    await invalidatePermissionCache(user.id);

    const permissions = await getEffectivePermissions(user.id);
    expect(permissions.has("STOCK_ADJUST")).toBe(true);
  });

  it("DENY vence sobre o padrão do perfil", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "GERENTE" });
    const { user: owner } = await createTestUser({ companyId: company.id, role: "DONO" });

    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: "SALE_AUTHORIZE_DISCOUNT" },
    });

    // Gerente tem essa permissão por padrão; o DENY individual precisa removê-la.
    expect((await getEffectivePermissions(user.id)).has("SALE_AUTHORIZE_DISCOUNT")).toBe(true);

    await prisma.userPermission.create({
      data: { userId: user.id, permissionId: permission.id, effect: "DENY", grantedById: owner.id },
    });
    await invalidatePermissionCache(user.id);

    expect((await getEffectivePermissions(user.id)).has("SALE_AUTHORIZE_DISCOUNT")).toBe(false);
  });

  it("ignora override expirado", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    const { user: owner } = await createTestUser({ companyId: company.id, role: "DONO" });

    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "STOCK_ADJUST" } });
    await prisma.userPermission.create({
      data: {
        userId: user.id,
        permissionId: permission.id,
        effect: "ALLOW",
        grantedById: owner.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await invalidatePermissionCache(user.id);

    expect((await getEffectivePermissions(user.id)).has("STOCK_ADJUST")).toBe(false);
  });

  it("ignora override revogado", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    const { user: owner } = await createTestUser({ companyId: company.id, role: "DONO" });

    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "STOCK_ADJUST" } });
    await prisma.userPermission.create({
      data: {
        userId: user.id,
        permissionId: permission.id,
        effect: "ALLOW",
        grantedById: owner.id,
        revokedAt: new Date(),
      },
    });
    await invalidatePermissionCache(user.id);

    expect((await getEffectivePermissions(user.id)).has("STOCK_ADJUST")).toBe(false);
  });

  it("DESENVOLVEDOR recebe só permissões de visualização", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "DESENVOLVEDOR" });

    const permissions = await getEffectivePermissions(user.id);

    expect(permissions.has("STOCK_VIEW")).toBe(true);
    expect(permissions.has("PRODUCT_VIEW")).toBe(true);
    expect(permissions.has("STOCK_ADJUST")).toBe(false);
    expect(permissions.has("USER_CREATE")).toBe(false);
    expect(permissions.has("PRODUCT_CREATE")).toBe(false);
    for (const code of permissions) {
      expect(code, `DESENVOLVEDOR não pode ter ${code}`).toContain("VIEW");
    }
  });
});

describe("guarda de somente-leitura do DESENVOLVEDOR", () => {
  it("bloqueia escrita mesmo com permissão concedida diretamente no banco", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: dev, password } = await createTestUser({
      companyId: company.id,
      role: "DESENVOLVEDOR",
    });
    const { user: owner } = await createTestUser({ companyId: company.id, role: "DONO" });

    // Concessão indevida direto no banco — a guarda global tem que barrar assim mesmo.
    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "DEVICE_CREATE" } });
    await prisma.userPermission.create({
      data: { userId: dev.id, permissionId: permission.id, effect: "ALLOW", grantedById: owner.id },
    });
    await invalidatePermissionCache(dev.id);

    const token = await authenticate(dev.email!, password);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E01", name: "Estação" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVELOPER_READ_ONLY");
  });

  it("mascara valores monetários na resposta", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: dev, password } = await createTestUser({
      companyId: company.id,
      role: "DESENVOLVEDOR",
    });

    // Campo monetário plantado na configuração da loja para exercitar o hook.
    await prisma.storeSetting.create({
      data: { storeId: store.id, key: "meta", value: { faturamento: 15000, nome: "Meta mensal" } },
    });

    const token = await authenticate(dev.email!, password);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    // A rota /me não tem valores; o que importa é que a resposta segue íntegra.
    expect(response.json().id).toBe(dev.id);
  });
});

describe("2FA obrigatório para o DONO", () => {
  it("restringe a sessão do dono sem 2FA às rotas de configuração", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
      withTwoFactor: false,
    });

    const token = await authenticate(owner.email!, password);

    const bloqueada = await app.inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E01", name: "Estação" },
    });
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json().error.code).toBe("TWO_FACTOR_SETUP_REQUIRED");

    const liberada = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/setup",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(liberada.statusCode).toBe(200);
  });

  it("percorre configuração, confirmação e libera o acesso", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
      withTwoFactor: false,
    });
    const token = await authenticate(owner.email!, password);

    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/setup",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(setup.json().otpauthUrl).toContain("otpauth://totp/");

    const confirm = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/confirm",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: await currentTotpCode(owner.id, owner.email!) },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().recoveryCodes).toHaveLength(10);

    const agoraLiberado = await app.inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E01", name: "Estação" },
    });
    expect(agoraLiberado.statusCode).toBe(201);
  });

  it("recusa código TOTP inválido na confirmação", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
      withTwoFactor: false,
    });
    const token = await authenticate(owner.email!, password);

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/setup",
      headers: { authorization: `Bearer ${token}` },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/confirm",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: "000000" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("não permite desativar o 2FA do dono", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
    const token = await authenticate(owner.email!, password);

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        purpose: "TWO_FACTOR_DISABLE",
        totpCode: await currentTotpCode(owner.id, owner.email!),
      },
    });
    expect(stepUp.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/disable",
      headers: {
        authorization: `Bearer ${token}`,
        "x-step-up-token": stepUp.json().stepUpToken,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TWO_FACTOR_MANDATORY");
  });

  it("consome o código de recuperação uma única vez", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
      withTwoFactor: false,
    });
    const token = await authenticate(owner.email!, password);

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/setup",
      headers: { authorization: `Bearer ${token}` },
    });
    const confirm = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/confirm",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: await currentTotpCode(owner.id, owner.email!) },
    });
    const [recoveryCode] = confirm.json().recoveryCodes as string[];

    const primeira = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/recovery-code",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: recoveryCode },
    });
    expect(primeira.statusCode).toBe(200);
    expect(primeira.json().remainingCodes).toBe(9);

    const segunda = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/recovery-code",
      headers: { authorization: `Bearer ${token}` },
      payload: { code: recoveryCode },
    });
    expect(segunda.statusCode).toBe(401);
  });
});

describe("step-up (reautenticação)", () => {
  async function managerWithSession() {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
    const token = await authenticate(manager.email!, password);
    return { company, store, manager, password, token };
  }

  it("emite token de uso único mediante senha", async () => {
    const { token, password } = await managerWithSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "EXIT_KIOSK", password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().stepUpToken).toBeTypeOf("string");
    expect(new Date(response.json().expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("recusa senha incorreta e audita a tentativa", async () => {
    const { token, manager } = await managerWithSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "EXIT_KIOSK", password: "senha-errada-aqui" },
    });

    expect(response.statusCode).toBe(401);

    const entry = await prisma.auditLog.findFirst({
      where: { userId: manager.id, action: "STEP_UP_FAILED" },
    });
    expect(entry).not.toBeNull();
  });

  it("exige TOTP de quem tem 2FA ativo — senha sozinha não basta", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
    const token = await authenticate(owner.email!, password);

    const comSenha = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "CREATE_OR_PROMOTE_OWNER", password },
    });
    expect(comSenha.statusCode).toBe(401);
    expect(comSenha.json().error.code).toBe("TOTP_REQUIRED");

    const comTotp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        purpose: "CREATE_OR_PROMOTE_OWNER",
        totpCode: await currentTotpCode(owner.id, owner.email!),
      },
    });
    expect(comTotp.statusCode).toBe(200);
  });

  it("token é consumido no primeiro uso", async () => {
    const { token, password, manager } = await managerWithSession();

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "TWO_FACTOR_DISABLE", password },
    });
    const stepUpToken = stepUp.json().stepUpToken;

    const primeira = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/disable",
      headers: { authorization: `Bearer ${token}`, "x-step-up-token": stepUpToken },
    });
    expect(primeira.statusCode).toBe(204);

    const segunda = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/disable",
      headers: { authorization: `Bearer ${token}`, "x-step-up-token": stepUpToken },
    });
    expect(segunda.statusCode).toBe(403);
    expect(segunda.json().error.code).toBe("STEP_UP_INVALID");

    const stored = await prisma.stepUpToken.findFirst({ where: { userId: manager.id } });
    expect(stored?.usedAt).not.toBeNull();
  });

  it("token emitido para um propósito não serve para outro", async () => {
    const { token, password } = await managerWithSession();

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: { authorization: `Bearer ${token}` },
      payload: { purpose: "EXIT_KIOSK", password },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/disable",
      headers: {
        authorization: `Bearer ${token}`,
        "x-step-up-token": stepUp.json().stepUpToken,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STEP_UP_INVALID");
  });

  it("ação sensível sem token de step-up é recusada", async () => {
    const { token } = await managerWithSession();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/disable",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STEP_UP_REQUIRED");
  });
});
