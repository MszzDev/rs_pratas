import { Prisma } from "@prisma/client";
import type { AuditAction, AuditResult } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";

export interface AuditInput {
  action: AuditAction;
  result: AuditResult;
  companyId?: string | null;
  storeId?: string | null;
  posStationId?: string | null;
  /// Amarra o evento ao caixa — sem isso, uma venda ou sangria fica no ar
  /// dentro da loja e a conferencia nao consegue reconstruir de qual gaveta veio.
  cashRegisterId?: string | null;
  deviceId?: string | null;
  userId?: string | null;
  userRoleSnapshot?: string | null;
  sessionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  previousData?: Prisma.InputJsonValue;
  newData?: Prisma.InputJsonValue;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Registra um evento de auditoria. Append-only por contrato: este serviço só
 * expõe criação — não há update nem delete, nem para o dono. Correção de um
 * registro errado é sempre um NOVO evento.
 *
 * Falha de auditoria nunca derruba a operação de negócio em curso (um erro ao
 * gravar log não pode impedir um login legítimo), mas é logada em nível de erro
 * para investigação.
 */
export async function audit(request: FastifyRequest | null, input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        result: input.result,
        companyId: input.companyId ?? null,
        storeId: input.storeId ?? null,
        posStationId: input.posStationId ?? null,
        cashRegisterId: input.cashRegisterId ?? null,
        deviceId: input.deviceId ?? null,
        userId: input.userId ?? null,
        userRoleSnapshot: input.userRoleSnapshot ?? null,
        sessionId: input.sessionId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        previousData: input.previousData ?? Prisma.JsonNull,
        newData: input.newData ?? Prisma.JsonNull,
        reason: input.reason ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        ipAddress: request?.ip ?? null,
        userAgent: request?.headers["user-agent"] ?? null,
      },
    });
  } catch (error) {
    request?.log.error({ err: error, action: input.action }, "falha ao gravar auditoria");
  }
}
