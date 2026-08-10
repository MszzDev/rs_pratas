import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import {
  createTestApp,
  createTestCompany,
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

async function login(identifier: string, password: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier, password },
  });
}

describe("POST /api/v1/auth/login/password", () => {
  it("autentica com e-mail e senha corretos e devolve o par de tokens", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });

    const response = await login(user.email!, password);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toBeTypeOf("string");
    expect(body.user.id).toBe(user.id);
    expect(body.user.role).toBe("VENDEDOR");
    // Nenhum hash pode escapar na resposta.
    expect(JSON.stringify(body)).not.toContain("$argon2");
  });

  it("aceita matrícula no lugar do e-mail", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({
      companyId: company.id,
      employeeCode: "0042",
    });

    const response = await login("0042", password);
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(user.id);
  });

  it("rejeita senha incorreta sem revelar que a conta existe", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id });

    const wrongPassword = await login(user.email!, "senha-errada-aqui");
    const unknownUser = await login("naoexiste@teste.local", "senha-errada-aqui");

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    // Mesma mensagem nos dois casos — não serve como oráculo de enumeração.
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message);
  });

  it("bloqueia a conta após o limite de tentativas e audita cada falha", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login(user.email!, "senha-errada");
      expect(response.statusCode).toBe(401);
    }

    // 6ª tentativa: agora bloqueado, e mesmo a senha CORRETA é recusada.
    const afterLock = await login(user.email!, password);
    expect(afterLock.statusCode).toBe(429);
    expect(afterLock.json().error.code).toBe("ACCOUNT_LOCKED");

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.passwordLockedUntil).not.toBeNull();

    const failures = await prisma.auditLog.count({
      where: { userId: user.id, action: "LOGIN_FAILED" },
    });
    expect(failures).toBeGreaterThanOrEqual(5);
  });

  it("recusa usuário bloqueado mesmo com a senha correta", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({
      companyId: company.id,
      status: "BLOCKED",
    });

    const response = await login(user.email!, password);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("USER_BLOCKED");
  });

  it("direciona ao primeiro acesso quando a conta ainda não foi ativada", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({
      companyId: company.id,
      status: "PENDING_FIRST_ACCESS",
    });

    const response = await login(user.email!, password);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("FIRST_ACCESS_REQUIRED");
  });

  it("registra o login bem-sucedido na auditoria", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });

    await login(user.email!, password);

    const entry = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "LOGIN_SUCCESS" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.result).toBe("SUCCESS");
    expect(entry?.userRoleSnapshot).toBe("VENDEDOR");
  });

  it("nunca grava o refresh token em claro no banco", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });

    const { refreshToken } = (await login(user.email!, password)).json();

    const stored = await prisma.refreshToken.findFirst();
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toBe(refreshToken);
    expect(stored?.tokenHash).toHaveLength(64);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  async function loggedInUser() {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });
    const tokens = (await login(user.email!, password)).json();
    return { user, tokens };
  }

  const refresh = (refreshToken: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken } });

  it("rotaciona o token: devolve um novo e invalida o anterior", async () => {
    const { tokens } = await loggedInUser();

    const response = await refresh(tokens.refreshToken);
    expect(response.statusCode).toBe(200);

    const rotated = response.json();
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
    expect(rotated.accessToken).toBeTypeOf("string");
  });

  it("detecta reuso de token roubado e derruba a sessão inteira", async () => {
    const { user, tokens } = await loggedInUser();

    // Uso legítimo: rotaciona.
    const first = await refresh(tokens.refreshToken);
    expect(first.statusCode).toBe(200);
    const newToken = first.json().refreshToken;

    // Atacante reapresenta o token antigo (já rotacionado).
    const replay = await refresh(tokens.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("REFRESH_TOKEN_REUSED");

    // A sessão inteira cai — nem o token novo e legítimo sobrevive.
    const afterBreach = await refresh(newToken);
    expect(afterBreach.statusCode).toBe(401);

    const session = await prisma.deviceSession.findFirst({ where: { userId: user.id } });
    expect(session?.revokedAt).not.toBeNull();

    const alert = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "SESSION_REUSE_DETECTED" },
    });
    expect(alert).not.toBeNull();
  });

  it("rejeita token inexistente", async () => {
    const response = await refresh("token-que-nunca-existiu");
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("encadeia a rotação para permitir rastrear a linhagem do token", async () => {
    const { tokens } = await loggedInUser();
    await refresh(tokens.refreshToken);

    const chained = await prisma.refreshToken.findFirst({
      where: { rotatedFromId: { not: null } },
    });
    expect(chained).not.toBeNull();
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revoga a sessão e impede refresh posterior", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });
    const tokens = (await login(user.email!, password)).json();

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: tokens.refreshToken },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("é idempotente — token desconhecido não vira erro", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      payload: { refreshToken: "token-inexistente" },
    });
    expect(response.statusCode).toBe(204);
  });
});

describe("rotas autenticadas", () => {
  it("exige access token válido", async () => {
    const semToken = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(semToken.statusCode).toBe(401);

    const tokenInvalido = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer token.invalido.aqui" },
    });
    expect(tokenInvalido.statusCode).toBe(401);
  });

  it("aceita o access token emitido no login", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });
    const tokens = (await login(user.email!, password)).json();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(user.id);
    expect(response.json().companyId).toBe(company.id);
  });

  it("logout-all derruba todas as sessões do usuário", async () => {
    const company = await createTestCompany();
    const { user, password } = await createTestUser({ companyId: company.id });

    const first = (await login(user.email!, password)).json();
    const second = (await login(user.email!, password)).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout-all",
      headers: { authorization: `Bearer ${first.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().revokedSessions).toBe(2);

    for (const tokens of [first, second]) {
      const attempt = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: tokens.refreshToken },
      });
      expect(attempt.statusCode).toBe(401);
    }
  });
});
