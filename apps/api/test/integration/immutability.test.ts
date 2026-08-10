import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { createTestCompany, disconnectAll, resetDatabase } from "./helpers.js";

/**
 * Cliente com a role de runtime (app_rw) — a mesma que a API usa em produção.
 * É contra ela que a trava precisa valer.
 */
const runtimeClient = prisma;

/** Cliente com a role de owner, para provar que nem privilégio elevado passa. */
let ownerClient: PrismaClient;

beforeAll(() => {
  ownerClient = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_MIGRATE_URL } },
  });
});

afterAll(async () => {
  await ownerClient.$disconnect();
  await disconnectAll();
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedAuditRow(companyId: string) {
  return prisma.auditLog.create({
    data: { action: "LOGIN_SUCCESS", result: "SUCCESS", companyId, reason: "original" },
  });
}

describe("audit_logs é append-only", () => {
  it("a role de runtime não consegue alterar um registro", async () => {
    const company = await createTestCompany();
    const entry = await seedAuditRow(company.id);

    await expect(
      runtimeClient.auditLog.update({
        where: { id: entry.id },
        data: { reason: "adulterado" },
      }),
    ).rejects.toThrow();

    const stored = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.reason).toBe("original");
  });

  it("a role de runtime não consegue apagar um registro", async () => {
    const company = await createTestCompany();
    const entry = await seedAuditRow(company.id);

    await expect(
      runtimeClient.auditLog.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();

    expect(await prisma.auditLog.count({ where: { id: entry.id } })).toBe(1);
  });

  it("nem a role de owner passa — o trigger barra privilégio elevado também", async () => {
    const company = await createTestCompany();
    const entry = await seedAuditRow(company.id);

    await expect(
      ownerClient.$executeRawUnsafe(`UPDATE audit_logs SET reason = 'x' WHERE id = $1`, entry.id),
    ).rejects.toThrow(/append-only/i);

    await expect(
      ownerClient.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = $1`, entry.id),
    ).rejects.toThrow(/append-only/i);
  });

  it("inserir continua permitido — a tabela é append-only, não somente-leitura", async () => {
    const company = await createTestCompany();
    const entry = await seedAuditRow(company.id);
    expect(entry.id).toBeTypeOf("string");
  });
});

describe("time_clock_entries é append-only", () => {
  async function seedTimeClockEntry() {
    const company = await createTestCompany();
    const store = await prisma.store.create({
      data: { companyId: company.id, code: "L01", name: "Loja" },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        employeeCode: "RS900001",
        email: "ponto@teste.local",
        name: "Funcionário",
        role: "VENDEDOR",
        status: "ACTIVE",
      },
    });
    const station = await prisma.pOSStation.create({
      data: { storeId: store.id, code: "E01", name: "Estação" },
    });
    const cashRegister = await prisma.cashRegister.create({
      data: { posStationId: station.id, code: "C01", name: "Caixa" },
    });
    const device = await prisma.device.create({
      data: {
        cashRegisterId: cashRegister.id,
        companyId: company.id,
        storeId: store.id,
        name: "Tablet",
        status: "ACTIVE",
      },
    });

    const entry = await prisma.timeClockEntry.create({
      data: {
        userId: user.id,
        companyId: company.id,
        storeId: store.id,
        deviceId: device.id,
        type: "CLOCK_IN",
        timestamp: new Date(),
      },
    });

    return { entry, user, store, device, company };
  }

  it("uma marcação registrada nunca pode ser alterada", async () => {
    const { entry } = await seedTimeClockEntry();

    await expect(
      runtimeClient.timeClockEntry.update({
        where: { id: entry.id },
        data: { timestamp: new Date("2020-01-01") },
      }),
    ).rejects.toThrow();

    const stored = await prisma.timeClockEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.timestamp.getTime()).toBe(entry.timestamp.getTime());
  });

  it("uma marcação registrada nunca pode ser apagada", async () => {
    const { entry } = await seedTimeClockEntry();

    await expect(
      runtimeClient.timeClockEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();

    expect(await prisma.timeClockEntry.count({ where: { id: entry.id } })).toBe(1);
  });

  it("a correção é um evento novo apontando para o original, que permanece intacto", async () => {
    const { entry, user, store, device, company } = await seedTimeClockEntry();

    const correction = await prisma.timeClockEntry.create({
      data: {
        userId: user.id,
        companyId: company.id,
        storeId: store.id,
        deviceId: device.id,
        type: "CLOCK_IN",
        timestamp: new Date(),
        correctsEntryId: entry.id,
        correctionReason: "esqueceu de bater na entrada",
      },
    });

    expect(correction.correctsEntryId).toBe(entry.id);

    // O original continua lá, sem uma vírgula alterada.
    const original = await prisma.timeClockEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(original.correctionReason).toBeNull();
    expect(original.timestamp.getTime()).toBe(entry.timestamp.getTime());

    // O NSR é sequencial — base para a exportação futura do AFD.
    expect(correction.nsr).toBeGreaterThan(original.nsr);
  });
});
