import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound, unauthorized } from "../../core/errors.js";
import { hashSecret, verifySecret } from "../../core/security/password.service.js";
import { DatabaseStorage } from "../../core/storage/database.storage.js";

/**
 * O perfil de cada funcionário.
 *
 * Tudo aqui é sobre a própria pessoa, e por isso nenhuma função aceita um
 * `userId` como parâmetro: quem está mexendo é quem o token diz que é. Receber
 * um id pela URL seria a porta pela qual uma vendedora trocaria a senha da
 * colega — e uma porta dessas não se fecha com uma verificação, se fecha não
 * existindo.
 */

const armazenamento = new DatabaseStorage();

/** Fotos que todo navegador e todo tablet abrem. SVG fica de fora: é script. */
const TIPOS_DE_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);
const TAMANHO_MAXIMO = 3 * 1024 * 1024;

export async function getProfile(request: FastifyRequest) {
  const user = await prisma.user.findFirst({
    where: { id: request.user.sub, deletedAt: null },
    select: {
      id: true,
      name: true,
      employeeCode: true,
      email: true,
      role: true,
      avatarStorageKey: true,
      theme: true,
      fontScale: true,
      highContrast: true,
      reduceMotion: true,
      lastLoginAt: true,
      pinChangedAt: true,
      userStores: { select: { store: { select: { name: true } } } },
    },
  });

  if (!user) {
    throw notFound("USER_NOT_FOUND", "Cadastro não encontrado.");
  }

  return {
    id: user.id,
    nome: user.name,
    matricula: user.employeeCode,
    email: user.email,
    perfil: user.role,
    lojas: user.userStores.map((vinculo) => vinculo.store.name),
    temFoto: user.avatarStorageKey !== null,
    ultimoAcesso: user.lastLoginAt,
    pinTrocadoEm: user.pinChangedAt,
    preferencias: {
      tema: user.theme,
      tamanhoDaLetra: user.fontScale,
      altoContraste: user.highContrast,
      menosMovimento: user.reduceMotion,
    },
  };
}

/**
 * A pessoa troca a própria senha.
 *
 * Isso não existia. Trocar senha só acontecia no primeiro acesso ou quando o
 * dono gerava uma temporária — o que significa que quem desconfiava que alguém
 * viu a senha dela precisava pedir ao dono, e esperar. A senha atual é exigida
 * porque um tablet destravado com a sessão aberta não pode ser suficiente para
 * trocar a credencial de acesso.
 */
export async function changeOwnPassword(params: {
  request: FastifyRequest;
  currentPassword: string;
  newPassword: string;
}) {
  const { request, currentPassword, newPassword } = params;

  const user = await prisma.user.findFirstOrThrow({
    where: { id: request.user.sub, deletedAt: null },
  });

  if (!user.passwordHash || !(await verifySecret(user.passwordHash, currentPassword))) {
    await audit(request, {
      action: "PASSWORD_CHANGE",
      result: "FAILURE",
      userId: user.id,
      companyId: user.companyId,
      userRoleSnapshot: user.role,
      reason: "senha atual incorreta",
    });

    throw unauthorized("INVALID_CREDENTIALS", "A senha atual está incorreta.");
  }

  if (await verifySecret(user.passwordHash, newPassword)) {
    throw badRequest("PASSWORD_UNCHANGED", "A nova senha precisa ser diferente da atual.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashSecret(newPassword),
      mustChangePassword: false,
      passwordFailedAttempts: 0,
      passwordLockedUntil: null,
    },
  });

  await audit(request, {
    action: "PASSWORD_CHANGE",
    result: "SUCCESS",
    userId: user.id,
    companyId: user.companyId,
    userRoleSnapshot: user.role,
    reason: "trocada pelo próprio funcionário",
  });

  return { trocada: true, mensagem: "Senha trocada. As outras sessões continuam abertas." };
}

