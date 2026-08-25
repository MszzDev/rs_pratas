import type { FastifyRequest } from "fastify";
import type {
  ClaimDeviceInput,
  CreateCashRegisterInput,
  CreateDeviceInput,
  CreatePOSStationInput,
} from "@rs-pratas/shared";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { PAIRING_CODE_TTL_MINUTES, generatePairingCode } from "./pairing-code.js";

export async function createPOSStation(params: {
  input: CreatePOSStationInput;
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  const existing = await prisma.pOSStation.findFirst({
    where: { storeId: input.storeId, code: input.code, deletedAt: null },
  });
  if (existing) {
    throw conflict("POS_STATION_CODE_TAKEN", `Já existe uma estação com o código ${input.code} nesta loja.`);
  }

  return prisma.pOSStation.create({
    data: { storeId: input.storeId, code: input.code, name: input.name },
  });
}

export async function createCashRegister(params: {
  input: CreateCashRegisterInput;
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const station = await prisma.pOSStation.findFirst({
    where: { id: input.posStationId, deletedAt: null },
    select: { id: true, storeId: true },
  });
  if (!station) {
    throw notFound("POS_STATION_NOT_FOUND", "Estação de caixa não encontrada.");
  }

  await assertStoreAccess(request, station.storeId);

  const existing = await prisma.cashRegister.findFirst({
    where: { posStationId: station.id, code: input.code, deletedAt: null },
  });
  if (existing) {
    throw conflict("CASH_REGISTER_CODE_TAKEN", `Já existe um caixa com o código ${input.code} nesta estação.`);
  }

  return prisma.cashRegister.create({
    data: { posStationId: station.id, code: input.code, name: input.name },
  });
}

/**
 * Cria o dispositivo em PENDING e devolve o código de pareamento.
 *
 * companyId e storeId são derivados da cadeia caixa→estação→loja e nunca vêm do
 * cliente: aceitar esses campos do request permitiria plantar um tablet de uma
 * loja dentro de outra.
 */
export async function createDevice(params: {
  input: CreateDeviceInput;
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const cashRegister = await prisma.cashRegister.findFirst({
    where: { id: input.cashRegisterId, deletedAt: null },
    include: { posStation: { select: { storeId: true } } },
  });
  if (!cashRegister) {
    throw notFound("CASH_REGISTER_NOT_FOUND", "Caixa não encontrado.");
  }

  const storeId = cashRegister.posStation.storeId;
  await assertStoreAccess(request, storeId);

  const pairingCode = generatePairingCode();

  const device = await prisma.device.create({
    data: {
      cashRegisterId: cashRegister.id,
      companyId: request.user.companyId,
      storeId,
      name: input.name,
      type: input.type,
      status: "PENDING",
      pairingCode,
      pairingCodeExpiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000),
    },
  });

  await audit(request, {
    action: "DEVICE_PAIR_INITIATED",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId,
    deviceId: device.id,
    userRoleSnapshot: request.user.role,
    entityType: "Device",
    entityId: device.id,
    newData: { name: device.name, type: device.type },
  });

  return {
    device,
    // Código em claro só aqui, uma vez: quem cria é quem digita no tablet.
    pairingCode,
    expiresAt: device.pairingCodeExpiresAt,
  };
}

/**
 * Chamado pelo próprio tablet, sem usuário autenticado (ainda não há login no
 * aparelho). A autorização vem do código de pareamento — por isso ele é curto,
 * expira rápido e é de uso único.
 */
export async function claimDevice(params: {
  input: ClaimDeviceInput;
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const device = await prisma.device.findFirst({
    where: { pairingCode: input.pairingCode, deletedAt: null },
  });

  if (!device) {
    throw badRequest("INVALID_PAIRING_CODE", "Código de pareamento inválido ou já utilizado.");
  }

  if (device.status !== "PENDING") {
    throw conflict("DEVICE_ALREADY_PAIRED", "Este dispositivo já foi pareado.");
  }

  if (!device.pairingCodeExpiresAt || device.pairingCodeExpiresAt < new Date()) {
    throw badRequest(
      "PAIRING_CODE_EXPIRED",
      "Código de pareamento expirado. Gere um novo no painel administrativo.",
    );
  }

  // Um mesmo aparelho físico não pode assumir a identidade de dois cadastros.
  const uuidInUse = await prisma.device.findFirst({
    where: { deviceUuid: input.deviceUuid, id: { not: device.id } },
    select: { id: true },
  });
  if (uuidInUse) {
    throw conflict("DEVICE_UUID_IN_USE", "Este aparelho já está vinculado a outro cadastro.");
  }

  const paired = await prisma.device.update({
    where: { id: device.id },
    data: {
      deviceUuid: input.deviceUuid,
      model: input.model ?? null,
      osVersion: input.osVersion ?? null,
      appVersion: input.appVersion ?? null,
      status: "ACTIVE",
      pairedAt: new Date(),
      lastSeenAt: new Date(),
      // Consome o código: uso único.
      pairingCode: null,
      pairingCodeExpiresAt: null,
    },
  });

  await audit(request, {
    action: "DEVICE_PAIR_CLAIMED",
    result: "SUCCESS",
    companyId: paired.companyId,
    storeId: paired.storeId,
    deviceId: paired.id,
    entityType: "Device",
    entityId: paired.id,
    newData: { model: paired.model, osVersion: paired.osVersion, appVersion: paired.appVersion },
  });

  return paired;
}

export async function listDevices(params: { request: FastifyRequest; storeId?: string }) {
  const { request, storeId } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const isGlobalRole = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";
  const allowedStoreIds = isGlobalRole ? undefined : request.user.storeIds;

  return prisma.device.findMany({
    where: {
      deletedAt: null,
      companyId: request.user.companyId,
      ...(storeId ? { storeId } : {}),
      ...(allowedStoreIds ? { storeId: { in: allowedStoreIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function unlinkDevice(params: { deviceId: string; request: FastifyRequest; reason: string }) {
  const { deviceId, request, reason } = params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!device) {
    throw notFound("DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
  }

  // Desvincular tablet é ação sensível reservada ao dono (item 12 da
  // especificação: gerente não desvincula tablet).
  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode desvincular um dispositivo.");
  }

  const [updated] = await prisma.$transaction([
    prisma.device.update({
      where: { id: device.id },
      data: { status: "UNLINKED", deviceUuid: null, pairingCode: null, pairingCodeExpiresAt: null },
    }),
    // Um aparelho desvinculado não pode continuar operando com a sessão antiga.
    prisma.refreshToken.updateMany({
      where: { session: { deviceId: device.id }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "dispositivo desvinculado" },
    }),
    prisma.deviceSession.updateMany({
      where: { deviceId: device.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "dispositivo desvinculado" },
    }),
  ]);

  await audit(request, {
    action: "DEVICE_UNLINK",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: device.companyId,
    storeId: device.storeId,
    deviceId: device.id,
    userRoleSnapshot: request.user.role,
    entityType: "Device",
    entityId: device.id,
    reason,
    previousData: { status: device.status, deviceUuid: device.deviceUuid },
    newData: { status: "UNLINKED" },
  });

  return updated;
}

/**
 * Registra a saida do modo quiosque.
 *
 * Nao e o servidor que destrava o tablet — quem faz isso e o proprio Android,
 * no aparelho. O que acontece aqui e o que da sentido aquele destrave: a
 * autorizacao e o RASTRO. Sem isto, sair do quiosque seria um gesto que nao
 * deixa marca, e a pergunta "quem tirou o tablet do PDV as 3 da manha?"
 * ficaria sem resposta.
 *
 * A permissao e o step-up sao conferidos antes de chegar aqui, na rota.
 */
export async function registerKioskExit(params: {
  deviceId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { deviceId, reason, request } = params;

  const device = await prisma.device.findFirst({
    where: { id: deviceId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!device) {
    throw notFound("DEVICE_NOT_FOUND", "Dispositivo nao encontrado.");
  }

  await assertStoreAccess(request, device.storeId);

  await audit(request, {
    action: "DEVICE_KIOSK_EXIT",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: device.companyId,
    storeId: device.storeId,
    deviceId: device.id,
    userRoleSnapshot: request.user.role,
    entityType: "Device",
    entityId: device.id,
    reason,
  });

  return { deviceId: device.id, autorizadoEm: new Date().toISOString() };
}
