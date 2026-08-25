import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import { resumirConta } from "./terminal-credentials.service.js";

/**
 * Toda maquininha nasce amarrada à cadeia inteira: empresa, loja, estação,
 * caixa e tablet. Nenhum desses campos pode ficar vazio.
 *
 * A regra existe porque uma cobrança precisa saber a que caixa pertence. Uma
 * maquininha solta — sem caixa, ou apontando para o tablet de outra loja —
 * geraria venda que ninguém consegue conciliar no fechamento.
 */
export async function createTerminal(params: {
  input: { deviceId: string; provider?: string | undefined; serialNumber?: string | undefined };
  request: FastifyRequest;
}) {
  const { input, request } = params;

  const device = await prisma.device.findFirst({
    where: { id: input.deviceId, companyId: request.user.companyId, deletedAt: null },
    include: { cashRegister: { include: { posStation: true } } },
  });

  if (!device) {
    throw notFound("DEVICE_NOT_FOUND", "Tablet não encontrado.");
  }

  await assertStoreAccess(request, device.storeId);

  if (device.status !== "ACTIVE") {
    throw badRequest(
      "DEVICE_NOT_ACTIVE",
      "Vincule a maquininha a um tablet já pareado e em uso.",
    );
  }

  if (input.serialNumber) {
    const taken = await prisma.paymentTerminal.findFirst({
      where: { serialNumber: input.serialNumber, deletedAt: null },
      select: { id: true },
    });
    if (taken) {
      throw conflict("SERIAL_TAKEN", "Já existe uma maquininha com este número de série.");
    }
  }

  const terminal = await prisma.paymentTerminal.create({
    data: {
      deviceId: device.id,
      cashRegisterId: device.cashRegisterId,
      posStationId: device.cashRegister.posStationId,
      storeId: device.storeId,
      companyId: device.companyId,
      provider: input.provider ?? null,
      serialNumber: input.serialNumber ?? null,
      status: "PENDING",
    },
  });

  await audit(request, {
    action: "DEVICE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: device.companyId,
    storeId: device.storeId,
    deviceId: device.id,
    userRoleSnapshot: request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    reason: "maquininha cadastrada",
    newData: { provider: terminal.provider, serialNumber: terminal.serialNumber },
  });

  return terminal;
}

