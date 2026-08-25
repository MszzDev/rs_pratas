import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";

/**
 * O tablet se apresenta; o dono decide.
 *
 * O caminho antigo era o inverso: o dono gerava um código e alguém digitava no
 * tablet. Isso é trabalho do vendedor para resolver um problema do dono — e um
 * código de seis caracteres digitado errado num tablet novo é a primeira
 * impressão que o sistema deixa.
 *
 * Aqui o aparelho anuncia o que ele é assim que abre. Do celular ou do
 * computador, o dono vê "Lenovo TB311FU, visto agora, sem loja", escolhe a
 * loja e dá um nome. Ninguém digita nada no tablet.
 */

/**
 * Registra a apresentação de um aparelho.
 *
 * SEM autenticação de sessão, porque o tablet ainda não tem quem o autentique
 * — é justamente o problema que ele veio resolver. A defesa não é a
 * autenticação: é que o anúncio, sozinho, NÃO DÁ NADA. Um aparelho anunciado e
 * não vinculado não abre login, não vê preço e não vende. O pior que um
 * estranho consegue é aparecer numa fila que o dono ignora.
 */
export async function announceDevice(input: {
  hardwareId: string;
  model?: string | undefined;
  osVersion?: string | undefined;
  appVersion?: string | undefined;
}) {
  const anuncio = await prisma.deviceAnnouncement.upsert({
    where: { hardwareId: input.hardwareId },
    create: {
      hardwareId: input.hardwareId,
      model: input.model ?? null,
      osVersion: input.osVersion ?? null,
      appVersion: input.appVersion ?? null,
    },
    // Reabrir o aplicativo atualiza os dados em vez de criar outra linha: sem
    // isto, a fila encheria de duplicatas do mesmo tablet a cada reinício.
    update: {
      model: input.model ?? null,
      osVersion: input.osVersion ?? null,
      appVersion: input.appVersion ?? null,
    },
  });

  if (!anuncio.deviceId) {
    // O aparelho pode já ter sido cadastrado pelo caminho antigo, em que o
    // dono gerava um código e alguém digitava no tablet. Se existe um Device
    // com este mesmo identificador de hardware, o anúncio adota aquele em vez
    // de mandar o tablet para a fila — senão o dono vincularia de novo e a
    // loja ficaria com dois caixas para um tablet só.
    const jaCadastrado = await prisma.device.findFirst({
      where: { deviceUuid: input.hardwareId, deletedAt: null, status: "ACTIVE" },
      include: { store: { select: { name: true } } },
    });

    if (!jaCadastrado) {
      return { vinculado: false as const, deviceId: null, storeName: null, deviceName: null };
    }

    await prisma.deviceAnnouncement.update({
      where: { id: anuncio.id },
      data: { deviceId: jaCadastrado.id },
    });

    return {
      vinculado: true as const,
      deviceId: jaCadastrado.id,
      storeName: jaCadastrado.store.name,
      deviceName: jaCadastrado.name,
    };
  }

  const device = await prisma.device.findFirst({
    where: { id: anuncio.deviceId, deletedAt: null },
    include: { store: { select: { name: true } } },
  });

  if (!device || device.status !== "ACTIVE") {
    // O dispositivo foi removido, desvinculado ou bloqueado depois. O aparelho
    // volta para a fila em vez de ficar apontando para um cadastro que não
    // serve — mostrar a tela de login de um tablet desvinculado só levaria a
    // pessoa a digitar o PIN para receber "este aparelho não está ativo".
    await prisma.deviceAnnouncement.update({
      where: { id: anuncio.id },
      data: { deviceId: null },
    });

    return { vinculado: false as const, deviceId: null, storeName: null, deviceName: null };
  }

  return {
    vinculado: true as const,
    deviceId: device.id,
    storeName: device.store.name,
    deviceName: device.name,
  };
}

/** Aparelhos vistos e ainda sem loja — a fila que o dono resolve. */
export async function listPendingDevices() {
  const anuncios = await prisma.deviceAnnouncement.findMany({
    where: { deviceId: null },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });

  const agora = Date.now();

  return anuncios.map((anuncio) => ({
    id: anuncio.id,
    hardwareId: anuncio.hardwareId,
    model: anuncio.model,
    osVersion: anuncio.osVersion,
    appVersion: anuncio.appVersion,
    firstSeenAt: anuncio.firstSeenAt,
    lastSeenAt: anuncio.lastSeenAt,
    /**
     * Quem apareceu nos últimos minutos está ligado agora, na frente de
     * alguém. É o que permite ao dono distinguir "o tablet que acabei de tirar
     * da caixa" de um que passou por aqui semana passada.
     */
    online: agora - anuncio.lastSeenAt.getTime() < 5 * 60 * 1000,
    /** Só para citar o aparelho sem expor o identificador inteiro. */
    apelido: `${anuncio.model ?? "Tablet"} ····${anuncio.hardwareId.slice(-4)}`,
  }));
}

