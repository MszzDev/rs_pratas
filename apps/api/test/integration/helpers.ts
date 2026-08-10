import type { FastifyInstance } from "fastify";
import type { UserRole, UserStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { hashSecret } from "../../src/core/security/password.service.js";

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Tabelas com dados voláteis de teste, na ordem em que podem ser truncadas.
 * `roles` e `permissions` ficam de fora: são semeadas uma vez no global-setup
 * e o RBAC depende delas.
 *
 * Usa TRUNCATE (e não DELETE) de propósito: TRUNCATE não dispara triggers de
 * linha, então a limpeza continua funcionando depois que a trava de
 * imutabilidade de audit_logs/time_clock_entries entrar em vigor.
 */
const VOLATILE_TABLES = [
  "refresh_tokens",
  "step_up_tokens",
  "device_sessions",
  "two_factor_credentials",
  "time_clock_entries",
  "work_schedules",
  "audit_logs",
  "user_permissions",
  "user_stores",
  "device_settings",
  "payment_terminals",
  "devices",
  "cash_registers",
  "pos_stations",
  "store_settings",
  "app_settings",
  "users",
  "stores",
  "companies",
] as const;

/**
 * Conexão com a role de owner: TRUNCATE exige privilégio que a role de runtime
 * (app_rw) não tem — e não deve ter.
 */
let ownerClient: PrismaClient | null = null;

function getOwnerClient(): PrismaClient {
  ownerClient ??= new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_MIGRATE_URL } },
  });
  return ownerClient;
}

export async function resetDatabase(): Promise<void> {
  const client = getOwnerClient();
  const list = VOLATILE_TABLES.map((table) => `"${table}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function disconnectAll(): Promise<void> {
  await prisma.$disconnect();
  if (ownerClient) {
    await ownerClient.$disconnect();
    ownerClient = null;
  }
}

export async function createTestCompany(name = "Empresa Teste") {
  return prisma.company.create({
    data: {
      legalName: name,
      tradeName: name,
      cnpj: crypto.randomUUID(),
    },
  });
}

export async function createTestStore(companyId: string, code = "L01") {
  return prisma.store.create({
    data: { companyId, code, name: `Loja ${code}` },
  });
}

export async function createTestUser(params: {
  companyId: string;
  password?: string;
  role?: UserRole;
  status?: UserStatus;
  employeeCode?: string;
  email?: string;
}) {
  const password = params.password ?? "senha-de-teste-12345";
  const suffix = crypto.randomUUID().slice(0, 8);

  const user = await prisma.user.create({
    data: {
      companyId: params.companyId,
      employeeCode: params.employeeCode ?? suffix,
      email: params.email ?? `${suffix}@teste.local`,
      name: "Usuário de Teste",
      role: params.role ?? "VENDEDOR",
      status: params.status ?? "ACTIVE",
      passwordHash: await hashSecret(password),
      mustChangePassword: false,
      mustCreatePin: false,
    },
  });

  return { user, password };
}
