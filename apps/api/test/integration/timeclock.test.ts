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

/** Empresa + loja + tablet ativo + vendedor com acesso à loja. */
async function setup() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);

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
      name: "Tablet 01",
      status: "ACTIVE",
      deviceUuid: `uuid-${crypto.randomUUID()}`,
    },
  });

  const { user: seller, password } = await createTestUser({
    companyId: company.id,
    role: "VENDEDOR",
  });
  await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });
  const sellerToken = await authenticate(seller.employeeCode, password);

  const { user: manager, password: managerPassword } = await createTestUser({
    companyId: company.id,
    role: "GERENTE",
  });
  await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });
  const managerToken = await authenticate(manager.employeeCode, managerPassword);

  // Jornada e correção de ponto passaram a ser do dono: o gerente consulta o
  // ponto da loja dele, mas não define horário nem reescreve marcação.
  const { user: owner, password: ownerPassword } = await createTestUser({
    companyId: company.id,
    role: "DONO",
  });
  await prisma.userStore.create({ data: { userId: owner.id, storeId: store.id } });
  const ownerToken = await authenticate(owner.employeeCode, ownerPassword);

  return { company, store, device, seller, sellerToken, manager, managerToken, owner, ownerToken };
}

const punch = (token: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: "/api/v1/timeclock/punch",
    headers: auth(token),
    payload,
  });

const STORE_TIMEZONE = "America/Sao_Paulo";

const WEEKDAY_BY_SHORT: Record<string, string> = {
  Sun: "SUNDAY",
  Mon: "MONDAY",
  Tue: "TUESDAY",
  Wed: "WEDNESDAY",
  Thu: "THURSDAY",
  Fri: "FRIDAY",
  Sat: "SATURDAY",
};

/**
 * Cria a jornada de hoje começando N minutos atrás, no fuso da loja.
 *
 * Ancorar no "agora" em vez de num horário fixo mantém o teste determinístico
 * a qualquer hora do dia — um startTime fixo tornaria o resultado dependente de
 * quando a suíte roda.
 */
