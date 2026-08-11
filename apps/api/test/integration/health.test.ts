import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, disconnectAll } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectAll();
});

describe("health checks", () => {
  it("/health responde sem tocar em dependência externa", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("/health/ready consulta banco e cache de verdade", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.database).toBe("ok");
    expect(body.cache).toBe("ok");
    expect(body.status).toBe("ok");
  });

  it("rota inexistente responde com mensagem amigável, sem detalhe técnico", async () => {
    const response = await app.inject({ method: "GET", url: "/rota-que-nao-existe" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
    expect(response.json().error.message).not.toMatch(/stack|Error:|at \w+/);
  });

  it("não expõe cabeçalho revelando a tecnologia do servidor", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("aplica os cabeçalhos de segurança do helmet", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeDefined();
  });
});
