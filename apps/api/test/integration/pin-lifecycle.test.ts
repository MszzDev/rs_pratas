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
 * A vida do PIN: vence em 30 dias, o funcionário troca sozinho, e quem
 * esqueceu pede um temporário ao responsável.
 *
 * O que estes testes seguram é a parte que não aparece na tela: pedir NÃO
 * concede — só o dono ou o gerente concedem; o PIN temporário nasce vencido,
 * para não valer trinta dias depois de ser dito em voz alta no balcão; e o PIN
 * nunca entra na auditoria, que é lida por mais gente que o banco.
 */

let app: FastifyInstance;

const PIN_ATUAL = "482913";
const PIN_NOVO = "573926";

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
  return response;
}

/** Funcionário com PIN válido, trocado há `diasAtras` dias. */
async function criarComPin(companyId: string, diasAtras: number, role: "VENDEDOR" | "GERENTE" = "VENDEDOR") {
  const { user, password } = await createTestUser({ companyId, role, pin: PIN_ATUAL });

  await prisma.user.update({
    where: { id: user.id },
    data: { pinChangedAt: new Date(Date.now() - diasAtras * 86_400_000) },
  });

  return { user, password };
}

describe("troca do próprio PIN", () => {
  async function sessaoDeQuemTemPin(diasAtras = 1) {
    const company = await createTestCompany();
    const { user, password } = await criarComPin(company.id, diasAtras);
    const token = (await authenticate(user.employeeCode, password)).json().accessToken;

    return { company, user, token };
  }

  const trocar = (token: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/api/v1/auth/pin/change",
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  it("troca com o PIN atual correto e renova os 30 dias", async () => {
    const { user, token } = await sessaoDeQuemTemPin(29);

    const resposta = await trocar(token, { currentPin: PIN_ATUAL, newPin: PIN_NOVO });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ trocado: true, validoPorDias: 30 });

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(depois.pinChangedAt).not.toBeNull();
    expect(Date.now() - depois.pinChangedAt!.getTime()).toBeLessThan(60_000);
  });

  it("recusa quem não sabe o PIN atual — um tablet destravado não basta", async () => {
    const { token } = await sessaoDeQuemTemPin();

    const resposta = await trocar(token, { currentPin: "000000", newPin: PIN_NOVO });

    expect(resposta.statusCode).toBe(401);
    expect(resposta.json().error.code).toBe("WRONG_PIN");
  });

  it("recusa PIN previsível", async () => {
    const { token } = await sessaoDeQuemTemPin();

    const resposta = await trocar(token, { currentPin: PIN_ATUAL, newPin: "123456" });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error.code).toBe("WEAK_PIN");
  });

  it("recusa trocar o PIN por ele mesmo — não renovaria nada", async () => {
    const { token } = await sessaoDeQuemTemPin();

    const resposta = await trocar(token, { currentPin: PIN_ATUAL, newPin: PIN_ATUAL });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error.code).toBe("SAME_PIN");
  });
});

describe("primeira entrada do funcionário", () => {
  it("entra no tablet com o PIN entregue e é obrigado a escolher o dele", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);

    const { user: owner, password: ownerPassword } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const ownerToken = (await authenticate(owner.employeeCode, ownerPassword)).json().accessToken;

    // O tablet da loja, que é por onde o balcão trabalha.
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
        name: "Balcão",
        status: "ACTIVE",
      },
    });

    const criada = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Vendedora Nova", role: "VENDEDOR", storeIds: [store.id] },
    });

    const { employeeCode } = criada.json().user;
    const pinEntregue = criada.json().temporaryPin as string;

    const entrada = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/pin",
      payload: { deviceId: device.id, employeeCode, pin: pinEntregue },
    });

    // Entra no primeiro dia, sem passar por computador nenhum...
    expect(entrada.statusCode).toBe(200);
    // ...e a primeira coisa que o sistema pede é um PIN que só ela saiba.
    expect(entrada.json().user.pinExpired).toBe(true);
  });
});

