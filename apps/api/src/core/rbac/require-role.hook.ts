import type { UserRole } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { forbidden, notFound } from "../errors.js";

/**
 * Checagem por perfil. É a camada grossa; o controle fino por permissão
 * (requirePermission, com Role + UserPermission e efeito DENY) entra junto com
 * o motor de RBAC.
 */
export function requireRole(...allowed: UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!allowed.includes(request.user.role as UserRole)) {
      throw forbidden("FORBIDDEN_ROLE", "Você não tem permissão para esta ação.");
    }
  };
}

/**
 * O usuário pode operar nesta loja?
 *
 * Versão sem exceção, para uso dentro de serviços que precisam decidir o que
 * fazer com a resposta. DONO e DESENVOLVEDOR alcançam qualquer loja da própria
 * empresa — nunca de outra.
 */
export async function userCanAccessStore(params: {
  userId: string;
  role: string;
  companyId: string;
  storeId: string;
}): Promise<boolean> {
  const store = await prisma.store.findFirst({
    where: { id: params.storeId, companyId: params.companyId, deletedAt: null },
    select: { id: true },
  });

  if (!store) return false;

  if (params.role === "DONO" || params.role === "DESENVOLVEDOR") {
    return true;
  }

  const link = await prisma.userStore.findUnique({
    where: { userId_storeId: { userId: params.userId, storeId: params.storeId } },
    select: { id: true },
  });

  return link !== null;
}

/**
 * Confirma que o usuário pode acessar aquela loja.
 *
 * Responde 404 (e não 403) quando a loja existe mas não é dele: um 403 confirma
 * que o ID existe e permite mapear a rede de lojas por tentativa e erro.
 * DONO e DESENVOLVEDOR enxergam todas as lojas da própria empresa — nunca de
 * outra empresa.
 */
export async function assertStoreAccess(
  request: FastifyRequest,
  storeId: string,
  opcoes?: {
    /**
     * Aceita loja já removida.
     *
     * Só para LIMPAR o que ficou para trás. Removida a loja, o que apontava
     * para ela vira órfão — e a verificação normal, que exige loja viva,
     * transforma esse órfão em lixo permanente: a meta de uma loja fechada não
     * podia ser apagada, porque a loja não existia mais para autorizar.
     *
     * É justamente o registro que mais se quer apagar, e o único caminho era
     * mexer no banco à mão.
     *
     * Continua valendo tudo o mais: a permissão da rota, o escopo da empresa e
     * o vínculo do usuário com a loja. O que muda é só não exigir que a loja
     * esteja viva.
     */
    incluirRemovidas?: boolean;
  },
): Promise<void> {
  const store = await prisma.store.findFirst({
    where: {
      id: storeId,
      companyId: request.user.companyId,
      ...(opcoes?.incluirRemovidas ? {} : { deletedAt: null }),
    },
    select: { id: true },
  });

  if (!store) {
    throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
  }

  if (request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR") {
    return;
  }

  const link = await prisma.userStore.findUnique({
    where: { userId_storeId: { userId: request.user.sub, storeId } },
    select: { id: true },
  });

  if (!link) {
    throw notFound("STORE_NOT_FOUND", "Loja não encontrada.");
  }
}
