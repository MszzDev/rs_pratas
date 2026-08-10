import type { PermissionEffect } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { redis } from "../../db/redis.js";

const CACHE_PREFIX = "perm:";
const CACHE_TTL_SECONDS = 300;

/**
 * Resolve as permissões efetivas do usuário.
 *
 * Ordem de precedência:
 *   1. Permissões padrão do perfil (RolePermission)
 *   2. Overrides individuais (UserPermission), onde DENY SEMPRE vence sobre
 *      ALLOW e sobre o padrão do perfil.
 *
 * DENY tem a última palavra de propósito: é o mecanismo para tirar uma
 * capacidade de alguém sem rebaixar o perfil inteiro — por exemplo, um gerente
 * que perde o direito de autorizar desconto após um incidente. Se ALLOW
 * vencesse, uma concessão antiga esquecida anularia a restrição nova.
 *
 * Overrides expirados ou revogados são ignorados.
 */
export async function getEffectivePermissions(userId: string): Promise<Set<string>> {
  const cacheKey = `${CACHE_PREFIX}${userId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return new Set(JSON.parse(cached) as string[]);
    }
  } catch {
    // Redis indisponível não pode derrubar a autorização — segue direto no banco.
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) {
    return new Set();
  }

  const [rolePermissions, overrides] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { role: { code: user.role } },
      select: { permission: { select: { code: true } } },
    }),
    prisma.userPermission.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { effect: true, permission: { select: { code: true } } },
    }),
  ]);

  const effective = new Set(rolePermissions.map((entry) => entry.permission.code));

  const denied = new Set<string>();
  for (const override of overrides) {
    const code = override.permission.code;
    if ((override.effect as PermissionEffect) === "DENY") {
      denied.add(code);
    } else {
      effective.add(code);
    }
  }

  // DENY aplicado por último, sobre tudo.
  for (const code of denied) {
    effective.delete(code);
  }

  try {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify([...effective]));
  } catch {
    // Cache é otimização, não requisito.
  }

  return effective;
}

/**
 * Descarta o cache de permissões do usuário. Precisa ser chamado sempre que
 * uma permissão, o perfil ou o status mudarem — caso contrário a alteração só
 * valeria depois do TTL, e uma revogação de emergência ficaria minutos parada.
 */
export async function invalidatePermissionCache(userId: string): Promise<void> {
  try {
    await redis.del(`${CACHE_PREFIX}${userId}`);
  } catch {
    // Sem Redis, a próxima leitura já vai direto ao banco.
  }
}
