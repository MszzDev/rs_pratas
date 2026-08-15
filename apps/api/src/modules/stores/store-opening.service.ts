import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * Abertura e fechamento de loja.
 *
 * "Aberta" aqui é estado operacional — a loja está funcionando agora — e não
 * se confunde com `isActive`, que é o cadastro existir. Uma loja ativa fica
 * fechada toda noite; uma loja desativada não abre nunca mais.
 *
 * A loja abre SOZINHA quando alguém entra por PIN num tablet dela: o
 * funcionário chegou, ligou o tablet e passou o PIN — a loja está funcionando,
 * e pedir que ele aperte "abrir loja" logo depois seria um passo que não
 * informa nada.
 *
 * Fechar é sempre ato explícito. Deixar a loja fechar sozinha por inatividade
 * esconderia o caso que importa: o tablet que ficou ligado a noite toda.
 */

/**
 * Chamado no login por PIN. Nunca lança: se a abertura falhar, o funcionário
 * ainda precisa conseguir entrar e bater o ponto.
 */
export async function openStoreOnDeviceLogin(params: {
  storeId: string;
  userId: string;
  deviceId: string;
  request: FastifyRequest;
}): Promise<void> {
  try {
    const store = await prisma.store.findFirst({
      where: { id: params.storeId, deletedAt: null },
      select: { id: true, companyId: true, isActive: true, isOpen: true, name: true },
    });

    if (!store || !store.isActive || store.isOpen) return;

    await prisma.store.update({
      where: { id: store.id },
      data: {
        isOpen: true,
        openedAt: new Date(),
        openedById: params.userId,
        openedByDeviceId: params.deviceId,
        closedAt: null,
        closedById: null,
      },
    });

    await audit(params.request, {
      action: "STORE_OPEN",
      result: "SUCCESS",
      userId: params.userId,
      companyId: store.companyId,
      storeId: store.id,
      deviceId: params.deviceId,
      entityType: "Store",
      entityId: store.id,
      newData: { isOpen: true },
      reason: "aberta automaticamente pelo login no tablet da loja",
    });
  } catch (error) {
    params.request.log.error(
      { err: error, storeId: params.storeId },
      "falha ao abrir a loja no login por PIN",
    );
  }
}

/**
 * Abertura manual — o dono chegando antes da equipe, ou reabrindo depois de
 * ter fechado por engano.
 */
export async function openStore(params: {
  storeId: string;
  request: FastifyRequest;
  reason?: string | undefined;
}) {
  const { storeId, request, reason } = params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!store) {
    throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
  }

  await assertStoreAccess(request, store.id);

  if (!store.isActive) {
    throw badRequest(
      "STORE_INACTIVE",
      "Esta loja está desativada. Reative o cadastro antes de abrir.",
    );
  }
  if (store.isOpen) {
    throw badRequest("STORE_ALREADY_OPEN", "Esta loja já está aberta.");
  }

  const updated = await prisma.store.update({
    where: { id: store.id },
    data: {
      isOpen: true,
      openedAt: new Date(),
      openedById: request.user.sub,
      openedByDeviceId: null,
      closedAt: null,
      closedById: null,
    },
  });

  await audit(request, {
    action: "STORE_OPEN",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: store.companyId,
    storeId: store.id,
    userRoleSnapshot: request.user.role,
    entityType: "Store",
    entityId: store.id,
    newData: { isOpen: true },
    ...(reason ? { reason } : { reason: "aberta manualmente" }),
  });

  return updated;
}

/**
 * Fecha a loja.
 *
 * Recusa se houver caixa aberto: fechar a loja com dinheiro na gaveta e vendas
 * pendentes deixaria o turno órfão, e ninguém conferiria aquele caixa.
 */
