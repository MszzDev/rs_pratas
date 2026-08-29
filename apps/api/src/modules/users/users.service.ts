import { randomInt } from "node:crypto";
import type { UserRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { ChangeUserRoleInput, CreateUserInput, UpdateUserInput } from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, forbidden, notFound } from "../../core/errors.js";
import { hashSecret } from "../../core/security/password.service.js";
import { invalidatePermissionCache } from "../../core/rbac/permissions.engine.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { emailConfigurado, sendEmail } from "../../core/email/index.js";
import { credentialsEmail, credentialsResetEmail } from "../../core/email/templates.js";
import { generateEmployeeCode, generateTemporaryPassword } from "./credentials.js";

/**
 * O que pode sair do servidor sobre um usuário.
 *
 * Existe porque devolver o objeto do Prisma inteiro entrega `passwordHash` e
 * `pinHash` na resposta. Eles não servem para nada na tela e, uma vez fora do
 * servidor, passam a existir no histórico do navegador, em log de proxy e em
 * qualquer ferramenta de rede aberta no balcão. Hash de senha não sai daqui.
 */
/** Recorta o usuário para o que pode ser exibido. */
function toPublicUser(user: {
  id: string;
  name: string;
  employeeCode: string;
  email: string | null;
  cpf?: string | null;
  role: string;
  status: string;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    employeeCode: user.employeeCode,
    email: user.email,
    cpf: user.cpf ?? null,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Só o DONO cria usuários — o GERENTE nunca, conforme a especificação. E entre
 * os perfis, DONO e DESENVOLVEDOR são os que dão visão irrestrita da empresa,
 * então sua criação exige reautenticação (step-up) na camada de rota.
 */
function assertCanAssignRole(actorRole: string, targetRole: UserRole): void {
  if (actorRole !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode criar ou alterar usuários.");
  }

  // Mantido explícito para o dia em que a criação for delegada a outro perfil.
  if ((targetRole === "DONO" || targetRole === "DESENVOLVEDOR") && actorRole !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode criar esse tipo de usuário.");
  }
}

/**
 * Por que a credencial não foi por e-mail.
 *
 * Um booleano "não enviou" manda o dono adivinhar entre três coisas muito
 * diferentes: o funcionário não tem e-mail cadastrado, o envio está desligado
 * no servidor, ou o provedor recusou. As três se resolvem de formas distintas,
 * e a primeira nem é um problema — é o cadastro sem e-mail, que é permitido.
 *
 * Distinguir importa porque falha de e-mail é silenciosa por desenho: o
 * cadastro nunca é derrubado por ela, então ninguém descobre que o envio está
 * desligado até alguém reclamar que não recebeu.
 */
export type EntregaPorEmail = "ENVIADO" | "SEM_ENDERECO" | "DESLIGADO" | "RECUSADO";

async function entregar(
  destino: string | null,
  montar: (to: string) => Parameters<typeof sendEmail>[0],
): Promise<EntregaPorEmail> {
  if (!destino) return "SEM_ENDERECO";
  if (!emailConfigurado()) return "DESLIGADO";

  return (await sendEmail(montar(destino))) ? "ENVIADO" : "RECUSADO";
}

export async function createUser(params: {
  input: CreateUserInput;
  request: FastifyRequest;
}) {
  const { input, request } = params;
  assertCanAssignRole(request.user.role, input.role);

  const companyId = request.user.companyId;

  for (const storeId of input.storeIds) {
    await assertStoreAccess(request, storeId);
  }

  const employeeCode = await generateEmployeeCode(companyId);
  const temporaryPassword = generateTemporaryPassword();

  /**
   * PIN de entrada, que é como se entra no tablet da loja.
   *
   * Vem junto com a matrícula porque é a credencial que o funcionário vai usar
   * de fato: quem trabalha no balcão entra pelo tablet, e uma senha longa
   * entregue no papel só serviria para ser digitada uma vez e esquecida.
   *
   * Nasce VENCIDO — `pinChangedAt` fica nulo. Assim ele serve para a primeira
   * entrada e o sistema já pede a troca, em vez de deixar valendo por trinta
   * dias um PIN que passou por um papel e pela mão de duas pessoas.
   */
  const temporaryPin = String(randomInt(100_000, 1_000_000));

  // Argon2id é caro de propósito (~100ms). Fora da transação, para não segurar
  // uma conexão do pool durante o hash.
  const [passwordHash, pinHash] = await Promise.all([
    hashSecret(temporaryPassword),
    hashSecret(temporaryPin),
  ]);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId,
        employeeCode,
        name: input.name,
        email: input.email ?? null,
        cpf: input.cpf || null,
        role: input.role,
        // ATIVO, e não "aguardando primeiro acesso": com o PIN temporário em
        // mãos a pessoa entra no tablet no primeiro dia, sem depender de um
        // computador para concluir cadastro nenhum. A troca continua sendo
        // exigida — do PIN, na primeira entrada; da senha, se ela algum dia
        // entrar pelo computador.
        status: "ACTIVE",
        passwordHash,
        pinHash,
        // Nulo de propósito: é o que faz o sistema tratar este PIN como
        // vencido e pedir um novo assim que a pessoa entrar.
        pinChangedAt: null,
        mustChangePassword: true,
        mustCreatePin: false,
        createdById: request.user.sub,
      },
    });

    if (input.storeIds.length > 0) {
      await tx.userStore.createMany({
        data: input.storeIds.map((storeId, index) => ({
          userId: created.id,
          storeId,
          isPrimary: index === 0,
        })),
      });
    }

    return created;
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { tradeName: true },
  });

  const entregaPorEmail = await entregar(user.email, (to) =>
    credentialsEmail({
      to,
      name: user.name,
      employeeCode: user.employeeCode,
      temporaryPassword,
      temporaryPin,
      companyName: company.tradeName,
    }),
  );

  const emailSent = entregaPorEmail === "ENVIADO";

  await audit(request, {
    action: "USER_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    newData: {
      name: user.name,
      employeeCode: user.employeeCode,
      email: user.email,
      role: user.role,
      storeIds: input.storeIds,
      credentialsEmailSent: emailSent,
    },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      employeeCode: user.employeeCode,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    /**
     * Única vez que a senha em claro existe fora do hash.
     *
     * Vai para a tela mesmo quando o e-mail é enviado: e-mail cai em spam,
     * atrasa, ou o endereço está errado — e o dono precisa poder entregar a
     * credencial em mãos ali mesmo. Não fica guardada em lugar nenhum: se
     * sumir, o caminho é gerar outra, que invalida esta.
     */
    temporaryPassword,
    /**
     * O PIN de entrada do tablet, também uma única vez.
     *
     * É esta a credencial que o funcionário do balcão vai usar — a senha só
     * serve a quem abre o sistema pelo computador.
     */
    temporaryPin,
    /** A tela avisa se a entrega por e-mail funcionou. */
    emailSent,
    /** E, quando não funcionou, por quê — para o dono saber o que consertar. */
    entregaPorEmail,
  };
}

