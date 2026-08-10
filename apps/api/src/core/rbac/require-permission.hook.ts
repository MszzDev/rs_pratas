import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionCode } from "@rs-pratas/shared";
import { audit } from "../audit.service.js";
import { forbidden } from "../errors.js";
import { getEffectivePermissions } from "./permissions.engine.js";

/**
 * Exige uma permissão granular. Toda negativa é auditada — tentativa de acesso
 * indevido é informação de segurança, não ruído.
 */
export function requirePermission(code: PermissionCode) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const permissions = await getEffectivePermissions(request.user.sub);

    if (!permissions.has(code)) {
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
  };
}
