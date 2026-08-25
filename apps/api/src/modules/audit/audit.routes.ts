import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AuditAction, AuditResult } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";

/**
 * Assuntos, em vez de nomes de evento.
 *
 * Ninguém abre a auditoria pensando "quero ver STOCK_ADJUST". Abre pensando
 * "mexeram no meu estoque", "alguém tentou entrar e não conseguiu", "quem deu
 * esse desconto". Os grupos existem para que a pergunta que a pessoa tem na
 * cabeça vire um clique, e não uma lista de trinta constantes para escolher.
 *
 * O agrupamento fica no servidor porque é conhecimento do domínio: quando um
 * evento novo nascer, ele entra no assunto certo aqui, e todas as telas
 * passam a encontrá-lo.
 */
const ASSUNTOS = {
  dinheiro: [
    "SALE_COMPLETE",
    "SALE_CANCEL",
    "SALE_DISCOUNT_AUTHORIZED",
    "CASH_OPEN",
    "CASH_CLOSE",
    "CASH_WITHDRAWAL",
    "CASH_SUPPLY",
    "REFUND_ISSUED",
    "PRICE_CHANGE",
  ],
  pessoas: [
    "LOGIN_SUCCESS",
    "LOGIN_FAILED",
    "LOGOUT",
    "LOGOUT_ALL",
    "USER_CREATE",
    "USER_UPDATE",
    "USER_BLOCK",
    "USER_UNBLOCK",
    "USER_ROLE_CHANGE",
    "USER_PROMOTE_TO_OWNER",
    "PERMISSION_GRANT",
    "PERMISSION_REVOKE",
    "PASSWORD_CHANGE",
    "PIN_CHANGE",
    "PIN_SET",
    "SESSION_REVOKE",
    "SESSION_REUSE_DETECTED",
  ],
  aparelhos: [
    "DEVICE_PAIR_INITIATED",
    "DEVICE_PAIR_CLAIMED",
    "DEVICE_UPDATE",
    "DEVICE_UNLINK",
    "DEVICE_BLOCK",
    "DEVICE_KIOSK_EXIT",
    "TERMINAL_CREATE",
    "TERMINAL_MOVE",
    "TERMINAL_REPLACE",
    "TERMINAL_STATUS_CHANGE",
  ],
  estoque: [
    "PRODUCT_CREATE",
    "PRODUCT_UPDATE",
    "PRODUCT_DELETE",
    "STOCK_ADJUST",
    "STOCK_TRANSFER",
    "STOCK_COUNT",
    "PRODUCT_IMAGE_SET",
  ],
  ponto: [
    "TIMECLOCK_ENTRY_CREATE",
    "TIMECLOCK_CORRECTION",
    "WORK_SCHEDULE_CREATE",
    "WORK_SCHEDULE_UPDATE",
  ],
} as const;

/**
 * Só os nomes que existem de fato no enum.
 *
 * As listas acima são escritas à mão e o catálogo de eventos muda com o tempo:
 * um nome que ainda não existe (ou que foi renomeado) é descartado aqui em vez
 * de derrubar a consulta inteira com erro do banco.
 */
function acoesDoAssunto(assunto: keyof typeof ASSUNTOS): AuditAction[] {
  const nomesValidos = new Set<string>(Object.keys(AuditAction));

  return ASSUNTOS[assunto].filter((nome) => nomesValidos.has(nome)) as unknown as AuditAction[];
}

const querySchema = z.object({
  action: z.nativeEnum(AuditAction).optional(),
  /** Agrupamento por assunto — o jeito como as perguntas realmente aparecem. */
  topic: z.enum(["dinheiro", "pessoas", "aparelhos", "estoque", "ponto"]).optional(),
  result: z.nativeEnum(AuditResult).optional(),
  userId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Paginação por cursor: o histórico cresce sem parar. */
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Campos que nunca vão para a tela da auditoria.
 *
 * Identificador interno não diz nada a quem lê, e credencial não pode circular
 * nem em forma de "antes e depois". A lista é por SUFIXO porque é assim que os
 * nomes se repetem no sistema inteiro (`userId`, `storeId`, `passwordHash`).
 */
const CAMPOS_OCULTOS = ["id", "Id", "hash", "Hash", "token", "Token", "secret", "Secret"];

const ocultar = (campo: string) =>
  CAMPOS_OCULTOS.some((sufixo) => campo === sufixo || campo.endsWith(sufixo));

/** O que mudou entre o antes e o depois, em pares legíveis. */
function diferencas(
  antes: unknown,
  depois: unknown,
): Array<{ campo: string; de: unknown; para: unknown }> {
  const anterior = (antes ?? {}) as Record<string, unknown>;
  const novo = (depois ?? {}) as Record<string, unknown>;

  const campos = new Set([...Object.keys(anterior), ...Object.keys(novo)]);
  const mudancas: Array<{ campo: string; de: unknown; para: unknown }> = [];

  for (const campo of campos) {
    if (ocultar(campo)) continue;

    const de = anterior[campo];
    const para = novo[campo];

    // Comparação por texto: os valores vêm de JSON, então objetos iguais têm
    // a mesma serialização e a igualdade estrita falharia neles.
    if (JSON.stringify(de) === JSON.stringify(para)) continue;

    mudancas.push({ campo, de: de ?? null, para: para ?? null });
  }

  // Um registro com trinta campos alterados vira parede de texto. Os
  // primeiros bastam para a pessoa reconhecer o que aconteceu e abrir o
  // registro completo se precisar.
  return mudancas.slice(0, 8);
}

export async function auditRoutes(app: FastifyInstance) {
  /**
   * Consulta do histórico. Somente leitura por definição — não existe endpoint
   * de escrita nem de exclusão, e o banco recusaria de qualquer forma.
   *
   * O gerente enxerga a própria loja; dono e desenvolvedor, a empresa toda —
   * a mesma regra do espelho de ponto.
   */
  app.get(
    "/audit",
    { preHandler: [app.requireAuth, requirePermission("AUDIT_VIEW_STORE")] },
    async (request) => {
      const query = querySchema.parse(request.query);
      const seesEverything =
        request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

      const entries = await prisma.auditLog.findMany({
        where: {
          companyId: request.user.companyId,
          ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
          ...(query.action ? { action: query.action } : {}),
          ...(query.topic && !query.action ? { action: { in: acoesDoAssunto(query.topic) } } : {}),
          ...(query.result ? { result: query.result } : {}),
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.storeId ? { storeId: query.storeId } : {}),
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
        include: { user: { select: { name: true, employeeCode: true } } },
        orderBy: { createdAt: "desc" },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const hasMore = entries.length > query.limit;
      const page = hasMore ? entries.slice(0, query.limit) : entries;

      return {
        entries: page.map((entry) => ({
          id: entry.id,
          action: entry.action,
          result: entry.result,
          entityType: entry.entityType,
          entityId: entry.entityId,
          reason: entry.reason,
          ipAddress: entry.ipAddress,
          createdAt: entry.createdAt,
          userRoleSnapshot: entry.userRoleSnapshot,
          user: entry.user,
          storeId: entry.storeId,
          deviceId: entry.deviceId,
          /**
           * O que mudou, campo a campo.
           *
           * É a resposta para a pergunta que leva alguém à auditoria — "quem
           * mudou este preço?" —, e ela não estava lá: o registro guardava o
           * antes e o depois, e a tela mostrava só o nome do evento.
           */
          changes: diferencas(entry.previousData, entry.newData),
        })),
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      };
    },
  );
}
