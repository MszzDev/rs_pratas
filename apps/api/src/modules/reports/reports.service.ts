import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { badRequest } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Relatórios.
 *
 * Todos partem das VENDAS CONCLUÍDAS, nunca de saldos acumulados. Um contador
 * incrementado a cada venda seria mais rápido, mas dessincroniza no primeiro
 * cancelamento que der errado — e um faturamento que não bate com a soma das
 * vendas não serve para decidir nada.
 *
 * A margem usa o custo CONGELADO no item da venda (`unitCostSnapshot`), não o
 * custo atual do produto. Sem isso, atualizar o custo de compra reescreveria a
 * margem histórica de todo mês anterior.
 */

/** Lojas que este usuário pode ver. Dono e desenvolvedor veem todas. */
async function reachableStores(request: FastifyRequest, storeId?: string): Promise<string[] | null> {
  if (storeId) {
    await assertStoreAccess(request, storeId);
    return [storeId];
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";
  return seesEverything ? null : request.user.storeIds;
}

function parseRange(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);

  if (start > end) {
    throw badRequest("INVALID_RANGE", "A data inicial é depois da final.");
  }

  return { start, end };
}

export async function salesSummary(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  const { request, storeId, from, to } = params;
  const stores = await reachableStores(request, storeId);
  const { start, end } = parseRange(from, to);

  const where: Prisma.SaleWhereInput = {
    companyId: request.user.companyId,
    status: "CONCLUIDA",
    completedAt: { gte: start, lte: end },
    ...(stores ? { storeId: { in: stores } } : {}),
  };

  const [totals, sales] = await Promise.all([
    prisma.sale.aggregate({
      where,
      _sum: { totalAmount: true, discountAmount: true, subtotalAmount: true },
      _count: true,
    }),
    prisma.sale.findMany({
      where,
      select: {
        totalAmount: true,
        items: { select: { quantity: true, totalAmount: true, unitCostSnapshot: true } },
      },
    }),
  ]);

  // Custo e peças saem dos itens: `sale.totalAmount` não sabe o que foi vendido.
  let cost = new Prisma.Decimal(0);
  let pieces = 0;

  for (const sale of sales) {
    for (const item of sale.items) {
      pieces += item.quantity;
      if (item.unitCostSnapshot) {
        cost = cost.plus(item.unitCostSnapshot.mul(item.quantity));
      }
    }
  }

  const revenue = totals._sum.totalAmount ?? new Prisma.Decimal(0);
  const margin = revenue.minus(cost);

  return {
    periodo: { de: start, ate: end },
    vendas: totals._count,
    pecas: pieces,
    faturamento: revenue.toFixed(2),
    descontoConcedido: (totals._sum.discountAmount ?? new Prisma.Decimal(0)).toFixed(2),
    custo: cost.toFixed(2),
    margem: margin.toFixed(2),
    /** Percentual da margem sobre o faturamento. Zero quando não houve venda. */
    margemPercentual: revenue.isZero() ? "0.00" : margin.div(revenue).mul(100).toFixed(2),
    ticketMedio: totals._count === 0 ? "0.00" : revenue.div(totals._count).toFixed(2),
  };
}

export async function salesBySeller(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  const { request, storeId, from, to } = params;
  const stores = await reachableStores(request, storeId);
  const { start, end } = parseRange(from, to);

  const grouped = await prisma.sale.groupBy({
    by: ["sellerId"],
    where: {
      companyId: request.user.companyId,
      status: "CONCLUIDA",
      completedAt: { gte: start, lte: end },
      ...(stores ? { storeId: { in: stores } } : {}),
    },
    _sum: { totalAmount: true, discountAmount: true },
    _count: true,
  });

  const sellers = await prisma.user.findMany({
    where: { id: { in: grouped.map((row) => row.sellerId) } },
    select: { id: true, name: true, employeeCode: true },
  });

  const byId = new Map(sellers.map((seller) => [seller.id, seller]));

  return grouped
    .map((row) => {
      const total = row._sum.totalAmount ?? new Prisma.Decimal(0);
      return {
        sellerId: row.sellerId,
        nome: byId.get(row.sellerId)?.name ?? "—",
        matricula: byId.get(row.sellerId)?.employeeCode ?? "—",
        vendas: row._count,
        faturamento: total.toFixed(2),
        descontoConcedido: (row._sum.discountAmount ?? new Prisma.Decimal(0)).toFixed(2),
        ticketMedio: row._count === 0 ? "0.00" : total.div(row._count).toFixed(2),
      };
    })
    .sort((a, b) => Number(b.faturamento) - Number(a.faturamento));
}