/**
 * Gera uma senha temporária nova para quem ainda não concluiu o primeiro
 * acesso — o caminho quando o funcionário perde o papel com a credencial.
 */
export async function regenerateTemporaryPassword(params: {
  userId: string;
  request: FastifyRequest;
}) {
  const { userId, request } = params;

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  // Vale enquanto a pessoa ainda não trocou o que recebeu — seja porque não
  // entrou, seja porque entrou e não concluiu. Depois disso, quem esqueceu o
  // PIN pede um temporário pela própria tela de login.
  if (user.status !== "PENDING_FIRST_ACCESS" && !user.mustChangePassword) {
    throw badRequest(
      "FIRST_ACCESS_ALREADY_DONE",
      "Este usuário já trocou as credenciais que recebeu. Para um PIN novo, use o pedido de PIN temporário.",
    );
  }

  // As credenciais novas invalidam as anteriores: gerar outras nunca
  // ressuscita as que já circularam no papel.
  const temporaryPassword = generateTemporaryPassword();
  const temporaryPin = String(randomInt(100_000, 1_000_000));

  const [passwordHash, pinHash] = await Promise.all([
    hashSecret(temporaryPassword),
    hashSecret(temporaryPin),
  ]);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: true,
      pinHash,
      // Nasce vencido, como no cadastro: serve para entrar uma vez.
      pinChangedAt: null,
      pinFailedAttempts: 0,
      pinLockedUntil: null,
    },
  });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: user.companyId },
    select: { tradeName: true },
  });

  const entregaPorEmail = await entregar(user.email, (to) =>
    credentialsResetEmail({
      to,
      name: user.name,
      employeeCode: user.employeeCode,
      temporaryPassword,
      temporaryPin,
      companyName: company.tradeName,
    }),
  );

  const emailSent = entregaPorEmail === "ENVIADO";

  await audit(request, {
    action: "PASSWORD_CHANGE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    reason: "novas credenciais temporárias geradas pelo dono",
    newData: { credentialsEmailSent: emailSent },
  });

  return {
    employeeCode: user.employeeCode,
    temporaryPassword,
    temporaryPin,
    emailSent,
    entregaPorEmail,
  };
}

