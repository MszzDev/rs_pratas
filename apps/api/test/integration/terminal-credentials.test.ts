import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { credentialsForTerminal } from "../../src/modules/terminals/terminal-credentials.service.js";
import {
  createTestApp,
  createTestCompany,
  createTestStore,
  createTestUser,
  disconnectAll,
  resetDatabase,
} from "./helpers.js";

/**
 * Cada maquininha tem a SUA conta do Mercado Pago.
 *
 * A loja contratou uma conta por aparelho, e é nela que cai o dinheiro daquele
 * aparelho. O que estes testes seguram é que o sistema não mistura as contas —
 * consultar um pagamento na conta errada faria o sistema dizer que um
 * pagamento que existe não foi encontrado — e que o token nunca volta para a
 * tela depois de guardado.
 */

let app: FastifyInstance;

const TOKEN_BOM = "APP_USR-1234567890123456-aaaa-bbbb-cccc-9f21";
const TOKEN_DA_OUTRA = "APP_USR-9999999999999999-dddd-eeee-ffff-1a2b";
const TOKEN_RUIM = "APP_USR-token-que-o-mercado-pago-recusa";

/**
 * Responde no lugar do Mercado Pago.
 *
 * Sem isto, a suíte dependeria da internet e da conta de alguém — e um teste
 * que falha porque a rede caiu ensina a ignorar teste que falha.
 */
function fingirMercadoPago() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (!url.startsWith("https://api.mercadopago.com")) {
      throw new Error(`chamada inesperada para ${url}`);
    }

    const autorizacao = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
    );
    const token = autorizacao.replace("Bearer ", "");

    if (token === TOKEN_BOM) {
      return new Response(
        JSON.stringify({ id: 111111, nickname: "RSPRATAS_CENTRO", site_id: "MLB" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (token === TOKEN_DA_OUTRA) {
      return new Response(
        JSON.stringify({ id: 222222, nickname: "RSPRATAS_SHOPPING", site_id: "MLB" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ message: "invalid_token" }), { status: 401 });
  });
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectAll();
});

beforeEach(async () => {
  await resetDatabase();
  fingirMercadoPago();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/** Loja com dois caixas, cada um com o seu tablet e a sua maquininha. */
async function cenarioComDuasMaquininhas() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);

  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.employeeCode, password);

  const criarMaquininha = async (sufixo: string) => {
    const station = await prisma.pOSStation.create({
      data: { storeId: store.id, code: `E${sufixo}`, name: `Estação ${sufixo}` },
    });
    const cashRegister = await prisma.cashRegister.create({
      data: { posStationId: station.id, code: `C${sufixo}`, name: `Caixa ${sufixo}` },
    });
    const device = await prisma.device.create({
      data: {
        cashRegisterId: cashRegister.id,
        companyId: company.id,
        storeId: store.id,
        name: `Tablet ${sufixo}`,
        status: "ACTIVE",
      },
    });

    const terminal = await app
      .inject({
        method: "POST",
        url: "/api/v1/terminals",
        headers: auth(token),
        payload: { deviceId: device.id, serialNumber: `MP-${sufixo}` },
      })
      .then((response) => response.json());

    return terminal as { id: string };
  };

  return {
    company,
    store,
    token,
    primeira: await criarMaquininha("01"),
    segunda: await criarMaquininha("02"),
  };
}

const salvarConta = (
  token: string,
  terminalId: string,
  payload: Record<string, unknown>,
) =>
  app.inject({
    method: "PUT",
    url: `/api/v1/terminals/${terminalId}/mercadopago`,
    headers: auth(token),
    payload,
  });

