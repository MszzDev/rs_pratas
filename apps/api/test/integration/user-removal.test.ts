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

/**
 * Tirar um funcionário do sistema.
 *
 * A regra que estes testes seguram separa "cadastro errado" de "pessoa que
 * trabalhou aqui". A conta criada por engano, a de demonstração e a que nunca
 * foi ativada não contam história nenhuma — e, enquanto existem, são acessos
 * ao sistema real sem dono. Essas somem de vez.
 *
 * Quem bateu ponto, vendeu ou conferiu caixa não some, e a razão não é de
 * projeto: o ponto tem valor legal por anos depois da saída, a venda continua
 * no faturamento, e a auditoria precisa continuar respondendo quem fez o quê.
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

async function cenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: dono, password } = await createTestUser({ companyId: company.id, role: "DONO" });

  const token = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: dono.employeeCode, password },
    })
  ).json().accessToken as string;

  return { company, store, dono, token };
}

function remover(token: string, userId: string) {
  return app.inject({
    method: "DELETE",
    url: `/api/v1/users/${userId}`,
    headers: auth(token),
    payload: { reason: "conta criada por engano" },
  });
}

describe("remover funcionário", () => {
  it("apaga de vez quem nunca registrou nada", async () => {
    const { company, store, token } = await cenario();
    const { user: novato } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    await prisma.userStore.create({ data: { userId: novato.id, storeId: store.id } });

    const resposta = await remover(token, novato.id);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().removido).toBe("apagado");

    const sumiu = await prisma.user.findUnique({ where: { id: novato.id } });
    expect(sumiu).toBeNull();

    // Os vínculos vão junto: eles só existiam por causa dela.
    expect(await prisma.userStore.count({ where: { userId: novato.id } })).toBe(0);
  });

  /**
   * O registro do ato sobrevive à pessoa.
   *
   * É o que responde, meses depois, "existia uma matrícula RS000300 aqui?" —
   * e a resposta precisa existir mesmo quando o cadastro não existe mais.
   */
  it("deixa na auditoria o registro de quem foi apagado", async () => {
    const { company, token } = await cenario();
    const { user: novato } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });

    await remover(token, novato.id);

    const registro = await prisma.auditLog.findFirst({
      where: { entityType: "User", entityId: novato.id },
      orderBy: { createdAt: "desc" },
    });

    expect(registro).not.toBeNull();
    expect(registro?.reason).toBe("conta criada por engano");
    expect(registro?.newData).toMatchObject({ removido: "apagado" });
  });

  it("desativa, em vez de apagar, quem já bateu ponto", async () => {
    const { company, store, token } = await cenario();
    const { user: vendedora } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });

    const estacao = await prisma.pOSStation.create({
      data: { storeId: store.id, code: "E01", name: "Estação 1" },
    });
    const caixa = await prisma.cashRegister.create({
      data: { posStationId: estacao.id, code: "C01", name: "Caixa 1" },
    });
    const device = await prisma.device.create({
      data: {
        companyId: company.id,
        storeId: store.id,
        cashRegisterId: caixa.id,
        name: "Balcão",
        status: "ACTIVE",
      },
    });

    await prisma.timeClockEntry.create({
      data: {
        userId: vendedora.id,
        companyId: company.id,
        storeId: store.id,
        deviceId: device.id,
        type: "CLOCK_IN",
        timestamp: new Date(),
      },
    });

    const resposta = await remover(token, vendedora.id);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().removido).toBe("desativado");
    expect(resposta.json().mensagem).toContain("ponto");

    const guardada = await prisma.user.findUnique({ where: { id: vendedora.id } });
    expect(guardada).not.toBeNull();
    expect(guardada?.status).toBe("INACTIVE");
    expect(guardada?.deletedAt).not.toBeNull();

    // E o ponto continua lá: é ele que a lei manda guardar.
    expect(await prisma.timeClockEntry.count({ where: { userId: vendedora.id } })).toBe(1);
  });

  it("não deixa o dono remover a si mesmo", async () => {
    const { dono, token } = await cenario();

    const resposta = await remover(token, dono.id);

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json().error.code).toBe("SELF_REMOVAL");
  });

  it("não deixa o sistema ficar sem dono ativo", async () => {
    const { company, token } = await cenario();
    const { user: outroDono } = await createTestUser({ companyId: company.id, role: "DONO" });

    // O primeiro sai: ainda sobra um.
    expect((await remover(token, outroDono.id)).statusCode).toBe(200);

    // Agora só resta quem está pedindo — e ele não pode remover a si mesmo.
    const sozinho = await prisma.user.count({
      where: { companyId: company.id, role: "DONO", deletedAt: null, status: "ACTIVE" },
    });
    expect(sozinho).toBe(1);
  });
});
