/**
 * Dados de demonstração para ver as telas com conteúdo real.
 *
 * NÃO roda em produção — o guard abaixo derruba o script se NODE_ENV for
 * production. Serve só para o desenvolvimento local: telas vazias não mostram
 * se o layout funciona.
 *
 *   pnpm tsx prisma/demo-seed.ts
 */
import { prisma } from "../src/db/prisma.js";
import { hashSecret } from "../src/core/security/password.service.js";

const DEMO_PASSWORD = "RsPratas!Demo2026";
const DEMO_PIN = "246810";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("demo-seed nunca roda em produção.");
  }

  const company = await prisma.company.findFirstOrThrow({ where: { deletedAt: null } });

  // ---------------------------------------------------------------- lojas
  const matriz = await upsertStore(company.id, "MTZ", "Loja Centro");
  const shopping = await upsertStore(company.id, "SH01", "Loja Shopping");

  // ------------------------------------------------------------- usuários
  const owner = await upsertUser({
    companyId: company.id,
    employeeCode: "RS000100",
    name: "Renata Souza",
    role: "DONO",
  });

  const manager = await upsertUser({
    companyId: company.id,
    employeeCode: "RS000200",
    name: "Carlos Andrade",
    role: "GERENTE",
    storeIds: [matriz.id],
  });

  const seller = await upsertUser({
    companyId: company.id,
    employeeCode: "RS000300",
    name: "Juliana Prado",
    role: "VENDEDOR",
    storeIds: [matriz.id],
  });

  // ------------------------------------------- estação, caixa e maquininha
  const station = await upsert("pOSStation", { storeId: matriz.id, code: "E01" }, {
    storeId: matriz.id,
    code: "E01",
    name: "Balcão principal",
  });

  const cashRegister = await upsert("cashRegister", { posStationId: station.id, code: "C01" }, {
    posStationId: station.id,
    code: "C01",
    name: "Caixa 1",
  });

  const device = await upsert("device", { companyId: company.id, name: "Tablet do balcão" }, {
    cashRegisterId: cashRegister.id,
    companyId: company.id,
    storeId: matriz.id,
    name: "Tablet do balcão",
    status: "ACTIVE",
  });

  await upsert("paymentTerminal", { serialNumber: "MP-8891023" }, {
    deviceId: device.id,
    cashRegisterId: cashRegister.id,
    posStationId: station.id,
    storeId: matriz.id,
    companyId: company.id,
    provider: "Mercado Pago",
    serialNumber: "MP-8891023",
    status: "ACTIVE",
    isPrimary: true,
  });

  // ------------------------------------------------- catálogo e categorias
  const aneis = await upsertCategory(company.id, "ANEL", "Anéis");
  const correntes = await upsertCategory(company.id, "CORR", "Correntes");
  const brincos = await upsertCategory(company.id, "BRIN", "Brincos");

  const gradeAnel = await upsert("sizeGrade", { companyId: company.id, code: "ANEL" }, {
    companyId: company.id,
    code: "ANEL",
    name: "Grade de anéis",
    sizes: ["12", "14", "16", "18", "20", "22", "24"],
  });

  const catalogo = [
    { sku: "AN-1001", name: "Anel Solitário Zircônia", cat: aneis.id, cost: 38, price: 129.9, g: 2.4, sizes: ["14", "16", "18", "20"] },
    { sku: "AN-1002", name: "Aliança Lisa 4mm", cat: aneis.id, cost: 62, price: 189.9, g: 4.1, sizes: ["16", "18", "20", "22"] },
    { sku: "CO-2001", name: "Corrente Veneziana 45cm", cat: correntes.id, cost: 45, price: 149.9, g: 3.8, sizes: [] },
    { sku: "CO-2002", name: "Corrente Cordão Baiano 60cm", cat: correntes.id, cost: 120, price: 349.9, g: 11.2, sizes: [] },
    { sku: "BR-3001", name: "Brinco Argola Pequena", cat: brincos.id, cost: 22, price: 79.9, g: 1.6, sizes: [] },
    { sku: "BR-3002", name: "Brinco Ponto de Luz", cat: brincos.id, cost: 18, price: 69.9, g: 0.9, sizes: [] },
    { sku: "PI-4001", name: "Pingente Coração Vazado", cat: null, cost: 15, price: 59.9, g: 1.2, sizes: [] },
  ];

  for (const item of catalogo) {
    const product = await upsert("product", { companyId: company.id, sku: item.sku }, {
      companyId: company.id,
      sku: item.sku,
      name: item.name,
      categoryId: item.cat,
      sizeGradeId: item.sizes.length > 0 ? gradeAnel.id : null,
      costPrice: item.cost,
      salePrice: item.price,
      weightGrams: item.g,
      hasVariations: item.sizes.length > 0,
    });

    for (const size of item.sizes) {
      await upsert("productVariation", { productId: product.id, size }, {
        productId: product.id,
        companyId: company.id,
        sku: `${item.sku}-${size}`,
        size,
      });
    }

    // Estoque nas duas lojas, com quantidades variadas para a tela ter o que
    // mostrar — inclusive um item abaixo do mínimo.
    for (const store of [matriz, shopping]) {
      if (item.sizes.length > 0) {
        const variations = await prisma.productVariation.findMany({
          where: { productId: product.id },
        });
        for (const variation of variations) {
          await stockUp(company.id, store.id, product.id, variation.id, randomBetween(0, 8), owner.id);
        }
      } else {
        await stockUp(company.id, store.id, product.id, null, randomBetween(2, 25), owner.id);
      }
    }
  }

  // Um item com estoque baixo, para o alerta aparecer.
  const baixo = await prisma.stockItem.findFirst({
    where: { storeId: matriz.id, variationId: null },
  });
  if (baixo) {
    await prisma.stockItem.update({
      where: { id: baixo.id },
      data: { minQuantity: baixo.quantity + 5 },
    });
  }

  // ------------------------------------------------------------- clientes
  const clientes = [
    { name: "Maria Aparecida Lima", phone: "11988776655", ringSize: "16" },
    { name: "João Pedro Martins", phone: "11977665544", ringSize: "22" },
    { name: "Fernanda Castro", phone: "11966554433", ringSize: "14" },
    { name: "Roberto Nogueira", phone: "11955443322", ringSize: null },
  ];

  for (const cliente of clientes) {
    await upsert("customer", { companyId: company.id, phone: cliente.phone }, {
      companyId: company.id,
      name: cliente.name,
      phone: cliente.phone,
      ringSize: cliente.ringSize,
      createdById: owner.id,
    });
  }

  // ---------------------------------------------- modelo de etiqueta e meta
  await upsert("labelTemplate", { companyId: company.id, code: "JOIA" }, {
    companyId: company.id,
    code: "JOIA",
    name: "Etiqueta de joia 50×12",
    widthMm: 50,
    heightMm: 12,
    isDefault: true,
    createdById: owner.id,
  });

  await upsert("commissionRule", { companyId: company.id, name: "Padrão da rede" }, {
    companyId: company.id,
    name: "Padrão da rede",
    basis: "FATURAMENTO",
    percent: 3,
    createdById: owner.id,
  });

  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);
  const fimDoMes = new Date(inicioDoMes);
  fimDoMes.setMonth(fimDoMes.getMonth() + 1);

  for (const store of [matriz, shopping]) {
    await upsert("goal", { storeId: store.id, periodStart: inicioDoMes, scope: "LOJA" }, {
      companyId: company.id,
      storeId: store.id,
      scope: "LOJA",
      period: "MENSAL",
      periodStart: inicioDoMes,
      periodEnd: fimDoMes,
      targetAmount: 18000,
      createdById: owner.id,
    });
  }

  // ------------------------------------------------------ caixa e vendas
  let session = await prisma.cashSession.findFirst({
    where: { cashRegisterId: cashRegister.id, status: "ABERTO" },
  });

  if (!session) {
    session = await prisma.cashSession.create({
      data: {
        companyId: company.id,
        storeId: matriz.id,
        cashRegisterId: cashRegister.id,
        code: `CX${String((await prisma.cashSession.count({ where: { companyId: company.id } })) + 1).padStart(6, "0")}`,
        openedById: seller.id,
        openingAmount: 200,
      },
    });

    await prisma.cashMovement.create({
      data: {
        sessionId: session.id,
        companyId: company.id,
        storeId: matriz.id,
        type: "ABERTURA",
        amount: 200,
        reason: "fundo de troco",
        userId: seller.id,
      },
    });
  }

  console.log("\n=== DADOS DE DEMONSTRAÇÃO PRONTOS ===\n");
  console.log("Entre em http://localhost:5173 com:\n");
  console.log(`  Dono       matrícula ${owner.employeeCode}   senha ${DEMO_PASSWORD}`);
  console.log(`  Gerente    matrícula ${manager.employeeCode}   senha ${DEMO_PASSWORD}`);
  console.log(`  Vendedora  matrícula ${seller.employeeCode}   senha ${DEMO_PASSWORD}`);
  console.log(`\n  PIN de todos (no tablet): ${DEMO_PIN}`);
  console.log("\nO caixa da Loja Centro já está aberto, então dá para vender.\n");
}