describe("conta do Mercado Pago por maquininha", () => {
  it("guarda o token e confirma na hora de qual conta ele é", async () => {
    const { token, primeira } = await cenarioComDuasMaquininhas();

    const resposta = await salvarConta(token, primeira.id, { accessToken: TOKEN_BOM });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().conta).toMatchObject({
      configurada: true,
      contaId: "111111",
      // O apelido vem do próprio Mercado Pago quando ninguém escreve um.
      apelido: "RSPRATAS_CENTRO",
      tokenPreview: "••••9f21",
    });
  });

  it("cada maquininha fica na sua conta — é assim que a loja contratou", async () => {
    const { token, primeira, segunda } = await cenarioComDuasMaquininhas();

    await salvarConta(token, primeira.id, { accessToken: TOKEN_BOM, label: "Conta do Centro" });
    await salvarConta(token, segunda.id, { accessToken: TOKEN_DA_OUTRA });

    const daPrimeira = await credentialsForTerminal(primeira.id);
    const daSegunda = await credentialsForTerminal(segunda.id);

    expect(daPrimeira).toMatchObject({ accessToken: TOKEN_BOM, origem: "MAQUININHA" });
    expect(daSegunda).toMatchObject({ accessToken: TOKEN_DA_OUTRA, origem: "MAQUININHA" });
  });

  it("token recusado não é gravado — a tela não pode dizer 'conectado' por engano", async () => {
    const { token, primeira } = await cenarioComDuasMaquininhas();

    const resposta = await salvarConta(token, primeira.id, { accessToken: TOKEN_RUIM });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error.code).toBe("INTEGRATION_REJECTED");

    const terminal = await prisma.paymentTerminal.findUniqueOrThrow({
      where: { id: primeira.id },
    });
    expect(terminal.credentialsEncrypted).toBeNull();
  });

  it("o token não volta para a tela — nem para o dono", async () => {
    const { token, primeira } = await cenarioComDuasMaquininhas();

    await salvarConta(token, primeira.id, { accessToken: TOKEN_BOM });

    const lista = await app.inject({
      method: "GET",
      url: "/api/v1/terminals",
      headers: auth(token),
    });

    const corpo = lista.body;
    expect(corpo).not.toContain(TOKEN_BOM);
    // Nem o valor cifrado: ele não tem uso na tela e só amplia o alcance de um vazamento.
    expect(corpo).not.toContain("credentialsEncrypted");
    expect(corpo).toContain("••••9f21");
  });

  it("o token não entra na auditoria", async () => {
    const { token, primeira } = await cenarioComDuasMaquininhas();

    await salvarConta(token, primeira.id, { accessToken: TOKEN_BOM });

    const registros = await prisma.auditLog.findMany({ where: { entityId: primeira.id } });

    expect(registros.length).toBeGreaterThan(0);
    expect(JSON.stringify(registros)).not.toContain(TOKEN_BOM);
  });

  it("trocar a conta substitui a anterior", async () => {
    const { token, primeira } = await cenarioComDuasMaquininhas();

    await salvarConta(token, primeira.id, { accessToken: TOKEN_BOM });
    await salvarConta(token, primeira.id, { accessToken: TOKEN_DA_OUTRA });

    expect(await credentialsForTerminal(primeira.id)).toMatchObject({
      accessToken: TOKEN_DA_OUTRA,
    });
  });

  it("remover a conta não desativa a maquininha — ela continua cobrando", async () => {
    const { token, primeira } = await cenarioComDuasMaquininhas();

    await salvarConta(token, primeira.id, { accessToken: TOKEN_BOM });

    const antes = await prisma.paymentTerminal.findUniqueOrThrow({ where: { id: primeira.id } });

    const remocao = await app.inject({
      method: "DELETE",
      url: `/api/v1/terminals/${primeira.id}/mercadopago`,
      headers: auth(token),
    });

    expect(remocao.statusCode).toBe(200);

    const depois = await prisma.paymentTerminal.findUniqueOrThrow({ where: { id: primeira.id } });
    expect(depois.credentialsEncrypted).toBeNull();
    // A maquininha continua exatamente como estava: tirar a conta só a põe fora
    // do alcance do sistema, não a desliga do balcão.
    expect(depois.status).toBe(antes.status);
    expect(depois.deletedAt).toBeNull();
  });

  it("sem conta própria, cai para a credencial da empresa", async () => {
    const { company, token, primeira } = await cenarioComDuasMaquininhas();

    // Quem usa uma conta só continua funcionando como antes.
    await app.inject({
      method: "POST",
      url: "/api/v1/integrations/MERCADOPAGO/connect",
      headers: auth(token),
      payload: { credentials: { accessToken: TOKEN_BOM } },
    });

    const integracao = await prisma.integration.findFirst({
      where: { companyId: company.id, provider: "MERCADOPAGO" },
    });
    expect(integracao?.status).toBe("CONECTADA");

    expect(await credentialsForTerminal(primeira.id)).toMatchObject({
      accessToken: TOKEN_BOM,
      origem: "EMPRESA",
    });
  });

  it("vendedor não configura conta de maquininha", async () => {
    const { company, store, primeira } = await cenarioComDuasMaquininhas();

    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });
    const sellerToken = await authenticate(seller.employeeCode, password);

    const resposta = await salvarConta(sellerToken, primeira.id, { accessToken: TOKEN_BOM });

    expect(resposta.statusCode).toBe(403);
  });
});
