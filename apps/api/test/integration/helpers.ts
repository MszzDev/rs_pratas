import type { FastifyInstance } from "fastify";
import type { UserRole, UserStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/prisma.js";
import { hashSecret } from "../../src/core/security/password.service.js";
import { createTotpSetup, encryptSecret } from "../../src/core/security/totp.service.js";

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
  /**
   * O DONO já nasce com 2FA confirmado por padrão, porque é assim que ele
   * existe em produção — sem isso a sessão dele fica restrita às rotas de
   * configuração de 2FA. Passe `false` para exercitar justamente esse bloqueio.
   */
  withTwoFactor?: boolean;
  /**
   * Em produção o padrão é o oposto: funcionário só entra pelo tablet da loja.
   * Aqui a liberação vem ligada para que os testes de OUTROS assuntos possam
   * abrir sessão sem montar loja, estação, caixa e tablet a cada caso.
   *
   * A regra de verdade tem cobertura dedicada em device-required-login.test.ts
   * — passe `false` para exercitá-la.
   */
  allowOffDevice?: boolean;
}) {
  const password = params.password ?? "senha-de-teste-12345";
  const suffix = crypto.randomUUID().slice(0, 8);
  const role = params.role ?? "VENDEDOR";

  const user = await prisma.user.create({
    data: {
      companyId: params.companyId,
      employeeCode: params.employeeCode ?? `RS${suffix}`,
      name: "Usuário de Teste",
      role,
      status: params.status ?? "ACTIVE",
      passwordHash: await hashSecret(password),
      mustChangePassword: false,
      mustCreatePin: false,
    },
  });

  const shouldEnableTwoFactor = params.withTwoFactor ?? role === "DONO";

  if (shouldEnableTwoFactor) {
    await prisma.twoFactorCredential.create({
      data: {
        userId: user.id,
        secretEncrypted: encryptSecret(createTotpSetup(user.employeeCode).secret),
        confirmedAt: new Date(),
        recoveryCodesHash: [],
      },
    });
  }

  const shouldAllowOffDevice = params.allowOffDevice ?? true;

  if (shouldAllowOffDevice && role !== "DONO" && role !== "DESENVOLVEDOR") {
    await grantOffDeviceAccess(user.id);
  }

  return { user, password };
}

/** Libera a matrícula a entrar fora dos tablets, como o dono faria na tela. */
export async function grantOffDeviceAccess(userId: string): Promise<void> {
  const permission = await prisma.permission.findUniqueOrThrow({
    where: { code: "AUTH_LOGIN_OFF_DEVICE" },
  });

  await prisma.userPermission.upsert({
    where: { userId_permissionId: { userId, permissionId: permission.id } },
    update: { effect: "ALLOW", revokedAt: null },
    create: {
      userId,
      permissionId: permission.id,
      effect: "ALLOW",
      grantedById: userId,
      reason: "fixture de teste",
    },
  });
}