async function createScheduleRelativeToNow(params: {
  token: string;
  userId: string;
  storeId: string;
  minutesAgo: number;
  toleranceMinutes: number;
}) {
  const now = new Date();
  const localTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: STORE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const [hours, minutes] = localTime.split(":").map(Number);
  const startMinutes = (hours! * 60 + minutes! - params.minutesAgo + 1440) % 1440;
  const startTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(
    startMinutes % 60,
  ).padStart(2, "0")}`;

  const shortWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    weekday: "short",
  }).format(now);

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/timeclock/schedules",
    headers: auth(params.token),
    payload: {
      userId: params.userId,
      storeId: params.storeId,
      weekday: WEEKDAY_BY_SHORT[shortWeekday]!,
      startTime,
      endTime: "23:59",
      toleranceMinutes: params.toleranceMinutes,
    },
  });

  // Falha aqui, e não três asserções adiante.
  //
  // Enquanto este helper engolia o erro, tirar a permissão de jornada do
  // gerente não quebrava o teste de propósito: a jornada simplesmente não era
  // criada, e o teste de tolerância acusava "esperava false, recebeu null" —
  // uma pista que não aponta para a causa.
  if (response.statusCode !== 201) {
    throw new Error(
      `não criou a jornada do teste (${response.statusCode}): ${response.body}`,
    );
  }

  return response;
}

describe("registro de ponto", () => {
  it("registra a entrada com NSR sequencial", async () => {
    const { device, sellerToken } = await setup();

    const response = await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.type).toBe("CLOCK_IN");
    expect(BigInt(body.nsr)).toBeGreaterThan(0n);
  });

  it("o NSR é estritamente crescente entre marcações", async () => {
    const { device, sellerToken } = await setup();

    const primeira = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();
    const segunda = (await punch(sellerToken, { deviceId: device.id, type: "BREAK_START", justification: "almoço" })).json();

    expect(BigInt(segunda.nsr)).toBeGreaterThan(BigInt(primeira.nsr));
  });

  it("nunca recusa a marcação por falta de justificativa — apenas sinaliza pendência", async () => {
    const { device, sellerToken } = await setup();
    await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    // Saída sem justificativa: o REP-P proíbe bloquear a batida.
    const response = await punch(sellerToken, { deviceId: device.id, type: "CLOCK_OUT" });

    expect(response.statusCode).toBe(201);
    expect(response.json().justificationPending).toBe(true);
  });

  it("com justificativa, a marcação não fica pendente", async () => {
    const { device, sellerToken } = await setup();

    const response = await punch(sellerToken, {
      deviceId: device.id,
      type: "CLOCK_OUT",
      justification: "consulta médica agendada",
    });

    expect(response.json().justificationPending).toBe(false);

    const stored = await prisma.timeClockEntry.findUniqueOrThrow({
      where: { id: response.json().id },
    });
    expect(stored.justification).toBe("consulta médica agendada");
  });

  it("marca atraso quando a entrada passa da tolerância", async () => {
    const { device, sellerToken, seller, store, ownerToken } = await setup();

    // Jornada que começou 30 minutos atrás, no fuso da loja, com tolerância 10.
    await createScheduleRelativeToNow({
      token: ownerToken,
      userId: seller.id,
      storeId: store.id,
      minutesAgo: 30,
      toleranceMinutes: 10,
    });

    const response = await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    expect(response.statusCode).toBe(201);
    expect(response.json().minutesLate).toBeGreaterThanOrEqual(29);
    expect(response.json().minutesLate).toBeLessThanOrEqual(31);
    expect(response.json().isWithinTolerance).toBe(false);
  });

  it("não marca atraso quando a entrada cabe na tolerância", async () => {
    const { device, sellerToken, seller, store, ownerToken } = await setup();

    // Começou 5 minutos atrás, tolerância de 10 — dentro do combinado.
    await createScheduleRelativeToNow({
      token: ownerToken,
      userId: seller.id,
      storeId: store.id,
      minutesAgo: 5,
      toleranceMinutes: 10,
    });

    const response = await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    expect(response.json().isWithinTolerance).toBe(true);
    expect(response.json().minutesLate).toBeLessThanOrEqual(6);
  });

  it("congela a avaliação: mudar a jornada depois não reescreve o passado", async () => {
    const { device, sellerToken, seller, store, ownerToken } = await setup();

    await createScheduleRelativeToNow({
      token: ownerToken,
      userId: seller.id,
      storeId: store.id,
      minutesAgo: 40,
      toleranceMinutes: 5,
    });

    const registrada = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();
    expect(registrada.isWithinTolerance).toBe(false);

    // Jornada afrouxada depois do fato: 60 é o teto aceito pela API, e já
    // cobre os 40 minutos de atraso — se a avaliação fosse recalculada, a
    // marcação passaria a constar como dentro da tolerância.
    await createScheduleRelativeToNow({
      token: ownerToken,
      userId: seller.id,
      storeId: store.id,
      minutesAgo: 40,
      toleranceMinutes: 60,
    });

    const stored = await prisma.timeClockEntry.findUniqueOrThrow({
      where: { id: registrada.id },
    });
    expect(stored.isWithinTolerance).toBe(false);
    expect(stored.minutesLate).toBe(registrada.minutesLate);
  });

  it("sem jornada cadastrada, registra sem julgar atraso", async () => {
    const { device, sellerToken } = await setup();

    const response = await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    expect(response.json().isWithinTolerance).toBeNull();
    expect(response.json().minutesLate).toBeNull();
  });

  it("recusa tablet de outra empresa", async () => {
    const { sellerToken } = await setup();
    const outra = await setup();

    const response = await punch(sellerToken, { deviceId: outra.device.id, type: "CLOCK_IN" });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_WRONG_COMPANY");
  });

  it("audita cada marcação", async () => {
    const { device, sellerToken, seller } = await setup();
    await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    const entry = await prisma.auditLog.findFirst({
      where: { userId: seller.id, action: "TIMECLOCK_ENTRY_CREATE" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.deviceId).toBe(device.id);
  });
});

describe("sugestão do próximo evento no tablet", () => {
  it("sugere entrada quando não há marcação e intervalo depois da entrada", async () => {
    const { device, sellerToken } = await setup();

    const inicial = await app.inject({
      method: "GET",
      url: "/api/v1/timeclock/next",
      headers: auth(sellerToken),
    });
    expect(inicial.json().suggestedType).toBe("CLOCK_IN");
    expect(inicial.json().lastEntry).toBeNull();

    await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    const depois = await app.inject({
      method: "GET",
      url: "/api/v1/timeclock/next",
      headers: auth(sellerToken),
    });
    expect(depois.json().suggestedType).toBe("BREAK_START");
    expect(depois.json().lastEntry.type).toBe("CLOCK_IN");
  });
});

describe("espelho de ponto", () => {
  it("o funcionário consulta o próprio espelho", async () => {
    const { device, sellerToken } = await setup();
    await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/timeclock/me/mirror",
      headers: auth(sellerToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toHaveLength(1);
  });

  it("o gerente consulta o espelho de um funcionário da loja", async () => {
    const { device, sellerToken, seller, managerToken } = await setup();
    await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/timeclock/users/${seller.id}/mirror`,
      headers: auth(managerToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(seller.id);
  });

  it("um vendedor não consulta o espelho de outro", async () => {
    const { company, store, sellerToken } = await setup();
    const { user: outro } = await createTestUser({ companyId: company.id, role: "VENDEDOR" });
    await prisma.userStore.create({ data: { userId: outro.id, storeId: store.id } });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/timeclock/users/${outro.id}/mirror`,
      headers: auth(sellerToken),
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("correção de marcação", () => {
  it("o gerente não corrige ponto nem define jornada", async () => {
    const { device, sellerToken, seller, store, managerToken } = await setup();

    const original = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();

    const correcao = await app.inject({
      method: "POST",
      url: `/api/v1/timeclock/entries/${original.id}/correct`,
      headers: auth(managerToken),
      payload: {
        type: "CLOCK_IN",
        timestamp: new Date().toISOString(),
        reason: "esqueceu de bater na chegada",
      },
    });

    const jornada = await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/schedules",
      headers: auth(managerToken),
      payload: {
        userId: seller.id,
        storeId: store.id,
        weekday: "MONDAY",
        startTime: "08:00",
        endTime: "18:00",
        toleranceMinutes: 10,
      },
    });

    expect(correcao.statusCode).toBe(403);
    expect(jornada.statusCode).toBe(403);
  });

  it("cria um evento novo e preserva o original intacto", async () => {
    const { device, sellerToken, seller, ownerToken } = await setup();

    const original = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();

    const correcao = await app.inject({
      method: "POST",
      url: `/api/v1/timeclock/entries/${original.id}/correct`,
      headers: auth(ownerToken),
      payload: {
        type: "CLOCK_IN",
        timestamp: new Date("2026-03-10T11:00:00Z").toISOString(),
        reason: "funcionário esqueceu de bater na chegada",
      },
    });

    expect(correcao.statusCode).toBe(201);
    expect(correcao.json().correctsEntryId).toBe(original.id);

    // O original permanece byte a byte igual.
    const stored = await prisma.timeClockEntry.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored.correctionReason).toBeNull();
    expect(stored.timestamp.toISOString()).toBe(new Date(original.timestamp).toISOString());

    // O espelho mostra os dois, encadeados.
    const mirror = await app.inject({
      method: "GET",
      url: `/api/v1/timeclock/users/${seller.id}/mirror`,
      headers: auth(ownerToken),
    });
    const entries = mirror.json().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].corrections).toHaveLength(1);
    expect(entries[0].corrections[0].reason).toBe("funcionário esqueceu de bater na chegada");
  });

  it("exige motivo na correção", async () => {
    const { device, sellerToken, ownerToken } = await setup();
    const original = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/timeclock/entries/${original.id}/correct`,
      headers: auth(ownerToken),
      payload: { type: "CLOCK_IN", timestamp: new Date().toISOString(), reason: "x" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("vendedor não pode corrigir o próprio ponto", async () => {
    const { device, sellerToken } = await setup();
    const original = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/timeclock/entries/${original.id}/correct`,
      headers: auth(sellerToken),
      payload: {
        type: "CLOCK_IN",
        timestamp: new Date().toISOString(),
        reason: "quero ajustar meu horário",
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("audita a correção com o motivo", async () => {
    const { device, sellerToken, ownerToken } = await setup();
    const original = (await punch(sellerToken, { deviceId: device.id, type: "CLOCK_IN" })).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/timeclock/entries/${original.id}/correct`,
      headers: auth(ownerToken),
      payload: {
        type: "CLOCK_IN",
        timestamp: new Date().toISOString(),
        reason: "ajuste combinado com o RH",
      },
    });

    const entry = await prisma.auditLog.findFirst({ where: { action: "TIMECLOCK_CORRECTION" } });
    expect(entry?.reason).toBe("ajuste combinado com o RH");
  });
});

