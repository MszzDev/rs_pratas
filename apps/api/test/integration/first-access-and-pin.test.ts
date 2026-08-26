import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { hashSecret } from "../../src/core/security/password.service.js";
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

const TEMP_PASSWORD = "senha-temporaria-inicial";
const NEW_PASSWORD = "minha-nova-senha-forte";
const GOOD_PIN = "4821";

async function createPendingUser(companyId: string, employeeCode = "0100") {
  const user = await prisma.user.create({
    data: {
      companyId,
      employeeCode,
      name: "Funcionário Novo",
      role: "VENDEDOR",
      status: "PENDING_FIRST_ACCESS",
      passwordHash: await hashSecret(TEMP_PASSWORD),
      mustChangePassword: true,
      mustCreatePin: true,
    },
  });

  // Este arquivo testa o primeiro acesso e o PIN, não a regra de "só no
  // tablet" — que tem cobertura própria em device-required-login.test.ts.
  await grantOffDeviceAccess(user.id);

  return user;
}

const post = (url: string, payload: unknown) =>
  app.inject({ method: "POST", url: `/api/v1/auth${url}`, payload });

async function startOnboarding(identifier: string) {
  const response = await post("/first-access/start", {
    identifier,
    tempPassword: TEMP_PASSWORD,
  });
  return response;
}