/**
 * Tira da fila um aparelho que não é da loja.
 *
 * Qualquer aparelho com o aplicativo aberto entra na fila — o celular de quem
 * estava testando, um tablet que já foi devolvido. Sem uma forma de descartar,
 * a fila vira uma lista de coisas que o dono precisa ignorar toda vez, e uma
 * lista assim deixa de ser lida.
 *
 * Descartar não bloqueia nada: se o mesmo aparelho abrir o aplicativo de novo,
 * ele reaparece. É uma limpeza, não uma punição.
 */
export async function dismissAnnouncement(params: {
  announcementId: string;
  request: FastifyRequest;
}) {
  const anuncio = await prisma.deviceAnnouncement.findUnique({
    where: { id: params.announcementId },
  });

  if (!anuncio) {
    throw notFound("ANNOUNCEMENT_NOT_FOUND", "Este aparelho não está na fila.");
  }

  if (anuncio.deviceId) {
    throw conflict(
      "ALREADY_ASSIGNED",
      "Este aparelho já pertence a uma loja. Para tirá-lo, desvincule o tablet.",
    );
  }

  await prisma.deviceAnnouncement.delete({ where: { id: anuncio.id } });

  await audit(params.request, {
    action: "DEVICE_UPDATE",
    result: "SUCCESS",
    userId: params.request.user.sub,
    companyId: params.request.user.companyId,
    userRoleSnapshot: params.request.user.role,
    entityType: "DeviceAnnouncement",
    entityId: anuncio.id,
    reason: "aparelho descartado da fila",
    previousData: { hardwareId: anuncio.hardwareId, model: anuncio.model },
  });

  return { descartado: true };
}

/**
 * Vincula um aparelho anunciado a uma loja.
 *
 * É aqui que nasce o `Device` de verdade. O caixa é escolhido pelo dono ou,
 * havendo um só na loja, assumido — perguntar "qual caixa?" quando só existe
 * um é uma pergunta sem resposta possível além da óbvia.
 */
export async function assignDevice(params: {
  announcementId: string;
  storeId: string;
  name: string;
  cashRegisterId?: string | undefined;
  request: FastifyRequest;
}) {
  const { announcementId, storeId, name, cashRegisterId, request } = params;

  await assertStoreAccess(request, storeId);

  const anuncio = await prisma.deviceAnnouncement.findUnique({ where: { id: announcementId } });

  if (!anuncio) {
    throw notFound("ANNOUNCEMENT_NOT_FOUND", "Este aparelho não está na fila.");
  }

  if (anuncio.deviceId) {
    throw conflict("ALREADY_ASSIGNED", "Este aparelho já foi vinculado a uma loja.");
  }

  const caixa = cashRegisterId
    ? await prisma.cashRegister.findFirst({
        where: { id: cashRegisterId, posStation: { storeId }, deletedAt: null },
      })
    : await prisma.cashRegister.findFirst({
        where: { posStation: { storeId }, deletedAt: null },
        orderBy: { createdAt: "asc" },
      });

  if (!caixa) {
    throw badRequest(
      "NO_CASH_REGISTER",
      "Esta loja ainda não tem um caixa cadastrado. Crie o caixa antes de vincular o tablet.",
    );
  }

  const device = await prisma.device.create({
    data: {
      companyId: request.user.companyId,
      storeId,
      cashRegisterId: caixa.id,
      name,
      type: "TABLET",
      status: "ACTIVE",
      deviceUuid: anuncio.hardwareId,
      model: anuncio.model,
      osVersion: anuncio.osVersion,
      appVersion: anuncio.appVersion,
      pairedAt: new Date(),
      pairedById: request.user.sub,
    },
    include: { store: { select: { name: true } } },
  });

  await prisma.deviceAnnouncement.update({
    where: { id: anuncio.id },
    data: { deviceId: device.id },
  });

  await audit(request, {
    action: "DEVICE_PAIR_CLAIMED",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId,
    deviceId: device.id,
    userRoleSnapshot: request.user.role,
    entityType: "Device",
    entityId: device.id,
    reason: "tablet vinculado à loja",
    newData: { name, storeId, hardwareId: anuncio.hardwareId },
  });

  return {
    deviceId: device.id,
    name: device.name,
    storeName: device.store.name,
  };
}
