import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Comissões e metas.
 *
 * A comissão é CALCULADA a partir das vendas, nunca acumulada num campo. Um
 * saldo incrementado a cada venda ficaria errado no primeiro cancelamento — e
 * comissão errada é dinheiro que alguém recebeu a mais ou a menos.
 *
 * A regra é versionada por período: a comissão de março continua sendo
 * calculada pela regra de março, mesmo que a regra mude em abril. Editar no
 * lugar reescreveria o que já foi pago.
 */

export async function createCommissionRule(params: {
  input: {
    name: string;
    percent: number;
    basis?: "FATURAMENTO" | "MARGEM" | undefined;
    storeId?: string | undefined;
    userId?: string | undefined;
    minimumSalesAmount?: number | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  if (input.storeId) {
    await assertStoreAccess(request, input.storeId);
  }

  if (input.userId) {
    const user = await prisma.user.findFirst({
      where: { id: input.userId, companyId: request.user.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      throw notFound("USER_NOT_FOUND", "Funcionário não encontrado.");
    }
  }

  const rule = await prisma.$transaction(async (tx) => {
    // Encerra a regra vigente da mesma abrangência em vez de sobrescrever: o
    // histórico precisa continuar explicando as comissões já calculadas.
    await tx.commissionRule.updateMany({
      where: {
        companyId: request.user.companyId,
        storeId: input.storeId ?? null,
        userId: input.userId ?? null,
        isActive: true,
        effectiveTo: null,
      },
      data: { isActive: false, effectiveTo: new Date() },
    });

    return tx.commissionRule.create({
      data: {
        companyId: request.user.companyId,
        storeId: input.storeId ?? null,
        userId: input.userId ?? null,
        name: input.name,
        basis: input.basis ?? "FATURAMENTO",
        percent: input.percent,
        minimumSalesAmount: input.minimumSalesAmount ?? 0,
        createdById: request.user.sub,
      },
    });
  });

  await audit(request, {
    action: "COMMISSION_RULE_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId ?? null,
    userRoleSnapshot: request.user.role,
    entityType: "CommissionRule",
    entityId: rule.id,
    newData: {
      name: rule.name,
      percent: rule.percent.toFixed(3),
      basis: rule.basis,
      alcance: input.userId ? "vendedor" : input.storeId ? "loja" : "rede",
    },
  });

  return rule;
}

export async function listCommissionRules(request: FastifyRequest) {
  return prisma.commissionRule.findMany({
    where: { companyId: request.user.companyId },
    include: {
      store: { select: { name: true } },
      user: { select: { name: true, employeeCode: true } },
    },
    orderBy: [{ isActive: "desc" }, { effectiveFrom: "desc" }],
  });
}

/**
 * A regra que vale para este vendedor nesta loja.
 *
 * Do mais específico ao mais geral: regra do vendedor vence regra da loja, que
 * vence regra da rede. Sem essa ordem, um acerto individual seria anulado pelo
 * padrão da loja.
 */
async function resolveRule(params: { companyId: string; storeId: string; userId: string }) {
  const candidates = await prisma.commissionRule.findMany({
    where: {
      companyId: params.companyId,
      isActive: true,
      OR: [
        { userId: params.userId },
        { userId: null, storeId: params.storeId },
        { userId: null, storeId: null },
      ],
    },
  });

  return (
    candidates.find((rule) => rule.userId === params.userId) ??
    candidates.find((rule) => rule.userId === null && rule.storeId === params.storeId) ??
    candidates.find((rule) => rule.userId === null && rule.storeId === null) ??
    null
  );
}

/**
 * Calcula a comissão de cada vendedor no período.
 *
 * Vendas canceladas ficam de fora: comissionar o que voltou para a prateleira
 * pagaria pelo mesmo item duas vezes quando ele fosse vendido de novo.
 */
export async function calculateCommissions(params: {
  request: FastifyRequest;
  from: string;
  to: string;
  storeId?: string | undefined;
}) {
  const { request, from, to, storeId } = params;

  const start = new Date(from);
  const end = new Date(to);
  if (start > end) {
    throw badRequest("INVALID_RANGE", "A data inicial é depois da final.");
  }

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";
  const stores = storeId
    ? [storeId]
    : seesEverything
      ? null
      : request.user.storeIds;

  const sales = await prisma.sale.findMany({
    where: {
      companyId: request.user.companyId,
      status: "CONCLUIDA",
      completedAt: { gte: start, lte: end },
      ...(stores ? { storeId: { in: stores } } : {}),
    },
    select: {
      sellerId: true,
      storeId: true,
      totalAmount: true,
      items: { select: { quantity: true, totalAmount: true, unitCostSnapshot: true } },
      seller: { select: { name: true, employeeCode: true } },
    },
  });

  /** Acumula por vendedor + loja: quem atende em duas lojas tem duas regras. */
  const byKey = new Map<
    string,
    {
      sellerId: string;
      storeId: string;
      nome: string;
      matricula: string;
      faturamento: Prisma.Decimal;
      custo: Prisma.Decimal;
      vendas: number;
    }
  >();

  for (const sale of sales) {
    const key = `${sale.sellerId}:${sale.storeId}`;
    const current = byKey.get(key) ?? {
      sellerId: sale.sellerId,
      storeId: sale.storeId,
      nome: sale.seller.name,
      matricula: sale.seller.employeeCode,
      faturamento: new Prisma.Decimal(0),
      custo: new Prisma.Decimal(0),
      vendas: 0,
    };

    current.faturamento = current.faturamento.plus(sale.totalAmount);
    current.vendas += 1;

    for (const item of sale.items) {
      if (item.unitCostSnapshot) {
        current.custo = current.custo.plus(item.unitCostSnapshot.mul(item.quantity));
      }
    }

    byKey.set(key, current);
  }

  const result = [];

  for (const entry of byKey.values()) {
    const rule = await resolveRule({
      companyId: request.user.companyId,
      storeId: entry.storeId,
      userId: entry.sellerId,
    });

    if (!rule) {
      result.push({
        ...serializeEntry(entry),
        regra: null,
        comissao: "0.00",
        observacao: "Nenhuma regra de comissão cadastrada para este vendedor.",
      });
      continue;
    }

    const base = rule.basis === "MARGEM" ? entry.faturamento.minus(entry.custo) : entry.faturamento;

    // Piso não atingido: nada a pagar, mas o registro mostra o porquê.
    const belowMinimum = entry.faturamento.lessThan(rule.minimumSalesAmount);

    const commission = belowMinimum
      ? new Prisma.Decimal(0)
      : // Margem negativa não gera comissão negativa — a loja não cobra do
        // vendedor por uma venda ruim, apenas não comissiona.
        Prisma.Decimal.max(base, 0).mul(rule.percent).div(100);

    result.push({
      ...serializeEntry(entry),
      regra: {
        nome: rule.name,
        percent: rule.percent.toFixed(3),
        base: rule.basis,
        minimo: rule.minimumSalesAmount.toFixed(2),
      },
      comissao: commission.toFixed(2),
      observacao: belowMinimum
        ? `Não atingiu o mínimo de R$ ${rule.minimumSalesAmount.toFixed(2)} no período.`
        : null,
    });
  }

  return {
    periodo: { de: start, ate: end },
    vendedores: result.sort((a, b) => Number(b.comissao) - Number(a.comissao)),
  };
}

function serializeEntry(entry: {
  sellerId: string;
  storeId: string;
  nome: string;
  matricula: string;
  faturamento: Prisma.Decimal;
  custo: Prisma.Decimal;
  vendas: number;
}) {
  return {
    sellerId: entry.sellerId,
    storeId: entry.storeId,
    nome: entry.nome,
    matricula: entry.matricula,
    vendas: entry.vendas,
    faturamento: entry.faturamento.toFixed(2),
    margem: entry.faturamento.minus(entry.custo).toFixed(2),
  };
}

// =====================================================================
// METAS
// =====================================================================

export async function createGoal(params: {
  input: {
    storeId: string;
    scope: "LOJA" | "VENDEDOR";
    userId?: string | undefined;
    period: "DIARIA" | "SEMANAL" | "MENSAL";
    periodStart: string;
    periodEnd: string;
    targetAmount: number;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  if (input.scope === "VENDEDOR" && !input.userId) {
    throw badRequest("USER_REQUIRED", "Escolha o vendedor da meta.");
  }

  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  if (end <= start) {
    throw badRequest("INVALID_PERIOD", "O fim do período precisa ser depois do início.");
  }

  const goal = await prisma.goal.create({
    data: {
      companyId: request.user.companyId,
      storeId: input.storeId,
      scope: input.scope,
      userId: input.scope === "VENDEDOR" ? (input.userId ?? null) : null,
      period: input.period,
      periodStart: start,
      periodEnd: end,
      targetAmount: input.targetAmount,
      notes: input.notes ?? null,
      createdById: request.user.sub,
    },
  });

  await audit(request, {
    action: "GOAL_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Goal",
    entityId: goal.id,
    newData: {
      scope: goal.scope,
      targetAmount: goal.targetAmount.toFixed(2),
      periodo: `${input.periodStart} a ${input.periodEnd}`,
    },
  });

  return goal;
}

/**
 * Metas com o realizado calculado das vendas do período.
 *
 * O percentual sai daqui e não de um campo guardado: meta que mostra progresso
 * defasado é pior que meta nenhuma, porque leva a decidir sobre número velho.
 */
export async function listGoalsWithProgress(params: {
  request: FastifyRequest;
  storeId?: string | undefined;
  activeOnly?: boolean | undefined;
}) {
  const { request, storeId, activeOnly } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";
  const now = new Date();

  const goals = await prisma.goal.findMany({
    where: {
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
      ...(activeOnly ? { periodStart: { lte: now }, periodEnd: { gte: now } } : {}),
    },
    include: {
      store: { select: { name: true } },
      user: { select: { name: true, employeeCode: true } },
    },
    orderBy: { periodStart: "desc" },
    take: 100,
  });

  const withProgress = [];

  for (const goal of goals) {
    const achieved = await prisma.sale.aggregate({
      where: {
        companyId: goal.companyId,
        storeId: goal.storeId,
        status: "CONCLUIDA",
        completedAt: { gte: goal.periodStart, lte: goal.periodEnd },
        ...(goal.userId ? { sellerId: goal.userId } : {}),
      },
      _sum: { totalAmount: true },
    });

    const realized = achieved._sum.totalAmount ?? new Prisma.Decimal(0);
    const percent = goal.targetAmount.isZero()
      ? new Prisma.Decimal(0)
      : realized.div(goal.targetAmount).mul(100);

    withProgress.push({
      id: goal.id,
      loja: goal.store.name,
      escopo: goal.scope,
      vendedor: goal.user?.name ?? null,
      periodo: goal.period,
      inicio: goal.periodStart,
      fim: goal.periodEnd,
      meta: goal.targetAmount.toFixed(2),
      realizado: realized.toFixed(2),
      percentual: percent.toFixed(1),
      atingida: realized.greaterThanOrEqualTo(goal.targetAmount),
      /** Quanto falta. Zero quando a meta já foi batida. */
      falta: Prisma.Decimal.max(goal.targetAmount.minus(realized), 0).toFixed(2),
    });
  }

  return withProgress;
}
