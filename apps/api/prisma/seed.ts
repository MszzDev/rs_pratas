import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import {
  PERMISSIONS,
  USER_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
} from "@rs-pratas/shared";

const prisma = new PrismaClient();

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
  parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
} as const;

function generateTemporaryPassword(): string {
  return randomBytes(9).toString("base64url");
}

async function main() {
  const company = await prisma.company.upsert({
    where: { cnpj: "00000000000191" },
    update: {},
    create: {
      legalName: "RS Pratas Comercio de Joias Ltda",
      tradeName: "RS Pratas",
      cnpj: "00000000000191",
    },
  });

  for (const role of USER_ROLES) {
    await prisma.role.upsert({
      where: { code: role },
      update: {},
      create: { code: role, name: role },
    });
  }

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { category: permission.category, description: permission.description },
      create: permission,
    });
  }

  for (const role of USER_ROLES) {
    const roleRecord = await prisma.role.findUniqueOrThrow({ where: { code: role } });
    const permissionCodes = DEFAULT_ROLE_PERMISSIONS[role];

    for (const code of permissionCodes) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roleRecord.id, permissionId: permission.id } },
        update: {},
        create: { roleId: roleRecord.id, permissionId: permission.id },
      });
    }

    // O seed espelha o catálogo — não só acrescenta.
    //
    // Sem esta limpeza, tirar uma permissão do perfil no código não tirava nada
    // de ninguém: a linha concedida numa versão anterior continuava no banco, e
    // o cargo seguia podendo o que já não devia poder. Restringir só valeria em
    // banco novo, que é exatamente onde não importa.
    //
    // Isto apaga o PADRÃO DO CARGO. Concessão nominal (UserPermission) não é
    // tocada: quem recebeu a exceção com nome continua com ela.
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: roleRecord.id,
        permission: { code: { notIn: [...permissionCodes] } },
      },
    });
  }

  await createBootstrapUser({
    companyId: company.id,
    role: "DONO",
    employeeCode: "RS000001",
    name: "Dono RS Pratas",
  });

  await createBootstrapUser({
    companyId: company.id,
    role: "DESENVOLVEDOR",
    employeeCode: "RS000002",
    name: "Suporte Técnico",
  });
}

/**
 * Cria a conta inicial de um perfil, se ainda não existir.
 *
 * A senha é gerada e mostrada uma única vez: como fica guardada só em hash
 * Argon2id, não há como recuperá-la depois — e é isso que se quer.
 */
async function createBootstrapUser(params: {
  companyId: string;
  role: "DONO" | "DESENVOLVEDOR";
  employeeCode: string;
  name: string;
}) {
  const existing = await prisma.user.findFirst({
    where: { companyId: params.companyId, role: params.role },
  });

  if (existing) return;

  const temporaryPassword = generateTemporaryPassword();

  const user = await prisma.user.create({
    data: {
      companyId: params.companyId,
      employeeCode: params.employeeCode,
      name: params.name,
      role: params.role,
      status: "PENDING_FIRST_ACCESS",
      passwordHash: await argon2.hash(temporaryPassword, ARGON2_OPTIONS),
      mustChangePassword: true,
      mustCreatePin: true,
    },
  });

  console.log(`\n=== CONTA INICIAL: ${params.role} ===`);
  console.log(`matrícula:   ${user.employeeCode}`);
  console.log(`senha temp.: ${temporaryPassword}`);
  console.log("Anote agora — esta senha não aparece de novo.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
