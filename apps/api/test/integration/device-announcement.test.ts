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
 * O tablet se apresenta e o dono decide.
 *
 * O que estes testes protegem é a inversão que dá sentido ao fluxo: quem entra
 * na fila é o aparelho, sem autenticação nenhuma, e entrar na fila não concede
 * NADA — nem loja, nem caixa, nem login. Tudo o que vale acontece depois, com
 * o dono autenticado escolhendo a loja.
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

async function authenticate(employeeCode: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: employeeCode, password },
  });
  return response.json().accessToken as string;
}

/** Empresa + loja + caixa + dono autenticado. */
async function setupStoreWithOwner() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.employeeCode, password);

  const station = await app
    .inject({
      method: "POST",
      url: "/api/v1/pos-stations",
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, code: "E01", name: "Estação 01" },
    })
    .then((response) => response.json());

  const cashRegister = await app
    .inject({
      method: "POST",
      url: "/api/v1/cash-registers",
      headers: { authorization: `Bearer ${token}` },
      payload: { posStationId: station.id, code: "C01", name: "Caixa 01" },
    })
    .then((response) => response.json());

  return { company, store, owner, password, token, cashRegister };
}

const announce = (hardwareId: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/v1/devices/announce",
    payload: { hardwareId, model: "Lenovo TB311FU", osVersion: "Android 14", ...extra },
  });

const listPending = (token: string) =>
  app.inject({
    method: "GET",
    url: "/api/v1/devices/pending",
    headers: { authorization: `Bearer ${token}` },
  });

