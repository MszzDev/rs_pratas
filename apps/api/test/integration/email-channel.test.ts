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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function authenticate(employeeCode: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: employeeCode, password },
  });
  return response.json().accessToken as string;
}

async function ownerToken() {
  const company = await createTestCompany();
  const { user, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  return { company, token: await authenticate(user.employeeCode, password) };
}

describe("e-mail é canal de contato, nunca de login", () => {
  it("guarda o e-mail informado no cadastro", async () => {
    const { token } = await ownerToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: { name: "Ana Souza", role: "VENDEDOR", email: "ana@exemplo.com", storeIds: [] },
    });

    expect(response.statusCode).toBe(201);

    const stored = await prisma.user.findFirstOrThrow({ where: { name: "Ana Souza" } });
    expect(stored.email).toBe("ana@exemplo.com");
  });

  it("a senha temporária volta na resposta mesmo com e-mail cadastrado", async () => {
    const { token } = await ownerToken();

    const body = (
      await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: auth(token),
        payload: { name: "Bruno Lima", role: "VENDEDOR", email: "bruno@exemplo.com", storeIds: [] },
      })
    ).json();

    // A entrega em mãos continua sendo a garantia: e-mail atrasa, cai em spam,
    // ou o endereço está errado.
    expect(body.temporaryPassword).toBeTypeOf("string");
    expect(body.temporaryPassword.length).toBeGreaterThan(8);
    expect(body.user.employeeCode).toMatch(/^RS\d+$/);
  });

  it("NÃO autentica com o e-mail — só com a matrícula", async () => {
    const { token } = await ownerToken();

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: auth(token),
        payload: { name: "Carla Reis", role: "VENDEDOR", email: "carla@exemplo.com", storeIds: [] },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: "carla@exemplo.com", password: created.temporaryPassword },
    });

    expect(response.statusCode).toBe(401);
  });

  it("recusa e-mail malformado em vez de guardar lixo", async () => {
    const { token } = await ownerToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: auth(token),
      payload: { name: "Diego Alves", role: "VENDEDOR", email: "nao-e-email", storeIds: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it("o dono consegue apagar o e-mail cadastrado", async () => {
    const { token } = await ownerToken();

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: auth(token),
        payload: { name: "Elis Nunes", role: "VENDEDOR", email: "elis@exemplo.com", storeIds: [] },
      })
    ).json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${created.user.id}`,
      headers: auth(token),
      payload: { email: "" },
    });

    expect(response.statusCode).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
    expect(stored.email).toBeNull();
  });

  it("registra na auditoria se a credencial saiu por e-mail", async () => {
    const { company, token } = await ownerToken();

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: auth(token),
        payload: { name: "Fabio Melo", role: "VENDEDOR", email: "fabio@exemplo.com", storeIds: [] },
      })
    ).json();

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: company.id, action: "USER_CREATE", entityId: created.user.id },
    });

    const newData = entry.newData as Record<string, unknown>;
    expect(newData.email).toBe("fabio@exemplo.com");
    // O transporte de teste é o "log", que não envia de verdade — o registro
    // precisa dizer isso, e não fingir que houve entrega.
    expect(newData).toHaveProperty("credentialsEmailSent");
  });
});