// ---------------------------------------------------------------- helpers

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function upsertStore(companyId: string, code: string, name: string) {
  const existing = await prisma.store.findFirst({ where: { companyId, code } });
  if (existing) return existing;
  return prisma.store.create({ data: { companyId, code, name } });
}

async function upsertCategory(companyId: string, code: string, name: string) {
  const existing = await prisma.category.findFirst({ where: { companyId, code } });
  if (existing) return existing;
  return prisma.category.create({ data: { companyId, code, name } });
}

/**
 * Cria o usuário com senha e PIN conhecidos, já com o primeiro acesso
 * concluído — a demonstração não deve começar pelo fluxo de troca de senha.
 */
async function upsertUser(params: {
  companyId: string;
  employeeCode: string;
  name: string;
  role: "DONO" | "GERENTE" | "VENDEDOR" | "DESENVOLVEDOR";
  storeIds?: string[];
}) {
  const passwordHash = await hashSecret(DEMO_PASSWORD);
  const pinHash = await hashSecret(DEMO_PIN);

  const existing = await prisma.user.findFirst({
    where: { companyId: params.companyId, employeeCode: params.employeeCode },
  });

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, pinHash, status: "ACTIVE", mustChangePassword: false, mustCreatePin: false },
      })
    : await prisma.user.create({
        data: {
          companyId: params.companyId,
          employeeCode: params.employeeCode,
          name: params.name,
          role: params.role,
          status: "ACTIVE",
          passwordHash,
          pinHash,
          mustChangePassword: false,
          mustCreatePin: false,
        },
      });

  for (const storeId of params.storeIds ?? []) {
    const link = await prisma.userStore.findFirst({ where: { userId: user.id, storeId } });
    if (!link) {
      await prisma.userStore.create({ data: { userId: user.id, storeId } });
    }
  }

  // Permite entrar fora do tablet, senão a demonstração no computador não abre.
  const permission = await prisma.permission.findUnique({
    where: { code: "AUTH_LOGIN_OFF_DEVICE" },
  });
  if (permission) {
    const granted = await prisma.userPermission.findFirst({
      where: { userId: user.id, permissionId: permission.id },
    });
    if (!granted) {
      await prisma.userPermission.create({
        data: {
          userId: user.id,
          permissionId: permission.id,
          effect: "ALLOW",
          grantedById: user.id,
          reason: "conta de demonstração",
        },
      });
    }
  }

  return user;
}

/** Entrada de estoque direta, sem passar pela rota (é semente, não operação). */
async function stockUp(
  companyId: string,
  storeId: string,
  productId: string,
  variationId: string | null,
  quantity: number,
  userId: string,
) {
  if (quantity <= 0) return;

  const existing = await prisma.stockItem.findFirst({
    where: { storeId, productId, variationId },
  });
  if (existing) return;

  const item = await prisma.stockItem.create({
    data: { companyId, storeId, productId, variationId, quantity },
  });

  await prisma.stockMovement.create({
    data: {
      companyId,
      storeId,
      stockItemId: item.id,
      type: "ENTRADA",
      quantity,
      quantityBefore: 0,
      quantityAfter: quantity,
      reason: "carga inicial de demonstração",
      userId,
    },
  });
}

/** Cria se não existir, usando o cliente do Prisma pelo nome do modelo. */
async function upsert(
  model: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<{ id: string; [key: string]: unknown }> {
  const delegate = (prisma as unknown as Record<string, {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  }>)[model];

  const existing = await delegate.findFirst({ where });
  if (existing) return existing as { id: string };

  return (await delegate.create({ data })) as { id: string };
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