describe("aviso e vencimento", () => {
  it("a sessão diz quantos dias faltam, para a tela avisar antes", async () => {
    const company = await createTestCompany();
    const { user, password } = await criarComPin(company.id, 27);

    const sessao = (await authenticate(user.employeeCode, password)).json();

    expect(sessao.user.pinExpired).toBe(false);
    expect(sessao.user.pinExpiresInDays).toBe(3);
  });

  it("o dono não renova PIN — ele entra por senha e segundo fator", async () => {
    const company = await createTestCompany();
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
      pin: PIN_ATUAL,
    });

    // PIN sem data de troca e com 90 dias de idade: para um vendedor, isto
    // seria vencido duas vezes.
    await prisma.user.update({
      where: { id: owner.id },
      data: { pinChangedAt: new Date(Date.now() - 90 * 86_400_000) },
    });

    const sessao = (await authenticate(owner.employeeCode, password)).json();

    expect(sessao.user.pinExpired).toBe(false);
    // Nem o aviso dos cinco dias: não há prazo do qual avisar.
    expect(sessao.user.pinExpiresInDays).toBeNull();
  });

  it("o suporte técnico também fica de fora — nunca entra por tablet", async () => {
    const company = await createTestCompany();
    const { user: dev, password } = await createTestUser({
      companyId: company.id,
      role: "DESENVOLVEDOR",
      pin: PIN_ATUAL,
    });

    const sessao = (await authenticate(dev.employeeCode, password)).json();

    expect(sessao.user.pinExpired).toBe(false);
    expect(sessao.user.pinExpiresInDays).toBeNull();
  });

  it("PIN vencido não impede entrar — impede continuar sem trocar", async () => {
    const company = await createTestCompany();
    const { user, password } = await criarComPin(company.id, 45);

    const resposta = await authenticate(user.employeeCode, password);

    // A sessão sai normalmente: bloquear o login deixaria a pessoa de fora sem
    // caminho de volta. Quem exige a troca é a tela, com este sinal.
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().user.pinExpired).toBe(true);
  });
});