export async function closeStore(params: {
  storeId: string;
  reason?: string | undefined;
  request: FastifyRequest;
}) {
  const { storeId, reason, request } = params;

  const store = await prisma.store.findFirst({
    where: { id: storeId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!store) {
    throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
  }

  await assertStoreAccess(request, store.id);

  if (!store.isOpen) {
    throw badRequest("STORE_ALREADY_CLOSED", "Esta loja já está fechada.");
  }

  const openSessions = await prisma.cashSession.count({
    where: { storeId: store.id, status: "ABERTO" },
  });
  if (openSessions > 0) {
    throw badRequest(
      "CASH_STILL_OPEN",
      `Ainda há ${openSessions} caixa(s) aberto(s) nesta loja. Feche o caixa antes de fechar a loja.`,
    );
  }

  const updated = await prisma.store.update({
    where: { id: store.id },
    data: { isOpen: false, closedAt: new Date(), closedById: request.user.sub },
  });

  await audit(request, {
    action: "STORE_CLOSE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: store.companyId,
    storeId: store.id,
    userRoleSnapshot: request.user.role,
    entityType: "Store",
    entityId: store.id,
    previousData: { isOpen: true, openedAt: store.openedAt },
    newData: { isOpen: false },
    ...(reason ? { reason } : {}),
  });

  return updated;
}

/**
 * Painel do dono: como está cada loja da rede agora.
 *
 * É o "controle geral" — quem abriu, há quanto tempo, se tem caixa aberto e
 * quantas pessoas estão trabalhando. O dono precisa disso de fora da loja,
 * sem ligar para ninguém.
 */
export async function getNetworkStatus(request: FastifyRequest) {
  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const stores = await prisma.store.findMany({
    where: {
      companyId: request.user.companyId,
      deletedAt: null,
      ...(seesEverything ? {} : { id: { in: request.user.storeIds } }),
    },
    include: {
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const result = [];

  for (const store of stores) {
    const [openSessions, salesToday, working] = await Promise.all([
      prisma.cashSession.findMany({
        where: { storeId: store.id, status: "ABERTO" },
        select: { id: true, code: true, openedBy: { select: { name: true } } },
      }),
      prisma.sale.aggregate({
        where: { storeId: store.id, status: "CONCLUIDA", completedAt: { gte: startOfDay } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      // Quem bateu entrada hoje e ainda não bateu saída.
      prisma.timeClockEntry.findMany({
        where: { storeId: store.id, timestamp: { gte: startOfDay } },
        select: { userId: true, type: true, timestamp: true },
        orderBy: { timestamp: "asc" },
      }),
    ]);

    const lastEventByUser = new Map<string, string>();
    for (const entry of working) {
      lastEventByUser.set(entry.userId, entry.type);
    }
    const noSalao = [...lastEventByUser.values()].filter(
      (type) => type === "CLOCK_IN" || type === "BREAK_END",
    ).length;

    result.push({
      id: store.id,
      code: store.code,
      name: store.name,
      isActive: store.isActive,
      isOpen: store.isOpen,
      openedAt: store.openedAt,
      openedBy: store.openedBy?.name ?? null,
      /** Abriu sozinha pelo tablet, ou alguém abriu na mão. */
      aberturaAutomatica: store.openedByDeviceId !== null,
      closedAt: store.closedAt,
      closedBy: store.closedBy?.name ?? null,
      caixasAbertos: openSessions.map((session) => ({
        code: session.code,
        responsavel: session.openedBy.name,
      })),
      vendasHoje: salesToday._count,
      faturamentoHoje: (salesToday._sum.totalAmount ?? 0).toString(),
      pessoasTrabalhando: noSalao,
    });
  }

  return result;
}

/**
 * Barra abrir caixa em loja fechada.
 *
 * Venda registrada com a loja fechada não tem como ser explicada depois — e é
 * o padrão que aparece quando alguém usa o sistema fora do expediente.
 */
export async function assertStoreOpen(storeId: string) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { isOpen: true, isActive: true, name: true },
  });

  if (!store) {
    throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
  }
  if (!store.isActive) {
    throw forbidden("STORE_INACTIVE", "Esta loja está desativada.");
  }
  if (!store.isOpen) {
    throw forbidden(
      "STORE_CLOSED",
      `A ${store.name} está fechada. Abra a loja antes de abrir o caixa.`,
    );
  }
}
