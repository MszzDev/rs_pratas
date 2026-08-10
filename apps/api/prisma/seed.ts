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
  }

  const existingOwner = await prisma.user.findFirst({
    where: { companyId: company.id, role: "DONO" },
  });

  if (!existingOwner) {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword, ARGON2_OPTIONS);

    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        employeeCode: "0001",
        email: "dono@rspratas.com.br",
        name: "Dono RS Pratas",
        role: "DONO",
        status: "PENDING_FIRST_ACCESS",
        passwordHash,
        mustChangePassword: true,
        mustCreatePin: true,
      },
    });

    // eslint-disable-next-line no-console
    console.log("\n=== USUARIO DONO BOOTSTRAP CRIADO ===");
    console.log(`employeeCode: ${owner.employeeCode}`);
    console.log(`email:        ${owner.email}`);
    console.log(`senha temp.:  ${temporaryPassword}`);
    console.log("Guarde esta senha agora — ela não é recuperável depois (hash Argon2id, não reversível).\n");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
