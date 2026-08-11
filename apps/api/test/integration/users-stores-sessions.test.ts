import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TOTP, Secret } from "otpauth";
import { prisma } from "../../src/db/prisma.js";
import { decryptSecret } from "../../src/core/security/totp.service.js";
import { clearSentEmails, sentEmails } from "../../src/core/email/index.js";
import {
  createTestApp,
  createTestCompany,
  createTestStore,
  createTestUser,
  disconnectAll,
  grantOffDeviceAccess,
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

async function ownerContext() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.email!, password);
  return { company, store, owner, password, token };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("criação de usuário pelo dono", () => {
  it("gera matrícula RS + número e senha temporária, e envia por e-mail", async () => {
    const { token, store } = await ownerContext();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: {
        name: "Maria Vendedora",
        email: "maria@rspratas.com.br",
        role: "VENDEDOR",
        storeIds: [store.id],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body.user.employeeCode).toMatch(/^RS\d{6}$/);
    expect(body.welcomeEmailDelivered).toBe(true);
    expect(body.user.status).toBe("PENDING_FIRST_ACCESS");

    // A senha temporária nunca volta na resposta da API — só vai por e-mail.
    expect(JSON.stringify(body)).not.toContain("temporaryPassword");

    const created = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id } });
    expect(created.mustChangePassword).toBe(true);
    expect(created.mustCreatePin).toBe(true);
    expect(created.passwordHash).not.toBeNull();

    const links = await prisma.userStore.findMany({ where: { userId: created.id } });
    expect(links.map((link) => link.storeId)).toEqual([store.id]);
  });

  it("gera matrículas distintas para usuários diferentes", async () => {
    const { token, store } = await ownerContext();
    const codes = new Set<string>();

    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: auth(token),
        payload: {
          name: `Funcionário ${index}`,
          email: `func${index}@rspratas.com.br`,
          role: "VENDEDOR",
          storeIds: [store.id],
        },
      });
      codes.add(response.json().user.employeeCode);
    }

    expect(codes.size).toBe(5);
  });

  it("recusa e-mail já cadastrado", async () => {
    const { token, store } = await ownerContext();
    const payload = {
      name: "Duplicado",
      email: "duplicado@rspratas.com.br",
      role: "VENDEDOR",
      storeIds: [store.id],
    };

    await app.inject({ method: "POST", url: "/api/v1/users", headers: auth(token), payload });
    const segunda = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload,
    });

    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.code).toBe("EMAIL_TAKEN");
  });

  it("gerente não pode criar usuário", async () => {
    const { company, store } = await ownerContext();
    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
    const token = await authenticate(manager.email!, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: { name: "Alguém", email: "alguem@x.com", role: "VENDEDOR", storeIds: [] },
    });

    expect(response.statusCode).toBe(403);
  });

  it("o e-mail entregue traz a matrícula e a senha temporária", async () => {
    const { token, store } = await ownerContext();
    clearSentEmails();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: {
        name: "Novo Funcionário",
        email: "novo@rspratas.com.br",
        role: "VENDEDOR",
        storeIds: [store.id],
      },
    });
    const employeeCode = created.json().user.employeeCode as string;

    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0]!;
    expect(email.to).toBe("novo@rspratas.com.br");
    expect(email.text).toContain(employeeCode);
    expect(email.text).toMatch(/Senha temporária: \S+/);
  });

  it("o funcionário criado percorre o primeiro acesso com as credenciais recebidas", async () => {
    const { token, store } = await ownerContext();
    clearSentEmails();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: {
        name: "Fluxo Completo",
        email: "fluxo@rspratas.com.br",
        role: "VENDEDOR",
        storeIds: [store.id],
      },
    });
    const employeeCode = created.json().user.employeeCode as string;

    // Este teste é sobre as credenciais entregues por e-mail, não sobre a regra
    // de "só no tablet" — liberamos o acesso remoto para poder validar o login
    // final sem montar loja, estação, caixa e tablet.
    await grantOffDeviceAccess(created.json().user.id as string);

    const temporaryPassword = /Senha temporária: (\S+)/.exec(sentEmails[0]!.text)![1]!;

    // Entrar pela tela normal ainda não funciona: a conta exige o primeiro acesso.
    const loginDireto = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: employeeCode, password: temporaryPassword },
    });
    expect(loginDireto.json().error.code).toBe("FIRST_ACCESS_REQUIRED");

    const start = await app.inject({
      method: "POST",
      url: "/api/v1/auth/first-access/start",
      payload: { identifier: employeeCode, tempPassword: temporaryPassword },
    });
    expect(start.statusCode).toBe(200);
    const { onboardingToken } = start.json();

    const novaSenha = "senha-escolhida-pelo-func";
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/first-access/set-password",
      payload: { onboardingToken, newPassword: novaSenha, confirmPassword: novaSenha },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/first-access/set-pin",
      payload: { onboardingToken, pin: "4821", confirmPin: "4821" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/first-access/complete",
      payload: { onboardingToken },
    });

    // Agora entra com a senha própria — e a temporária deixou de valer.
    const comNova = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: employeeCode, password: novaSenha },
    });
    expect(comNova.statusCode).toBe(200);

    const comTemporaria = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: employeeCode, password: temporaryPassword },
    });
    expect(comTemporaria.statusCode).toBe(401);
  });
});