/**
 * As preferências de tela.
 *
 * Não são auditadas de propósito. Auditoria existe para responder quem mexeu
 * no dinheiro, no estoque e no acesso; encher o histórico com "fulana ligou o
 * modo escuro" tornaria mais difícil achar o que importa — e a auditoria vale
 * pelo que ela deixa encontrar.
 */
export async function updatePreferences(params: {
  request: FastifyRequest;
  tema?: "CLARO" | "ESCURO" | "SISTEMA" | undefined;
  tamanhoDaLetra?: number | undefined;
  altoContraste?: boolean | undefined;
  menosMovimento?: boolean | undefined;
}) {
  const { request } = params;

  await prisma.user.update({
    where: { id: request.user.sub },
    data: {
      ...(params.tema !== undefined ? { theme: params.tema } : {}),
      ...(params.tamanhoDaLetra !== undefined ? { fontScale: params.tamanhoDaLetra } : {}),
      ...(params.altoContraste !== undefined ? { highContrast: params.altoContraste } : {}),
      ...(params.menosMovimento !== undefined ? { reduceMotion: params.menosMovimento } : {}),
    },
  });

  return { salvo: true };
}

/**
 * A foto.
 *
 * Serve para reconhecer quem está logado num tablet compartilhado — o balcão
 * troca de pessoa várias vezes por dia, e um nome escrito pequeno no canto não
 * é notado. Não é obrigatória e não vale como documento.
 *
 * Tipo e tamanho são conferidos aqui, não na tela: o `accept` do campo de
 * arquivo é do navegador do cliente e não impede nada.
 */
export async function setOwnPhoto(params: {
  request: FastifyRequest;
  content: Buffer;
  fileName: string;
  mimeType: string;
}) {
  const { request, content, fileName, mimeType } = params;

  if (!TIPOS_DE_FOTO.has(mimeType)) {
    throw badRequest("INVALID_IMAGE_TYPE", "A foto precisa ser JPG, PNG ou WEBP.");
  }

  if (content.byteLength > TAMANHO_MAXIMO) {
    throw badRequest("IMAGE_TOO_LARGE", "A foto precisa ter no máximo 3 MB.");
  }

  const user = await prisma.user.findFirstOrThrow({
    where: { id: request.user.sub, deletedAt: null },
    select: { id: true, avatarStorageKey: true },
  });

  const guardado = await armazenamento.save({ content, fileName, scope: "user-photo" });

  await prisma.user.update({
    where: { id: user.id },
    data: { avatarStorageKey: guardado.storageKey },
  });

  // A foto antiga sai depois que a nova já está no cadastro. Na ordem
  // inversa, uma falha no meio deixaria o cadastro apontando para um arquivo
  // que acabou de ser apagado.
  if (user.avatarStorageKey) {
    await armazenamento.delete(user.avatarStorageKey).catch(() => undefined);
  }

  return { trocada: true };
}

export async function removeOwnPhoto(request: FastifyRequest) {
  const user = await prisma.user.findFirstOrThrow({
    where: { id: request.user.sub, deletedAt: null },
    select: { id: true, avatarStorageKey: true },
  });

  if (user.avatarStorageKey) {
    await prisma.user.update({ where: { id: user.id }, data: { avatarStorageKey: null } });
    await armazenamento.delete(user.avatarStorageKey).catch(() => undefined);
  }

  return { removida: true };
}

/**
 * A foto de um funcionário, para a tela mostrar.
 *
 * Qualquer sessão autenticada da mesma empresa pode ver — é a foto do colega
 * do balcão, não um documento. A chave é sorteada, então nada aqui é
 * adivinhável de fora.
 */
export async function readPhoto(params: { request: FastifyRequest; userId: string }) {
  const user = await prisma.user.findFirst({
    where: {
      id: params.userId,
      companyId: params.request.user.companyId,
      deletedAt: null,
    },
    select: { avatarStorageKey: true },
  });

  if (!user?.avatarStorageKey) {
    throw notFound("PHOTO_NOT_FOUND", "Este funcionário não tem foto.");
  }

  return armazenamento.read(user.avatarStorageKey);
}
