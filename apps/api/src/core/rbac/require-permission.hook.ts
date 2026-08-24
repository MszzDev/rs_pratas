import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionCode } from "@rs-pratas/shared";
import { audit } from "../audit.service.js";
import { forbidden } from "../errors.js";
import { getEffectivePermissions } from "./permissions.engine.js";

/**
 * A checagem em si, fora do formato de hook.
 *
 * Existe para quem precisa exigir uma permissão NO MEIO do handler — como a
 * rota de integrações, em que o serviço (Nuvemshop ou Mercado Pago) só é
 * conhecido depois de ler os parâmetros. Chamar o hook com um `reply`
 * inventado funcionaria hoje, porque ele ignora esse parâmetro, e quebraria em
 * silêncio no dia em que deixasse de ignorar.
 */
export async function assertPermission(
  request: FastifyRequest,
  code: PermissionCode,
): Promise<void> {
  const permissions = await getEffectivePermissions(request.user.sub);

  if (permissions.has(code)) return;

  // Toda negativa é auditada — tentativa de acesso indevido é informação de
  // segurança, não ruído.
  await audit(request, {
    action: "PERMISSION_DENIED",
    result: "DENIED",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    reason: `permissão ausente: ${code}`,
    metadata: { requiredPermission: code, path: request.url },
  });

  throw forbidden("FORBIDDEN_PERMISSION", "Você não tem permissão para esta ação.");
}

/** Exige uma permissão granular como preHandler de rota. */
export function requirePermission(code: PermissionCode) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    await assertPermission(request, code);
  };
}