describe("reenvio de credenciais", () => {
  it("gera uma senha nova, invalidando a anterior", async () => {
    const { token, store } = await ownerContext();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: {
        name: "Esqueceu",
        email: "esqueceu@rspratas.com.br",
        role: "VENDEDOR",
        storeIds: [store.id],
      },
    });
    const userId = created.json().user.id;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const resend = await app.inject({
      method: "POST",
      url: `/api/v1/users/${userId}/resend-credentials`,
      headers: auth(token),
    });

    expect(resend.statusCode).toBe(200);
    expect(resend.json().delivered).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
  });

  it("recusa reenvio para quem já concluiu o primeiro acesso", async () => {
    const { token, company } = await ownerContext();
    const { user: active } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${active.id}/resend-credentials`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("FIRST_ACCESS_ALREADY_DONE");
  });
});

describe("bloqueio de usuário", () => {
  it("bloqueia, derruba as sessões ativas e audita", async () => {
    const { token, company, store } = await ownerContext();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    const sellerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: seller.email, password },
    });
    const sellerTokens = sellerLogin.json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${seller.id}/block`,
      headers: auth(token),
      payload: { reason: "afastamento disciplinar" },
    });
    expect(response.statusCode).toBe(200);

    // A sessão que já estava aberta morre imediatamente.
    const afterBlock = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: sellerTokens.refreshToken },
    });
    expect(afterBlock.statusCode).not.toBe(200);

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: seller.id, action: "USER_BLOCK" },
    });
    expect(entry?.reason).toBe("afastamento disciplinar");
  });

  it("o dono não pode bloquear a si mesmo", async () => {
    const { token, owner } = await ownerContext();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${owner.id}/block`,
      headers: auth(token),
      payload: { reason: "teste" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CANNOT_BLOCK_SELF");
  });
});

describe("mudança de perfil exige reautenticação", () => {
  it("recusa sem step-up e aceita com step-up", async () => {
    const { token, company, store, owner } = await ownerContext();
    const { user: seller } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    const semStepUp = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${seller.id}/role`,
      headers: auth(token),
      payload: { role: "GERENTE", reason: "promoção" },
    });
    expect(semStepUp.statusCode).toBe(403);
    expect(semStepUp.json().error.code).toBe("STEP_UP_REQUIRED");

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: auth(token),
      payload: {
        purpose: "CREATE_OR_PROMOTE_OWNER",
        totpCode: await currentTotpCode(owner.id, owner.email!),
      },
    });

    const comStepUp = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${seller.id}/role`,
      headers: { ...auth(token), "x-step-up-token": stepUp.json().stepUpToken },
      payload: { role: "GERENTE", reason: "promoção após avaliação" },
    });

    expect(comStepUp.statusCode).toBe(200);
    expect(comStepUp.json().role).toBe("GERENTE");

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: seller.id, action: "USER_ROLE_CHANGE" },
    });
    expect(entry?.reason).toBe("promoção após avaliação");
  });

  it("o dono não pode alterar o próprio perfil", async () => {
    const { token, owner } = await ownerContext();

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: auth(token),
      payload: {
        purpose: "CREATE_OR_PROMOTE_OWNER",
        totpCode: await currentTotpCode(owner.id, owner.email!),
      },
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${owner.id}/role`,
      headers: { ...auth(token), "x-step-up-token": stepUp.json().stepUpToken },
      payload: { role: "VENDEDOR", reason: "tentativa" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CANNOT_CHANGE_OWN_ROLE");
  });
});

