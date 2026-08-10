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
): Promise<void> {
  const store = await prisma.store.findFirst({
    where: { id: storeId, companyId: request.user.companyId, deletedAt: null },
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