/** As peças que mais saem — o que repor primeiro. */
export async function topProducts(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
}) {
  const { request, storeId, from, to, limit } = params;
  const stores = await reachableStores(request, storeId);
  const { start, end } = parseRange(from, to);

  const grouped = await prisma.saleItem.groupBy({
    by: ["productId", "productName", "productSku"],
    where: {
      sale: {
        companyId: request.user.companyId,
        status: "CONCLUIDA",
        completedAt: { gte: start, lte: end },
        ...(stores ? { storeId: { in: stores } } : {}),
      },
    },
    _sum: { quantity: true, totalAmount: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: Math.min(limit ?? 20, 100),
  });

  return grouped.map((row) => ({
    productId: row.productId,
    nome: row.productName,
    sku: row.productSku,
    pecasVendidas: row._sum.quantity ?? 0,
    faturamento: (row._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
  }));
}

/** Como o dinheiro entrou — base para conferir com as operadoras. */
export async function paymentBreakdown(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  const { request, storeId, from, to } = params;
  const stores = await reachableStores(request, storeId);
  const { start, end } = parseRange(from, to);

  const grouped = await prisma.salePayment.groupBy({
    by: ["method"],
    where: {
      sale: {
        companyId: request.user.companyId,
        status: "CONCLUIDA",
        completedAt: { gte: start, lte: end },
        ...(stores ? { storeId: { in: stores } } : {}),
      },
    },
    _sum: { amount: true },
    _count: true,
  });

  return grouped
    .map((row) => ({
      metodo: row.method,
      transacoes: row._count,
      total: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));
}

/**
 * Diferenças de caixa no período.
 *
 * É o relatório que interessa olhar toda semana: turno que fecha com falta
 * repetida no mesmo caixa, ou sempre com a mesma pessoa, é o sinal que o
 * fechamento cego existe para produzir.
 */
export async function cashDifferences(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}) {
  const { request, storeId, from, to } = params;
  const stores = await reachableStores(request, storeId);
  const { start, end } = parseRange(from, to);

  const sessions = await prisma.cashSession.findMany({
    where: {
      companyId: request.user.companyId,
      status: "FECHADO",
      closedAt: { gte: start, lte: end },
      ...(stores ? { storeId: { in: stores } } : {}),
    },
    include: {
      store: { select: { name: true } },
      cashRegister: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
    orderBy: { closedAt: "desc" },
  });

  const withDifference = sessions.filter(
    (session) => session.differenceAmount && !session.differenceAmount.isZero(),
  );

  const totalDifference = withDifference.reduce(
    (sum, session) => sum.plus(session.differenceAmount ?? 0),
    new Prisma.Decimal(0),
  );

  return {
    periodo: { de: start, ate: end },
    turnosFechados: sessions.length,
    turnosComDiferenca: withDifference.length,
    diferencaAcumulada: totalDifference.toFixed(2),
    turnos: withDifference.map((session) => ({
      code: session.code,
      loja: session.store.name,
      caixa: session.cashRegister.name,
      fechadoPor: session.closedBy?.name ?? "—",
      fechadoEm: session.closedAt,
      contado: session.countedAmount?.toFixed(2) ?? "0.00",
      esperado: session.expectedAmount?.toFixed(2) ?? "0.00",
      diferenca: session.differenceAmount?.toFixed(2) ?? "0.00",
      motivo: session.differenceReason,
    })),
  };
}