describe("anúncio do tablet", () => {
  it("entra na fila sem autenticação e sem receber loja nenhuma", async () => {
    const response = await announce("hw-0001");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      vinculado: false,
      deviceId: null,
      storeName: null,
    });

    // O anúncio sozinho não cria dispositivo: sem Device não há login, não há
    // caixa e não há venda.
    expect(await prisma.device.count()).toBe(0);
  });

  it("reabrir o aplicativo atualiza a mesma linha, não enche a fila de repetidos", async () => {
    const { token } = await setupStoreWithOwner();

    await announce("hw-0001", { appVersion: "1.0.0" });
    await announce("hw-0001", { appVersion: "1.1.0" });
    await announce("hw-0001", { appVersion: "1.2.0" });

    const fila = listPending(token);
    const corpo = (await fila).json();

    expect(corpo).toHaveLength(1);
    expect(corpo[0].apelido).toContain("Lenovo TB311FU");
  });

  it("o dono escolhe a loja e o aparelho passa a saber quem é", async () => {
    const { token, store } = await setupStoreWithOwner();

    await announce("hw-0001");
    const [pendente] = (await listPending(token)).json();

    const vinculo = await app.inject({
      method: "POST",
      url: `/api/v1/devices/pending/${pendente.id}/assign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, name: "Balcão 1" },
    });

    expect(vinculo.statusCode).toBe(200);
    expect(vinculo.json().name).toBe("Balcão 1");

    // Na próxima vez que abrir, o tablet recebe a identidade pronta — é o que
    // faz a tela de espera sair sozinha, sem ninguém tocar no aparelho.
    const segundoAnuncio = await announce("hw-0001");
    expect(segundoAnuncio.json()).toMatchObject({
      vinculado: true,
      deviceName: "Balcão 1",
    });

    const device = await prisma.device.findFirstOrThrow({ where: { name: "Balcão 1" } });
    expect(device.status).toBe("ACTIVE");
    expect(device.storeId).toBe(store.id);
    // Sem caixa informado, assume o único que existe: perguntar "qual caixa?"
    // quando só há um é uma pergunta sem outra resposta possível.
    expect(device.cashRegisterId).toBeTruthy();
  });

  it("vincular duas vezes o mesmo aparelho é recusado", async () => {
    const { token, store } = await setupStoreWithOwner();

    await announce("hw-0001");
    const [pendente] = (await listPending(token)).json();

    const vincular = () =>
      app.inject({
        method: "POST",
        url: `/api/v1/devices/pending/${pendente.id}/assign`,
        headers: { authorization: `Bearer ${token}` },
        payload: { storeId: store.id, name: "Balcão 1" },
      });

    await vincular();
    const segunda = await vincular();

    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.code).toBe("ALREADY_ASSIGNED");
  });

  it("adota o cadastro que já existia com o mesmo hardware, em vez de duplicar", async () => {
    const { token, cashRegister, company, store } = await setupStoreWithOwner();

    // Um aparelho cadastrado pelo caminho antigo, com código de pareamento.
    const criado = await app
      .inject({
        method: "POST",
        url: "/api/v1/devices",
        headers: { authorization: `Bearer ${token}` },
        payload: { cashRegisterId: cashRegister.id, name: "Tablet antigo" },
      })
      .then((response) => response.json());

    await app.inject({
      method: "POST",
      url: "/api/v1/devices/claim",
      payload: { pairingCode: criado.pairingCode, deviceUuid: "hw-antigo" },
    });

    const anuncio = await announce("hw-antigo");

    expect(anuncio.json()).toMatchObject({
      vinculado: true,
      deviceId: criado.device.id,
      deviceName: "Tablet antigo",
    });

    // Nenhum segundo Device: a loja não fica com dois caixas para um tablet só.
    expect(await prisma.device.count({ where: { companyId: company.id, storeId: store.id } })).toBe(
      1,
    );
  });

  it("tablet desvinculado volta para a fila e pode ser vinculado de novo", async () => {
    const { token, store } = await setupStoreWithOwner();

    await announce("hw-0001");
    const [pendente] = (await listPending(token)).json();

    const vinculo = await app
      .inject({
        method: "POST",
        url: `/api/v1/devices/pending/${pendente.id}/assign`,
        headers: { authorization: `Bearer ${token}` },
        payload: { storeId: store.id, name: "Balcão 1" },
      })
      .then((response) => response.json());

    await app.inject({
      method: "POST",
      url: `/api/v1/devices/${vinculo.deviceId}/unlink`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "tablet foi para a assistência" },
    });

    // Mostrar a tela de login de um tablet desvinculado só levaria a pessoa a
    // digitar o PIN para ouvir que o aparelho não está ativo.
    const depoisDoDesvinculo = await announce("hw-0001");
    expect(depoisDoDesvinculo.json().vinculado).toBe(false);

    const fila = (await listPending(token)).json();
    expect(fila).toHaveLength(1);

    const revinculo = await app.inject({
      method: "POST",
      url: `/api/v1/devices/pending/${fila[0].id}/assign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, name: "Balcão 1 (de volta)" },
    });

    expect(revinculo.statusCode).toBe(200);
  });

  it("descarta da fila o aparelho que não é da loja", async () => {
    const { token } = await setupStoreWithOwner();

    await announce("hw-celular-de-teste");
    const [pendente] = (await listPending(token)).json();

    const descarte = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/pending/${pendente.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(descarte.statusCode).toBe(200);
    expect((await listPending(token)).json()).toHaveLength(0);

    // Descartar é limpeza, não punição: se o aparelho abrir de novo, volta.
    await announce("hw-celular-de-teste");
    expect((await listPending(token)).json()).toHaveLength(1);
  });

  it("não descarta aparelho que já pertence a uma loja", async () => {
    const { token, store } = await setupStoreWithOwner();

    await announce("hw-0001");
    const [pendente] = (await listPending(token)).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/devices/pending/${pendente.id}/assign`,
      headers: { authorization: `Bearer ${token}` },
      payload: { storeId: store.id, name: "Balcão 1" },
    });

    const descarte = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/pending/${pendente.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(descarte.statusCode).toBe(409);
  });

  it("vendedor não enxerga nem resolve a fila", async () => {
    const { company, store } = await setupStoreWithOwner();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });
    const sellerToken = await authenticate(seller.employeeCode, password);

    await announce("hw-0001");

    expect((await listPending(sellerToken)).statusCode).toBe(403);
  });
});