export async function listTerminals(params: { request: FastifyRequest; storeId?: string }) {
  const { request, storeId } = params;

  if (storeId) {
    await assertStoreAccess(request, storeId);
  }

  const seesEverything = request.user.role === "DONO" || request.user.role === "DESENVOLVEDOR";

  const terminais = await prisma.paymentTerminal.findMany({
    where: {
      companyId: request.user.companyId,
      deletedAt: null,
      ...(storeId ? { storeId } : {}),
      ...(seesEverything ? {} : { storeId: { in: request.user.storeIds } }),
    },
    include: { device: { select: { name: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });

  // A credencial cifrada não sai daqui: a tela recebe só o apelido da conta e
  // os quatro últimos caracteres do token, o bastante para reconhecer qual é.
  return terminais.map(({ credentialsEncrypted: _cifrado, ...terminal }) => ({
    ...terminal,
    conta: resumirConta({ ...terminal, credentialsEncrypted: _cifrado }),
    /**
     * Pode receber o valor da venda direto do PDV.
     *
     * Exige as duas coisas: a conta (para falar com o Mercado Pago) e o
     * aparelho escolhido (para saber em qual das maquininhas da conta o valor
     * aparece). Só uma delas não cobra nada.
     */
    aceitaCobranca: Boolean(_cifrado && terminal.mpDeviceId),
  }));
}

/**
 * Move a maquininha para outro tablet — e, com ele, para o caixa, a estação e a
 * loja correspondentes. Reservado ao dono: mover maquininha entre lojas muda de
 * onde o dinheiro entra.
 */
export async function moveTerminal(params: {
  terminalId: string;
  targetDeviceId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { terminalId, targetDeviceId, reason, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode mover maquininhas.");
  }

  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  const target = await prisma.device.findFirst({
    where: { id: targetDeviceId, companyId: request.user.companyId, deletedAt: null },
    include: { cashRegister: true },
  });
  if (!target) {
    throw notFound("DEVICE_NOT_FOUND", "Tablet de destino não encontrado.");
  }

  const updated = await prisma.paymentTerminal.update({
    where: { id: terminal.id },
    data: {
      deviceId: target.id,
      cashRegisterId: target.cashRegisterId,
      posStationId: target.cashRegister.posStationId,
      storeId: target.storeId,
    },
  });

  await audit(request, {
    action: "DEVICE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: terminal.companyId,
    storeId: updated.storeId,
    deviceId: target.id,
    userRoleSnapshot: request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    previousData: { deviceId: terminal.deviceId, storeId: terminal.storeId },
    newData: { deviceId: updated.deviceId, storeId: updated.storeId },
    reason,
  });

  return updated;
}

/**
 * Substitui uma maquininha por outra.
 *
 * A antiga vira RETIRED em vez de sumir: as vendas já cobradas por ela precisam
 * continuar apontando para o equipamento que de fato as processou, senão a
 * conciliação com o adquirente deixa de fechar.
 */
export async function replaceTerminal(params: {
  terminalId: string;
  newSerialNumber: string;
  reason: string;
  request: FastifyRequest;
}) {
  const { terminalId, newSerialNumber, reason, request } = params;

  if (request.user.role !== "DONO") {
    throw forbidden("FORBIDDEN_ROLE", "Apenas o dono pode substituir maquininhas.");
  }

  const old = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!old) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  const replacement = await prisma.$transaction(async (tx) => {
    await tx.paymentTerminal.update({
      where: { id: old.id },
      // Perde o posto de principal junto com a aposentadoria: o caixa não pode
      // apontar para um aparelho que saiu de circulação.
      data: { status: "RETIRED", isPrimary: false },
    });

    return tx.paymentTerminal.create({
      data: {
        deviceId: old.deviceId,
        cashRegisterId: old.cashRegisterId,
        posStationId: old.posStationId,
        storeId: old.storeId,
        companyId: old.companyId,
        provider: old.provider,
        serialNumber: newSerialNumber,
        status: "PENDING",
      },
    });
  });

  await audit(request, {
    action: "DEVICE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: old.companyId,
    storeId: old.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PaymentTerminal",
    entityId: replacement.id,
    previousData: { retiredTerminalId: old.id, serialNumber: old.serialNumber },
    newData: { serialNumber: replacement.serialNumber },
    reason,
  });

  return { retired: old.id, replacement };
}

export async function setTerminalStatus(params: {
  terminalId: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  reason: string;
  request: FastifyRequest;
}) {
  const { terminalId, status, reason, request } = params;

  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  await assertStoreAccess(request, terminal.storeId);

  if (terminal.status === "RETIRED") {
    throw badRequest(
      "TERMINAL_RETIRED",
      "Esta maquininha foi substituída e não volta a operar. Cadastre a nova.",
    );
  }

  const blocking = status !== "ACTIVE";

  const updated = await prisma.paymentTerminal.update({
    where: { id: terminal.id },
    data: {
      // O schema só conhece PENDING/ACTIVE/BLOCKED/RETIRED; INACTIVE é
      // representado como BLOCKED, que é o estado de "não cobra agora".
      status: status === "INACTIVE" ? "BLOCKED" : status,
      // Bloquear tira o posto de principal: senão o PDV continuaria oferecendo
      // primeiro justo a maquininha que não pode cobrar.
      ...(blocking ? { isPrimary: false } : {}),
    },
  });

  await audit(request, {
    action: "DEVICE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: terminal.companyId,
    storeId: terminal.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    previousData: { status: terminal.status },
    newData: { status: updated.status },
    reason,
  });

  return updated;
}

/**
 * Elege a maquininha principal do caixa. As demais viram reserva.
 *
 * O PDV oferece a principal primeiro e cai para a reserva quando ela não
 * responde — maquininha sem sinal ou sem bateria no meio do expediente é
 * rotina, e o vendedor não pode ficar escolhendo de qual cobrar com o cliente
 * esperando no balcão.
 *
 * A troca é uma transação só: sem isso, uma falha entre rebaixar a antiga e
 * promover a nova deixaria o caixa sem nenhuma principal.
 */
export async function setPrimaryTerminal(params: {
  terminalId: string;
  request: FastifyRequest;
}) {
  const { terminalId, request } = params;

  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: terminalId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  await assertStoreAccess(request, terminal.storeId);

  if (terminal.status !== "ACTIVE") {
    throw badRequest(
      "TERMINAL_NOT_ACTIVE",
      "Só uma maquininha em uso pode ser a principal do caixa.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.paymentTerminal.updateMany({
      where: { cashRegisterId: terminal.cashRegisterId, isPrimary: true },
      data: { isPrimary: false },
    });

    return tx.paymentTerminal.update({
      where: { id: terminal.id },
      data: { isPrimary: true },
    });
  });

  await audit(request, {
    action: "DEVICE_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: terminal.companyId,
    storeId: terminal.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PaymentTerminal",
    entityId: terminal.id,
    newData: { isPrimary: true },
    reason: "definida como maquininha principal do caixa",
  });

  return updated;
}

/**
 * Confere se este terminal pode cobrar nesta venda.
 *
 * Chamado antes de qualquer cobrança (fase de pagamentos). Todos os elos
 * precisam bater: uma maquininha da loja A cobrando uma venda da loja B faria
 * o dinheiro entrar na conta errada e o caixa não fechar em nenhuma das duas.
 */
export async function assertTerminalCanCharge(params: {
  terminalId: string;
  storeId: string;
  cashRegisterId: string;
  deviceId: string;
}): Promise<void> {
  const terminal = await prisma.paymentTerminal.findFirst({
    where: { id: params.terminalId, deletedAt: null },
  });

  if (!terminal) {
    throw notFound("TERMINAL_NOT_FOUND", "Maquininha não encontrada.");
  }

  if (terminal.status !== "ACTIVE") {
    throw badRequest(
      "TERMINAL_NOT_ACTIVE",
      "Esta maquininha não está ativa. Use outra ou chame o responsável.",
    );
  }

  const mismatched =
    terminal.storeId !== params.storeId ||
    terminal.cashRegisterId !== params.cashRegisterId ||
    terminal.deviceId !== params.deviceId;

  if (mismatched) {
    throw forbidden(
      "TERMINAL_WRONG_BINDING",
      "Esta maquininha pertence a outro caixa. Use a que está vinculada a este tablet.",
    );
  }
}