describe("jornada de trabalho", () => {
  it("cadastrar nova jornada encerra a anterior sem apagá-la", async () => {
    const { seller, store, ownerToken } = await setup();

    const payload = {
      userId: seller.id,
      storeId: store.id,
      weekday: "MONDAY",
      startTime: "08:00",
      endTime: "18:00",
      toleranceMinutes: 10,
    };

    await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/schedules",
      headers: auth(ownerToken),
      payload,
    });

    await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/schedules",
      headers: auth(ownerToken),
      payload: { ...payload, startTime: "09:00" },
    });

    const all = await prisma.workSchedule.findMany({
      where: { userId: seller.id, weekday: "MONDAY" },
      orderBy: { effectiveFrom: "asc" },
    });

    // As duas existem: a antiga continua explicando os registros do passado.
    expect(all).toHaveLength(2);
    expect(all[0]!.isActive).toBe(false);
    expect(all[0]!.effectiveTo).not.toBeNull();
    expect(all[1]!.isActive).toBe(true);
    expect(all[1]!.startTime).toBe("09:00");
  });

  it("vendedor não gerencia jornada", async () => {
    const { seller, store, sellerToken } = await setup();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/timeclock/schedules",
      headers: auth(sellerToken),
      payload: {
        userId: seller.id,
        storeId: store.id,
        weekday: "MONDAY",
        startTime: "08:00",
        endTime: "18:00",
      },
    });

    expect(response.statusCode).toBe(403);
  });
});