describe("lojas", () => {
  it("dono cria loja e o código é único na empresa", async () => {
    const { token } = await ownerContext();

    const criada = await app.inject({
      method: "POST",
      url: "/api/v1/stores",
      headers: auth(token),
      payload: { code: "SA01", name: "Loja Santo Amaro" },
    });
    expect(criada.statusCode).toBe(201);

    const duplicada = await app.inject({
      method: "POST",
      url: "/api/v1/stores",
      headers: auth(token),
      payload: { code: "SA01", name: "Outra" },
    });
    expect(duplicada.statusCode).toBe(409);
  });

  it("vendedor só enxerga as lojas às quais tem acesso", async () => {
    const { company, store } = await ownerContext();
    await createTestStore(company.id, "L99");

    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });
    const token = await authenticate(seller.email!, password);

    const response = await app.inject({ method: "GET", url: "/api/v1/stores", headers: auth(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].id).toBe(store.id);
  });

  it("desativar loja é soft delete e exige step-up", async () => {
    const { token, store, owner } = await ownerContext();

    const semStepUp = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/deactivate`,
      headers: auth(token),
      payload: { reason: "encerramento da unidade" },
    });
    expect(semStepUp.statusCode).toBe(403);

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/step-up",
      headers: auth(token),
      payload: {
        purpose: "DEACTIVATE_STORE",
        totpCode: await currentTotpCode(owner.id, owner.email!),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/deactivate`,
      headers: { ...auth(token), "x-step-up-token": stepUp.json().stepUpToken },
      payload: { reason: "encerramento da unidade" },
    });
    expect(response.statusCode).toBe(200);

    // Soft delete: a linha continua no banco, com o histórico intacto.
    const stored = await prisma.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.isActive).toBe(false);
  });
});

describe("gestão de sessões", () => {
  it("lista as sessões ativas e identifica a atual", async () => {
    const { company, store } = await ownerContext();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    await authenticate(seller.email!, password);
    const currentToken = await authenticate(seller.email!, password);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: auth(currentToken),
    });

    expect(response.statusCode).toBe(200);
    const sessions = response.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session: { current: boolean }) => session.current)).toHaveLength(1);
  });

  it("encerra uma sessão específica e o refresh dela para de funcionar", async () => {
    const { company, store } = await ownerContext();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    const antiga = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login/password",
        payload: { identifier: seller.email, password },
      })
    ).json();
    const atual = await authenticate(seller.email!, password);

    const sessions = (
      await app.inject({
        method: "GET",
        url: "/api/v1/auth/sessions",
        headers: auth(atual),
      })
    ).json() as Array<{ id: string; current: boolean }>;

    const outra = sessions.find((session) => !session.current)!;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${outra.id}`,
      headers: auth(atual),
    });
    expect(response.statusCode).toBe(204);

    const afterRevoke = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: antiga.refreshToken },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("não permite encerrar a sessão de outro usuário", async () => {
    const { company, store } = await ownerContext();

    const { user: a, password: passwordA } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    const { user: b, password: passwordB } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.createMany({
      data: [
        { userId: a.id, storeId: store.id },
        { userId: b.id, storeId: store.id },
      ],
    });

    await authenticate(b.email!, passwordB);
    const sessionOfB = await prisma.deviceSession.findFirstOrThrow({ where: { userId: b.id } });

    const tokenA = await authenticate(a.email!, passwordA);
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${sessionOfB.id}`,
      headers: auth(tokenA),
    });

    // 404 e não 403 — confirmar a existência da sessão alheia já vazaria informação.
    expect(response.statusCode).toBe(404);
  });
});