export async function listUsers(request: FastifyRequest) {
  const isGlobalRole = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  /**
   * O suporte técnico não aparece na lista — nem para o dono.
   *
   * É uma conta de manutenção do sistema, não alguém que trabalha na loja.
   * Misturada aos funcionários, ela vira uma linha que o dono não reconhece e
   * não sabe se pode apagar; e mostrá-la sem que ele possa gerenciá-la seria
   * pior ainda. Fora da lista, o quadro de pessoal é só quem de fato trabalha
   * ali.
   *
   * O próprio suporte continua se enxergando — precisa disso para trabalhar.
   */
  const escondeSuporte = request.user.role !== "DESENVOLVEDOR";

  const users = await prisma.user.findMany({
    where: {
      companyId: request.user.companyId,
      deletedAt: null,
      ...(escondeSuporte ? { role: { not: "DESENVOLVEDOR" } } : {}),
      ...(isGlobalRole
        ? {}
        : { userStores: { some: { storeId: { in: request.user.storeIds } } } }),
    },
    include: { userStores: { select: { storeId: true } } },
    orderBy: { name: "asc" },
  });

  // Quem está liberado a entrar fora dos tablets — a tela precisa mostrar isso
  // ao lado de cada matrícula para o dono saber o que já concedeu.
  const offDeviceGrants = await prisma.userPermission.findMany({
    where: {
      userId: { in: users.map((user) => user.id) },
      permission: { code: "AUTH_LOGIN_OFF_DEVICE" },
      effect: "ALLOW",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { userId: true, expiresAt: true },
  });

  const grantByUser = new Map(offDeviceGrants.map((grant) => [grant.userId, grant.expiresAt]));

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    employeeCode: user.employeeCode,
    email: user.email,
    cpf: user.cpf ?? null,
    role: user.role,
    status: user.status,
    storeIds: user.userStores.map((link) => link.storeId),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    /**
     * Se tem foto — não a foto em si.
     *
     * A imagem sai por uma rota própria, que confere permissão e é cacheada
     * pelo navegador. Embutir o arquivo aqui faria a lista de funcionários
     * carregar megabytes que a maioria das telas nem mostra.
     */
    temFoto: user.avatarStorageKey !== null,
    /** Perfis com alcance global não dependem de liberação nominal. */
    offDeviceAllowed:
      user.role === "DONO" || user.role === "DESENVOLVEDOR" || grantByUser.has(user.id),
    offDeviceExpiresAt: grantByUser.get(user.id) ?? null,
  }));
}