/** Percorre o fluxo inteiro e devolve o usuário já ativo. */
async function completeOnboarding(companyId: string, employeeCode = "0100") {
  const user = await createPendingUser(companyId, employeeCode);
  const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

  await post("/first-access/set-password", {
    onboardingToken,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  await post("/first-access/set-pin", {
    onboardingToken,
    pin: GOOD_PIN,
    confirmPin: GOOD_PIN,
  });
  await post("/first-access/complete", { onboardingToken });

  return user;
}

describe("primeiro acesso", () => {
  it("percorre senha temporária → nova senha → PIN → ativação", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);

    const start = await startOnboarding(user.employeeCode);
    expect(start.statusCode).toBe(200);
    const { onboardingToken } = start.json();
    expect(onboardingToken).toBeTypeOf("string");

    const setPassword = await post("/first-access/set-password", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(setPassword.statusCode).toBe(204);

    const setPin = await post("/first-access/set-pin", {
      onboardingToken,
      pin: GOOD_PIN,
      confirmPin: GOOD_PIN,
    });
    expect(setPin.statusCode).toBe(204);

    const complete = await post("/first-access/complete", { onboardingToken });
    expect(complete.statusCode).toBe(204);

    const activated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(activated.status).toBe("ACTIVE");
    expect(activated.mustChangePassword).toBe(false);
    expect(activated.mustCreatePin).toBe(false);
    expect(activated.pinHash).not.toBeNull();
  });

  it("conclui senha e PIN numa chamada só", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);

    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    const finish = await post("/first-access/finish", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      pin: GOOD_PIN,
      confirmPin: GOOD_PIN,
    });
    expect(finish.statusCode).toBe(204);

    const ativado = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(ativado.status).toBe("ACTIVE");
    expect(ativado.mustChangePassword).toBe(false);
    expect(ativado.mustCreatePin).toBe(false);
    expect(ativado.pinHash).not.toBeNull();
  });

  /**
   * O defeito que trancou o dono para fora do sistema.
   *
   * O fluxo antigo gravava a senha nova ANTES de pedir o PIN. Quando o PIN era
   * recusado — e ele é recusado, porque quase todo mundo escolhe 1234 —, a
   * senha do papel já tinha sido substituída e o cadastro ficava pela metade.
   *
   * A partir dali não havia porta: o login com a senha do papel dizia
   * "incorretos", o login com a senha nova mandava de volta ao primeiro
   * acesso, e o primeiro acesso pedia "a senha temporária", que não existia
   * mais.
   *
   * Este teste guarda a propriedade que impede isso de voltar: PIN recusado
   * não pode deixar rastro nenhum na conta.
   */
  it("PIN recusado não invalida a senha temporária nem deixa a conta pela metade", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);

    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    const recusado = await post("/first-access/finish", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      pin: "1234",
      confirmPin: "1234",
    });
    expect(recusado.statusCode).toBe(400);

    const intacto = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(intacto.status).toBe("PENDING_FIRST_ACCESS");
    expect(intacto.mustChangePassword).toBe(true);
    expect(intacto.mustCreatePin).toBe(true);
    expect(intacto.pinHash).toBeNull();

    // E o principal: a senha entregue no papel continua abrindo a porta.
    const denovo = await startOnboarding(user.employeeCode);
    expect(denovo.statusCode).toBe(200);
  });

  it("recusa senha temporária incorreta", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);

    const response = await post("/first-access/start", {
      identifier: user.employeeCode,
      tempPassword: "chute-errado",
    });
    expect(response.statusCode).toBe(401);
  });

  it("impede reutilizar a senha temporária como senha definitiva", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);
    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    const response = await post("/first-access/set-password", {
      onboardingToken,
      newPassword: TEMP_PASSWORD,
      confirmPassword: TEMP_PASSWORD,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PASSWORD_SAME_AS_TEMPORARY");
  });

  it("exige confirmação coerente de senha e de PIN", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);
    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    const senhaDivergente = await post("/first-access/set-password", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: "outra-coisa-totalmente",
    });
    expect(senhaDivergente.statusCode).toBe(400);

    await post("/first-access/set-password", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const pinDivergente = await post("/first-access/set-pin", {
      onboardingToken,
      pin: GOOD_PIN,
      confirmPin: "9999",
    });
    expect(pinDivergente.statusCode).toBe(400);
  });

  it("rejeita PIN previsível", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);
    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    await post("/first-access/set-password", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    for (const pin of ["1111", "1234", "4321"]) {
      const response = await post("/first-access/set-pin", {
        onboardingToken,
        pin,
        confirmPin: pin,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("WEAK_PIN");
    }
  });

  it("não ativa a conta se o PIN ainda não foi criado", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);
    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    await post("/first-access/set-password", {
      onboardingToken,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const response = await post("/first-access/complete", { onboardingToken });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("FIRST_ACCESS_INCOMPLETE");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.status).toBe("PENDING_FIRST_ACCESS");
  });

  it("exige a senha antes do PIN", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);
    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    const response = await post("/first-access/set-pin", {
      onboardingToken,
      pin: GOOD_PIN,
      confirmPin: GOOD_PIN,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PASSWORD_STEP_PENDING");
  });

  it("token de onboarding não abre rotas normais da aplicação", async () => {
    const company = await createTestCompany();
    const user = await createPendingUser(company.id);
    const { onboardingToken } = (await startOnboarding(user.employeeCode)).json();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${onboardingToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("permite login normal com a nova senha após concluir", async () => {
    const company = await createTestCompany();
    const user = await completeOnboarding(company.id);

    const response = await post("/login/password", {
      identifier: user.employeeCode,
      password: NEW_PASSWORD,
    });
    expect(response.statusCode).toBe(200);

    const antiga = await post("/login/password", {
      identifier: user.employeeCode,
      password: TEMP_PASSWORD,
    });
    expect(antiga.statusCode).toBe(401);
  });

  it("orienta quem já concluiu a usar o login normal", async () => {
    const company = await createTestCompany();
    const user = await completeOnboarding(company.id);

    // Credencial correta (a senha própria), mas na tela errada.
    const response = await post("/first-access/start", {
      identifier: user.employeeCode,
      tempPassword: NEW_PASSWORD,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("FIRST_ACCESS_ALREADY_DONE");
  });

  it("a senha temporária deixa de abrir o primeiro acesso depois de concluído", async () => {
    const company = await createTestCompany();
    const user = await completeOnboarding(company.id);

    const response = await post("/first-access/start", {
      identifier: user.employeeCode,
      tempPassword: TEMP_PASSWORD,
    });
    expect(response.statusCode).toBe(401);
  });

  it("não serve para descobrir se uma conta existe", async () => {
    const company = await createTestCompany();
    // Conta real, já ativa.
    const ativo = await completeOnboarding(company.id, "0300");

    // Com senha errada, a conta ativa e a inexistente respondem igual — o
    // atacante não aprende nada sobre quem existe na empresa.
    const contaAtiva = await post("/first-access/start", {
      identifier: ativo.employeeCode,
      tempPassword: "chute-qualquer-errado",
    });
    const contaInexistente = await post("/first-access/start", {
      identifier: "ninguem@teste.local",
      tempPassword: "chute-qualquer-errado",
    });

    expect(contaAtiva.statusCode).toBe(401);
    expect(contaInexistente.statusCode).toBe(401);
    expect(contaAtiva.json().error.code).toBe(contaInexistente.json().error.code);
    expect(contaAtiva.json().error.message).toBe(contaInexistente.json().error.message);
  });
});

describe("login por PIN no tablet", () => {
  /** Empresa + loja + tablet ACTIVE + vendedor com PIN definido. */
  async function setupTabletAndSeller() {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });

    const token = (
      await post("/login/password", { identifier: owner.employeeCode, password })
    ).json().accessToken;

    const station = await app
      .inject({
        method: "POST",
        url: "/api/v1/pos-stations",
        headers: { authorization: `Bearer ${token}` },
        payload: { storeId: store.id, code: "E01", name: "Estação 01" },
      })
      .then((r) => r.json());

    const cashRegister = await app
      .inject({
        method: "POST",
        url: "/api/v1/cash-registers",
        headers: { authorization: `Bearer ${token}` },
        payload: { posStationId: station.id, code: "C01", name: "Caixa 01" },
      })
      .then((r) => r.json());

    const created = await app
      .inject({
        method: "POST",
        url: "/api/v1/devices",
        headers: { authorization: `Bearer ${token}` },
        payload: { cashRegisterId: cashRegister.id, name: "Tablet 01" },
      })
      .then((r) => r.json());

    await app.inject({
      method: "POST",
      url: "/api/v1/devices/claim",
      payload: { pairingCode: created.pairingCode, deviceUuid: `uuid-${crypto.randomUUID()}` },
    });

    const seller = await completeOnboarding(company.id, "0100");
    await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

    return { company, store, device: created.device, seller };
  }

  it("autentica com matrícula e PIN no tablet pareado", async () => {
    const { device, seller, store } = await setupTabletAndSeller();

    const response = await post("/login/pin", {
      deviceId: device.id,
      employeeCode: seller.employeeCode,
      pin: GOOD_PIN,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(seller.id);

    const session = await prisma.deviceSession.findFirst({ where: { userId: seller.id } });
    expect(session?.deviceId).toBe(device.id);
    expect(session?.storeId).toBe(store.id);
  });

  it("recusa PIN correto em dispositivo inexistente — PIN sozinho não vale", async () => {
    const { seller } = await setupTabletAndSeller();

    const response = await post("/login/pin", {
      deviceId: crypto.randomUUID(),
      employeeCode: seller.employeeCode,
      pin: GOOD_PIN,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("DEVICE_NOT_FOUND");
  });

  it("bloqueia o PIN após o limite de tentativas", async () => {
    const { device, seller } = await setupTabletAndSeller();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post("/login/pin", {
        deviceId: device.id,
        employeeCode: seller.employeeCode,
        pin: "9999",
      });
      expect(response.statusCode).toBe(401);
    }

    const afterLock = await post("/login/pin", {
      deviceId: device.id,
      employeeCode: seller.employeeCode,
      pin: GOOD_PIN,
    });
    expect(afterLock.statusCode).toBe(429);
    expect(afterLock.json().error.code).toBe("PIN_LOCKED");
  });

  it("bloqueio de PIN não derruba o login por senha — credenciais independentes", async () => {
    const { device, seller } = await setupTabletAndSeller();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post("/login/pin", {
        deviceId: device.id,
        employeeCode: seller.employeeCode,
        pin: "9999",
      });
    }

    const porSenha = await post("/login/password", {
      identifier: seller.employeeCode,
      password: NEW_PASSWORD,
    });
    expect(porSenha.statusCode).toBe(200);
  });

  it("impede login em tablet de loja à qual o funcionário não tem acesso", async () => {
    const { device, company } = await setupTabletAndSeller();

    const outraLoja = await createTestStore(company.id, "L99");
    const forasteiro = await completeOnboarding(company.id, "0777");
    await prisma.userStore.create({ data: { userId: forasteiro.id, storeId: outraLoja.id } });

    const response = await post("/login/pin", {
      deviceId: device.id,
      employeeCode: forasteiro.employeeCode,
      pin: GOOD_PIN,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STORE_ACCESS_DENIED");
  });

  it("atualiza o último contato do tablet a cada login", async () => {
    const { device, seller } = await setupTabletAndSeller();

    await post("/login/pin", {
      deviceId: device.id,
      employeeCode: seller.employeeCode,
      pin: GOOD_PIN,
    });

    const stored = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(stored.lastSeenAt).not.toBeNull();
  });

  it("registra o método PIN na auditoria do login", async () => {
    const { device, seller } = await setupTabletAndSeller();

    await post("/login/pin", {
      deviceId: device.id,
      employeeCode: seller.employeeCode,
      pin: GOOD_PIN,
    });

    const entry = await prisma.auditLog.findFirst({
      where: { userId: seller.id, action: "LOGIN_SUCCESS" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.metadata).toMatchObject({ method: "PIN" });
    expect(entry?.deviceId).toBe(device.id);
  });
});
