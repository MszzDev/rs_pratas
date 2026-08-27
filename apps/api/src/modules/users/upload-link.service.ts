import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { EmployeeDocumentType, UploadPurpose } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { hashRefreshToken } from "../../core/security/token.service.js";
import { env } from "../../config/env.js";
import { DatabaseStorage } from "../../core/storage/database.storage.js";

/**
 * Enviar arquivo do próprio celular.
 *
 * O tablet do balcão está em modo quiosque: o seletor de arquivos do Android é
 * outra tela, e o confinamento não deixa abri-la. Então a tela de documentos
 * existia e era inútil justamente no aparelho onde a pessoa passa o dia.
 *
 * A pessoa, já logada no tablet, pede um link. O tablet o desenha como QR
 * Code. Ela lê com o próprio celular, que abre uma página mínima já sabendo
 * quem ela é, fotografa o papel e envia. O quiosque continua lacrado, e ela usa
 * a câmera que já tem na mão.
 *
 * O que torna isso seguro não é a página — é o token:
 *
 * - 256 bits sorteados, guardado só como hash com pepper. Um dump do banco não
 *   devolve nenhum link utilizável.
 * - Vale MINUTOS. Um QR fotografado por alguém de passagem vence antes de
 *   virar problema.
 * - Serve UMA vez.
 * - Está preso a uma pessoa e a uma finalidade. Quem o intercepta consegue, no
 *   pior caso, mandar um arquivo para a fila de revisão daquele funcionário —
 *   e não consegue LER nada: o link não abre documento, não abre o sistema,
 *   não devolve dado nenhum além do primeiro nome.
 */

/** Tempo de vida do link. Curto: ele é usado nos segundos seguintes. */
const VALIDADE_MINUTOS = 10;

const TIPOS_DE_IMAGEM = new Set(["image/jpeg", "image/png", "image/webp"]);
const TIPOS_DE_DOCUMENTO = new Set([...TIPOS_DE_IMAGEM, "application/pdf"]);

const MAXIMO_FOTO = 3 * 1024 * 1024;
const MAXIMO_DOCUMENTO = 10 * 1024 * 1024;

const armazenamento = new DatabaseStorage();

function hash(token: string): string {
  return hashRefreshToken(token);
}

/**
 * O endereço que vai dentro do QR Code.
 *
 * Sai da configuração do servidor, e não do que o navegador informou: montar
 * URL a partir de cabeçalho da requisição é como um link de uso único acaba
 * apontando para o servidor de outra pessoa.
 */
function enderecoDaPagina(token: string): string {
  // Sem PUBLIC_WEB_URL, o primeiro endereço permitido em CORS é o palpite
  // certo: em produção é o site publicado, e em desenvolvimento é o Vite.
  const base = (env.PUBLIC_WEB_URL ?? env.CORS_ALLOWED_ORIGINS[0] ?? "").replace(/\/+$/, "");
  return `${base}/enviar/${token}`;
}

export async function createUploadLink(params: {
  request: FastifyRequest;
  purpose: UploadPurpose;
  deviceId?: string | undefined;
}) {
  const { request, purpose, deviceId } = params;

  // Links anteriores da mesma pessoa e finalidade perdem a validade: dois QR
  // vivos ao mesmo tempo é um a mais do que ela precisa, e o da tela anterior
  // ficaria valendo esquecido.
  await prisma.uploadLink.updateMany({
    where: { userId: request.user.sub, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  const token = randomBytes(32).toString("base64url");

  const link = await prisma.uploadLink.create({
    data: {
      companyId: request.user.companyId,
      userId: request.user.sub,
      purpose,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + VALIDADE_MINUTOS * 60_000),
      ...(deviceId ? { deviceId } : {}),
    },
    select: { id: true, expiresAt: true },
  });

  return {
    id: link.id,
    endereco: enderecoDaPagina(token),
    expiraEm: link.expiresAt,
    validadeMinutos: VALIDADE_MINUTOS,
  };
}

/** O tablet pergunta se já chegou, para trocar a tela sozinho. */
export async function getUploadLinkStatus(params: { request: FastifyRequest; id: string }) {
  const link = await prisma.uploadLink.findFirst({
    where: { id: params.id, userId: params.request.user.sub },
    select: { usedAt: true, expiresAt: true },
  });

  if (!link) {
    throw notFound("LINK_NOT_FOUND", "Link não encontrado.");
  }

  return {
    recebido: link.usedAt !== null,
    vencido: link.usedAt === null && link.expiresAt.getTime() < Date.now(),
  };
}

/**
 * Acha o link pelo token, sem sessão.
 *
 * Erros iguais para "não existe", "já usado" e "vencido": distinguir os três
 * transformaria a página num jeito de descobrir quais tokens já existiram.
 */
async function linkValido(token: string) {
  const link = await prisma.uploadLink.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { select: { id: true, name: true, companyId: true } } },
  });

  if (!link || link.usedAt !== null || link.expiresAt.getTime() < Date.now()) {
    throw notFound(
      "LINK_INVALIDO",
      "Este link não vale mais. Gere um novo no tablet — eles duram poucos minutos de propósito.",
    );
  }

  return link;
}