describe("PIN temporário", () => {
  async function cenario() {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);

    const { user: owner, password: ownerPassword } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const ownerToken = (await authenticate(owner.employeeCode, ownerPassword)).json().accessToken;

    const { user: seller } = await criarComPin(company.id, 40);
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    return { company, store, owner, ownerToken, seller };
  }

  const pedir = (employeeCode: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/auth/pin/reset-request",
      payload: { employeeCode },
    });

  const listar = (token: string) =>
    app.inject({
      method: "GET",
      url: "/api/v1/auth/pin/reset-requests",
      headers: { authorization: `Bearer ${token}` },
    });

  it("o pedido sai sem sessão — quem não entra não tem sessão para pedir", async () => {
    const { seller, ownerToken } = await cenario();

    const pedido = await pedir(seller.employeeCode);

    expect(pedido.statusCode).toBe(200);
    expect(pedido.json().registrado).toBe(true);

    const fila = await listar(ownerToken);
    expect(fila.json()).toHaveLength(1);
    expect(fila.json()[0].employeeCode).toBe(seller.employeeCode);
  });

  it("pedir de novo não cria fila com a mesma pessoa três vezes", async () => {
    const { seller, ownerToken } = await cenario();

    await pedir(seller.employeeCode);
    await pedir(seller.employeeCode);
    await pedir(seller.employeeCode);

    expect((await listar(ownerToken)).json()).toHaveLength(1);
  });

  it("matrícula inexistente responde igual — a tela não vira verificador de quem trabalha aqui", async () => {
    const { seller, ownerToken } = await cenario();

    const conhecida = await pedir(seller.employeeCode);
    const inventada = await pedir("RS999999");

    expect(inventada.statusCode).toBe(conhecida.statusCode);
    expect(inventada.json().mensagem).toBe(conhecida.json().mensagem);

    // A resposta é a mesma, mas só uma vira pedido de verdade.
    expect((await listar(ownerToken)).json()).toHaveLength(1);
  });

  it("aprovar devolve o PIN uma vez, já vencido, e não o escreve na auditoria", async () => {
    const { seller, ownerToken } = await cenario();

    await pedir(seller.employeeCode);
    const [pedido] = (await listar(ownerToken)).json();

    const aprovacao = await app.inject({
      method: "POST",
      url: `/api/v1/auth/pin/reset-requests/${pedido.id}/approve`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(aprovacao.statusCode).toBe(200);

    const temporario = aprovacao.json().temporaryPin as string;
    expect(temporario).toMatch(/^[0-9]{6}$/);

    // Nasce vencido: serve para uma entrada, e o sistema já pede a troca.
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });
    expect(depois.pinChangedAt).toBeNull();

    // A auditoria é lida por mais gente que o banco — o PIN não entra nela.
    const registros = await prisma.auditLog.findMany({ where: { entityId: seller.id } });
    expect(JSON.stringify(registros)).not.toContain(temporario);

    // Resolvido: some da fila de quem decide.
    expect((await listar(ownerToken)).json()).toHaveLength(0);
  });

  it("o mesmo pedido não é aprovado duas vezes", async () => {
    const { seller, ownerToken } = await cenario();

    await pedir(seller.employeeCode);
    const [pedido] = (await listar(ownerToken)).json();

    const aprovar = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/auth/pin/reset-requests/${pedido.id}/approve`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });

    await aprovar();
    const segunda = await aprovar();

    expect(segunda.statusCode).toBe(400);
    expect(segunda.json().error.code).toBe("ALREADY_DECIDED");
  });

  it("recusar exige motivo e deixa o PIN antigo como estava", async () => {
    const { seller, ownerToken } = await cenario();

    await pedir(seller.employeeCode);
    const [pedido] = (await listar(ownerToken)).json();

    const antes = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });

    const semMotivo = await app.inject({
      method: "POST",
      url: `/api/v1/auth/pin/reset-requests/${pedido.id}/reject`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: "" },
    });
    expect(semMotivo.statusCode).toBe(400);

    const comMotivo = await app.inject({
      method: "POST",
      url: `/api/v1/auth/pin/reset-requests/${pedido.id}/reject`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: "não era a pessoa" },
    });

    expect(comMotivo.statusCode).toBe(200);

    const depois = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });
    expect(depois.pinHash).toBe(antes.pinHash);
  });

  it("vendedor não vê nem aprova pedido de ninguém", async () => {
    const { company, store, seller } = await cenario();

    const { user: outro, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: outro.id, storeId: store.id } });
    const token = (await authenticate(outro.employeeCode, password)).json().accessToken;

    await pedir(seller.employeeCode);

    expect((await listar(token)).statusCode).toBe(403);
  });
});

/**
 * Pedir uma senha nova.
 *
 * Mesmo caminho do PIN: a pessoa pede da tela de entrada, o responsável
 * confere que é ela e libera uma credencial temporária que já nasce vencida.
 * Não vai por e-mail de propósito — quem confirma a identidade é gente, e uma
 * caixa de entrada pode ter sido invadida junto com a senha.
 */
describe("pedido de senha nova", () => {
  it("entra na mesma fila do PIN, marcado como senha", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    const { user: dono, password: senhaDono } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    const pedido = await app.inject({
      method: "POST",
      url: "/api/v1/auth/pin/reset-request",
      payload: { employeeCode: user.employeeCode, type: "SENHA" },
    });
    expect(pedido.statusCode).toBe(200);
    expect(pedido.json().mensagem).toContain("senha temporária");

    const token = (await authenticate(dono.employeeCode, senhaDono)).json().accessToken as string;

    const fila = await app.inject({
      method: "GET",
      url: "/api/v1/auth/pin/reset-requests",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(fila.json()).toHaveLength(1);
    expect(fila.json()[0].type).toBe("SENHA");
  });

  it("liberado, o funcionário entra com a temporária e é obrigado a trocar", async () => {
    const company = await createTestCompany();
    const { user } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    const { user: dono, password: senhaDono } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/pin/reset-request",
      payload: { employeeCode: user.employeeCode, type: "SENHA" },
    });

    const token = (await authenticate(dono.employeeCode, senhaDono)).json().accessToken as string;
    const fila = await app.inject({
      method: "GET",
      url: "/api/v1/auth/pin/reset-requests",
      headers: { authorization: `Bearer ${token}` },
    });

    const liberacao = await app.inject({
      method: "POST",
      url: `/api/v1/auth/pin/reset-requests/${fila.json()[0].id}/approve`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(liberacao.statusCode).toBe(200);
    expect(liberacao.json().type).toBe("SENHA");

    const temporaria = liberacao.json().temporaryPin as string;
    // Senha, não PIN: precisa ter o comprimento de uma senha de verdade.
    expect(temporaria.length).toBeGreaterThanOrEqual(12);

    // A temporária vale — e o sistema exige a troca na primeira entrada.
    const entrada = await authenticate(user.employeeCode, temporaria);
    expect(entrada.statusCode).toBe(400);
    expect(entrada.json().error.code).toBe("FIRST_ACCESS_REQUIRED");

    const atualizado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(atualizado.mustChangePassword).toBe(true);
    // O PIN dele não foi tocado: quem pediu senha não perdeu o PIN.
    expect(atualizado.pinHash).toBe(user.pinHash);
  });

  it("não conta se a matrícula existe — a resposta é sempre a mesma", async () => {
    const naoExiste = await app.inject({
      method: "POST",
      url: "/api/v1/auth/pin/reset-request",
      payload: { employeeCode: "RS999999", type: "SENHA" },
    });

    expect(naoExiste.statusCode).toBe(200);
    expect(naoExiste.json().registrado).toBe(true);
  });
});
