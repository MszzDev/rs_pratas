import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
 * A cobrança que sai do PDV e aparece na maquininha.
 *
 * O que estes testes seguram é o que dói quando erra: o valor precisa chegar
 * em CENTAVOS (mandar reais faria a maquininha cobrar cem vezes menos, e a
 * venda fecharia como se estivesse certa), o código da venda precisa viajar
 * junto (é como o pagamento volta reconhecível), e maquininha sem conta ou
 * sem aparelho escolhido precisa recusar em vez de fingir que cobrou.
 */

let app: FastifyInstance;

const TOKEN = "APP_USR-1111111111111111-aaaa-bbbb-cccc-7788";
const APARELHO = "PAX_A910__SMARTPOS1234567";

/** O que foi enviado ao Mercado Pago, para o teste conferir. */
let enviado: { url: string; corpo: unknown } | null = null;

function fingirMercadoPago(estadoFinal = "FINISHED") {
  enviado = null;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (corpo: unknown, status = 200) =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.endsWith("/users/me")) {
      return json({ id: 99, nickname: "RSPRATAS", site_id: "MLB" });
    }

    if (url.endsWith("/point/integration-api/devices")) {
      return json({ devices: [{ id: APARELHO, operating_mode: "PDV" }] });
    }

    if (url.includes("/payment-intents") && init?.method === "POST") {
      enviado = { url, corpo: JSON.parse(String(init.body)) };
      return json({ id: "intent-1", state: "OPEN" });
    }

    if (url.includes("/payment-intents/")) {
      return json({
        id: "intent-1",
        state: estadoFinal,
        payment: estadoFinal === "FINISHED" ? { id: 4242, status: "approved" } : null,
      });
    }

    throw new Error(`chamada inesperada: ${url}`);
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

async function cenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });

  const token = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login/password",
      payload: { identifier: owner.employeeCode, password },
    })
  ).json().accessToken as string;

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

  const terminal = await app
    .inject({
      method: "POST",
      url: "/api/v1/terminals",
      headers: auth(token),
      payload: { deviceId: device.id, serialNumber: "MP-01" },
    })
    .then((resposta) => resposta.json());

  await prisma.paymentTerminal.update({
    where: { id: terminal.id },
    data: { status: "ACTIVE" },
  });

  return { token, terminalId: terminal.id as string };
}

describe("cobrança na maquininha", () => {
  it("recusa cobrar sem conta do Mercado Pago", async () => {
    const { token, terminalId } = await cenario();

    const resposta = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${terminalId}/charge`,
      headers: auth(token),
      payload: { amount: 100, description: "Venda", externalReference: "V-1" },
    });

    expect(resposta.statusCode).toBe(400);
  });

  it("recusa cobrar antes de escolher qual aparelho da conta é este", async () => {
    const { token, terminalId } = await cenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/mercadopago`,
      headers: auth(token),
      payload: { accessToken: TOKEN },
    });

    const resposta = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${terminalId}/charge`,
      headers: auth(token),
      payload: { amount: 100, description: "Venda", externalReference: "V-1" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json().error.code).toBe("TERMINAL_WITHOUT_DEVICE");
  });

  it("manda o valor em centavos e leva o código da venda junto", async () => {
    const { token, terminalId } = await cenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/mercadopago`,
      headers: auth(token),
      payload: { accessToken: TOKEN },
    });

    const aparelhos = await app.inject({
      method: "GET",
      url: `/api/v1/terminals/${terminalId}/point-devices`,
      headers: auth(token),
    });

    expect(aparelhos.json()[0].id).toBe(APARELHO);

    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/point-device`,
      headers: auth(token),
      payload: { pointDeviceId: APARELHO },
    });

    const cobranca = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${terminalId}/charge`,
      headers: auth(token),
      payload: {
        amount: 189.9,
        description: "Venda de 2 peças",
        externalReference: "PDV-123",
        type: "credit",
        installments: 3,
      },
    });

    expect(cobranca.statusCode).toBe(200);
    expect(cobranca.json().intentId).toBe("intent-1");

    // R$ 189,90 vira 18990 centavos. Mandar reais faria a maquininha cobrar
    // R$ 1,89 — e a venda fecharia como se estivesse certa.
    const corpo = enviado?.corpo as {
      amount: number;
      additional_info: { external_reference: string };
      payment?: { installments: number; type: string };
    };

    expect(corpo.amount).toBe(18990);
    expect(corpo.additional_info.external_reference).toBe("PDV-123");
    expect(corpo.payment?.installments).toBe(3);
    expect(corpo.payment?.type).toBe("credit");
  });

  it("devolve o número do pagamento quando aprova — é o que faz o estorno funcionar depois", async () => {
    const { token, terminalId } = await cenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/mercadopago`,
      headers: auth(token),
      payload: { accessToken: TOKEN },
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/point-device`,
      headers: auth(token),
      payload: { pointDeviceId: APARELHO },
    });

    const situacao = await app.inject({
      method: "GET",
      url: `/api/v1/terminals/${terminalId}/charge/intent-1`,
      headers: auth(token),
    });

    expect(situacao.json()).toMatchObject({
      aprovado: true,
      concluido: true,
      paymentId: "4242",
      estado: "Pago",
    });
  });

  it("cliente que desiste deixa a cobrança sem aprovação, e a tela sabe disso", async () => {
    vi.unstubAllGlobals();
    fingirMercadoPago("ABANDONED");

    const { token, terminalId } = await cenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/mercadopago`,
      headers: auth(token),
      payload: { accessToken: TOKEN },
    });
    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/point-device`,
      headers: auth(token),
      payload: { pointDeviceId: APARELHO },
    });

    const situacao = await app.inject({
      method: "GET",
      url: `/api/v1/terminals/${terminalId}/charge/intent-1`,
      headers: auth(token),
    });

    expect(situacao.json()).toMatchObject({
      aprovado: false,
      concluido: true,
      estado: "O cliente não concluiu",
    });
  });

  it("vendedor cobra, mas não configura o aparelho", async () => {
    const { token, terminalId } = await cenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/mercadopago`,
      headers: auth(token),
      payload: { accessToken: TOKEN },
    });

    const company = await prisma.paymentTerminal
      .findUniqueOrThrow({ where: { id: terminalId } })
      .then((terminal) => terminal.companyId);

    const store = await prisma.store.findFirstOrThrow({ where: { companyId: company } });

    const { user: seller, password } = await createTestUser({
      companyId: company,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    const sellerToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login/password",
        payload: { identifier: seller.employeeCode, password },
      })
    ).json().accessToken as string;

    // Configurar o aparelho é do dono...
    const configurar = await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/point-device`,
      headers: auth(sellerToken),
      payload: { pointDeviceId: APARELHO },
    });
    expect(configurar.statusCode).toBe(403);

    // ...mas cobrar é de quem está no balcão atendendo.
    await app.inject({
      method: "PUT",
      url: `/api/v1/terminals/${terminalId}/point-device`,
      headers: auth(token),
      payload: { pointDeviceId: APARELHO },
    });

    const cobranca = await app.inject({
      method: "POST",
      url: `/api/v1/terminals/${terminalId}/charge`,
      headers: auth(sellerToken),
      payload: { amount: 50, description: "Venda", externalReference: "PDV-9" },
    });

    expect(cobranca.statusCode).toBe(200);
  });
});