export async function updateUser(params: {
  userId: string;
  input: UpdateUserInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode editar usuários.");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
    include: { userStores: { select: { storeId: true } } },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (input.storeIds) {
    for (const storeId of input.storeIds) {
      await assertStoreAccess(request, storeId);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: user.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        // String vazia é o gesto de "apagar o e-mail", distinto de "não mexer".
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.cpf !== undefined ? { cpf: input.cpf || null } : {}),
      },
    });

    if (input.storeIds) {
      await tx.userStore.deleteMany({ where: { userId: user.id } });
      if (input.storeIds.length > 0) {
        await tx.userStore.createMany({
          data: input.storeIds.map((storeId, index) => ({
            userId: user.id,
            storeId,
            isPrimary: index === 0,
          })),
        });
      }
    }

    return result;
  });

  await audit(request, {
    action: "USER_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: {
      name: user.name,
      email: user.email,
      storeIds: user.userStores.map((link) => link.storeId),
    },
    newData: {
      name: updated.name,
      email: updated.email,
      storeIds: input.storeIds ?? undefined,
    },
  });

  return toPublicUser(updated);
}

export async function changeUserRole(params: {
  userId: string;
  input: ChangeUserRoleInput;
  request: FastifyRequest;
}) {
  const { userId, input, request } = params;
  assertCanAssignRole(request.user.role, input.role);

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (user.id === request.user.sub && input.role !== user.role) {
    throw badRequest(
      "CANNOT_CHANGE_OWN_ROLE",
      "Você não pode alterar o seu próprio perfil de acesso.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: user.id },
      data: { role: input.role },
    });

    // O perfil viaja dentro do access token, então uma sessão aberta continuaria
    // valendo com o perfil ANTIGO até o token expirar. Num rebaixamento isso
    // significaria manter privilégio elevado por mais 15 minutos. Derrubar as
    // sessões força o novo perfil a valer imediatamente.
    const now = new Date();
    await tx.refreshToken.updateMany({
      where: { session: { userId: user.id }, revokedAt: null },
      data: { revokedAt: now, revokedReason: "perfil alterado" },
    });
    await tx.deviceSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: "perfil alterado" },
    });

    return result;
  });

  // A troca de perfil muda as permissões efetivas na hora, não no fim do TTL.
  await invalidatePermissionCache(user.id);

  await audit(request, {
    action: input.role === "DONO" ? "USER_PROMOTE_TO_OWNER" : "USER_ROLE_CHANGE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: { role: user.role },
    newData: { role: updated.role },
    reason: input.reason,
  });

  return toPublicUser(updated);
}

export async function setUserBlocked(params: {
  userId: string;
  blocked: boolean;
  reason: string;
  request: FastifyRequest;
}) {
  const { userId, blocked, reason, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode bloquear ou desbloquear usuários.");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!user) {
    throw notFound("USER_NOT_FOUND", "Usuário não encontrado.");
  }

  if (user.id === request.user.sub) {
    throw badRequest("CANNOT_BLOCK_SELF", "Você não pode bloquear a si mesmo.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: user.id },
      data: { status: blocked ? "BLOCKED" : "ACTIVE" },
    });

    // Bloquear precisa cortar o acesso imediatamente: uma sessão viva
    // sobreviveria ao bloqueio até o refresh token expirar.
    if (blocked) {
      const now = new Date();
      await tx.refreshToken.updateMany({
        where: { session: { userId: user.id }, revokedAt: null },
        data: { revokedAt: now, revokedReason: "usuário bloqueado" },
      });
      await tx.deviceSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: "usuário bloqueado" },
      });
    }

    return result;
  });

  await invalidatePermissionCache(user.id);

  await audit(request, {
    action: blocked ? "USER_BLOCK" : "USER_UNBLOCK",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "User",
    entityId: user.id,
    previousData: { status: user.status },
    newData: { status: updated.status },
    reason,
  });

  return toPublicUser(updated);
}
