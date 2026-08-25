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

const listAudit = (token: string, query = "") =>
  app.inject({ method: "GET", url: `/api/v1/audit${query}`, headers: auth(token) });

describe("auditoria legível", () => {
  it("agrupa por assunto e conta o que mudou, campo a campo", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    const token = await authenticate(owner.employeeCode, password);

    // Uma alteração de loja: é o tipo de mudança que leva alguém à auditoria
    // perguntando "quem mexeu nisto?".
    await app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${store.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Loja Centro Renomeada", phone: "1140028922" },
    });

    const resposta = await app.inject({
      method: "GET",
      url: "/api/v1/audit?topic=pessoas",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resposta.statusCode).toBe(200);

    // O assunto "pessoas" traz o login do dono, não a alteração da loja.
    const acoes = resposta.json().entries.map((entry: { action: string }) => entry.action);
    expect(acoes).toContain("LOGIN_SUCCESS");
    expect(acoes).not.toContain("STORE_UPDATE");

    const tudo = await app.inject({
      method: "GET",
      url: "/api/v1/audit",
      headers: { authorization: `Bearer ${token}` },
    });

    const alteracao = tudo
      .json()
      .entries.find((entry: { action: string }) => entry.action === "STORE_UPDATE");

    expect(alteracao).toBeDefined();

    const campos = alteracao.changes.map((mudanca: { campo: string }) => mudanca.campo);
    expect(campos).toContain("name");

    // Identificadores e credenciais ficam de fora do "antes e depois": não
    // dizem nada a quem lê, e credencial não circula nem como histórico.
    expect(campos.some((campo: string) => campo.endsWith("Id"))).toBe(false);
    expect(JSON.stringify(alteracao.changes)).not.toContain("Hash");
  });
});

describe("consulta de auditoria", () => {
  it("o dono enxerga os registros da empresa", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    const token = await authenticate(owner.employeeCode, password);
    const response = await listAudit(token);

    expect(response.statusCode).toBe(200);
    // O próprio login já gerou registro.
    expect(response.json().entries.length).toBeGreaterThan(0);
  });

  it("o vendedor não alcança a auditoria", async () => {
    const company = await createTestCompany();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });

    const token = await authenticate(seller.employeeCode, password);
    const response = await listAudit(token);

    expect(response.statusCode).toBe(403);
  });

  it("o gerente vê só o que aconteceu na loja dele", async () => {
    const company = await createTestCompany();
    const storeA = await createTestStore(company.id, "LA");
    const storeB = await createTestStore(company.id, "LB");

    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    await prisma.userStore.create({ data: { userId: manager.id, storeId: storeA.id } });

    // Um registro em cada loja.
    await prisma.auditLog.createMany({
      data: [
        { action: "STORE_UPDATE", result: "SUCCESS", companyId: company.id, storeId: storeA.id },
        { action: "STORE_UPDATE", result: "SUCCESS", companyId: company.id, storeId: storeB.id },
      ],
    });

    const token = await authenticate(manager.employeeCode, password);
    const entries = (await listAudit(token)).json().entries as Array<{ storeId: string | null }>;

    expect(entries.every((entry) => entry.storeId === storeA.id)).toBe(true);
  });

  it("não vaza auditoria de outra empresa nem com filtro explícito", async () => {
    const companyA = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: companyA.id,
      role: "DONO",
    });

    const companyB = await createTestCompany("Concorrente");
    const storeB = await createTestStore(companyB.id, "X1");
    await prisma.auditLog.create({
      data: {
        action: "STORE_CREATE",
        result: "SUCCESS",
        companyId: companyB.id,
        storeId: storeB.id,
        reason: "segredo da concorrente",
      },
    });

    const token = await authenticate(owner.employeeCode, password);
    const entries = (await listAudit(token, `?storeId=${storeB.id}`)).json().entries as Array<{
      reason: string | null;
    }>;

    expect(entries).toHaveLength(0);
  });

  it("filtra por resultado", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    await prisma.auditLog.create({
      data: { action: "PERMISSION_DENIED", result: "DENIED", companyId: company.id },
    });

    const token = await authenticate(owner.employeeCode, password);
    const entries = (await listAudit(token, "?result=DENIED")).json().entries as Array<{
      result: string;
    }>;

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.result === "DENIED")).toBe(true);
  });

  it("pagina por cursor sem repetir registros", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    await prisma.auditLog.createMany({
      data: Array.from({ length: 8 }, () => ({
        action: "SETTING_UPDATE" as const,
        result: "SUCCESS" as const,
        companyId: company.id,
      })),
    });

    const token = await authenticate(owner.employeeCode, password);

    const first = (await listAudit(token, "?limit=5")).json();
    expect(first.entries).toHaveLength(5);
    expect(first.nextCursor).toBeTypeOf("string");

    const second = (await listAudit(token, `?limit=5&cursor=${first.nextCursor}`)).json();

    const firstIds = new Set(first.entries.map((entry: { id: string }) => entry.id));
    const repetidos = second.entries.filter((entry: { id: string }) => firstIds.has(entry.id));
    expect(repetidos).toHaveLength(0);
  });

  it("não existe rota para alterar nem apagar auditoria", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const entry = await prisma.auditLog.create({
      data: { action: "LOGIN_SUCCESS", result: "SUCCESS", companyId: company.id },
    });

    for (const method of ["DELETE", "PATCH", "PUT"] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/audit/${entry.id}`,
        headers: auth(token),
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