/**
 * O que a página no celular mostra antes do envio.
 *
 * Só o primeiro nome. É o suficiente para a pessoa reconhecer que o link é
 * dela e não de outra, e não entrega sobrenome, matrícula nem loja a quem
 * porventura esteja com o código.
 */
export async function describeUploadLink(token: string) {
  const link = await linkValido(token);

  return {
    nome: link.user.name.split(" ")[0] ?? "",
    finalidade: link.purpose,
    expiraEm: link.expiresAt,
  };
}

export async function consumeUploadLink(params: {
  token: string;
  request: FastifyRequest;
  content: Buffer;
  fileName: string;
  mimeType: string;
  /** Só para documento. */
  documentType?: EmployeeDocumentType | undefined;
  title?: string | undefined;
}) {
  const { token, request, content, fileName, mimeType } = params;

  const link = await linkValido(token);
  const foto = link.purpose === "FOTO";

  const aceitos = foto ? TIPOS_DE_IMAGEM : TIPOS_DE_DOCUMENTO;
  const maximo = foto ? MAXIMO_FOTO : MAXIMO_DOCUMENTO;

  if (!aceitos.has(mimeType)) {
    throw badRequest(
      "TIPO_INVALIDO",
      foto ? "A foto precisa ser JPG, PNG ou WEBP." : "Envie uma foto ou um PDF.",
    );
  }

  if (content.byteLength > maximo) {
    throw badRequest(
      "ARQUIVO_GRANDE",
      `O arquivo precisa ter no máximo ${Math.round(maximo / 1024 / 1024)} MB.`,
    );
  }

  const guardado = await armazenamento.save({
    content,
    fileName,
    scope: foto ? "user-photo" : "employee-document",
  });

  /**
   * O link é queimado na MESMA transação que grava o arquivo.
   *
   * Separado, um envio duplicado — o toque repetido num celular lento — criaria
   * dois documentos na fila do gerente para o mesmo atestado.
   */
  await prisma.$transaction(async (tx) => {
    const queimado = await tx.uploadLink.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (queimado.count === 0) {
      throw notFound("LINK_INVALIDO", "Este link já foi usado.");
    }

    if (foto) {
      const anterior = await tx.user.findUniqueOrThrow({
        where: { id: link.userId },
        select: { avatarStorageKey: true },
      });

      await tx.user.update({
        where: { id: link.userId },
        data: { avatarStorageKey: guardado.storageKey },
      });

      if (anterior.avatarStorageKey) {
        await armazenamento.delete(anterior.avatarStorageKey).catch(() => undefined);
      }

      return;
    }

    await tx.employeeDocument.create({
      data: {
        companyId: link.companyId,
        userId: link.userId,
        type: params.documentType ?? "OTHER",
        title: params.title?.trim() || "Enviado pelo celular",
        fileName,
        fileMimeType: mimeType,
        fileSizeBytes: guardado.sizeBytes,
        fileStorageKey: guardado.storageKey,
        fileChecksum: guardado.checksum,
      },
    });
  });

  /**
   * A auditoria registra em nome do FUNCIONÁRIO, não de uma sessão — porque
   * não há sessão nenhuma aqui. É o dono do link que enviou, e é o nome dele
   * que precisa aparecer se alguém perguntar de onde veio o arquivo.
   */
  await audit(request, {
    action: foto ? "USER_UPDATE" : "DATA_EXPORT",
    result: "SUCCESS",
    userId: link.userId,
    companyId: link.companyId,
    userRoleSnapshot: null,
    entityType: foto ? "User" : "EmployeeDocument",
    entityId: link.userId,
    reason: foto ? "foto enviada pelo celular" : "documento enviado pelo celular",
  });

  return {
    recebido: true,
    mensagem: foto
      ? "Foto enviada. Pode conferir no tablet."
      : "Documento enviado. A gerência vai analisar.",
  };
}

/**
 * Limpa os links que ninguém usou.
 *
 * Eles vencem sozinhos — o que importa para a segurança —, mas continuariam
 * ocupando a tabela para sempre. Uma semana é folga suficiente para investigar
 * "por que meu envio não funcionou?" antes de a linha sumir.
 */
export async function purgeExpiredUploadLinks(): Promise<number> {
  const limite = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  const { count } = await prisma.uploadLink.deleteMany({
    where: { expiresAt: { lt: limite } },
  });

  return count;
}
