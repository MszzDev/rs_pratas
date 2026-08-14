import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";

/** Guarda só os dígitos: o vendedor digita com traço, com parêntese, ou sem. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Validação de CPF pelos dígitos verificadores.
 *
 * Não prova que o CPF existe nem que é do cliente — só que não é um número
 * digitado errado. Serve para pegar o erro de digitação na hora, e não no dia
 * de emitir a nota.
 */
export function isValidCpf(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  // Sequências repetidas passam no cálculo mas nunca são CPF real.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
}

export async function listCustomers(params: {
  request: FastifyRequest;
  search?: string | undefined;
}) {
  const { request, search } = params;
  const digits = search ? search.replace(/\D/g, "") : "";

  return prisma.customer.findMany({
    where: {
      companyId: request.user.companyId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              // Busca por telefone só quando o que foi digitado tem dígitos,
              // senão `contains: ""` casaria com todo mundo.
              ...(digits ? [{ phone: { contains: digits } }] : []),
              ...(digits ? [{ cpf: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 100,
  });
}

export async function getCustomer(params: { customerId: string; request: FastifyRequest }) {
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, companyId: params.request.user.companyId, deletedAt: null },
    include: {
      sales: {
        where: { status: "CONCLUIDA" },
        orderBy: { completedAt: "desc" },
        take: 20,
        include: { items: { select: { productName: true, quantity: true } } },
      },
      reservations: {
        where: { status: "ATIVA" },
        orderBy: { expiresAt: "asc" },
      },
    },
  });

  if (!customer) {
    throw notFound("CUSTOMER_NOT_FOUND", "Cliente não encontrado.");
  }

  return customer;
}

export async function createCustomer(params: {
  input: {
    name: string;
    phone: string;
    cpf?: string | undefined;
    email?: string | undefined;
    birthDate?: string | undefined;
    ringSize?: string | undefined;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  const phone = normalizePhone(input.phone);

  if (phone.length < 10) {
    throw badRequest("INVALID_PHONE", "Informe o telefone com DDD.");
  }

  if (input.cpf && !isValidCpf(input.cpf)) {
    throw badRequest("INVALID_CPF", "Este CPF não é válido. Confira os números.");
  }

  const existing = await prisma.customer.findFirst({
    where: { companyId: request.user.companyId, phone },
    select: { id: true, name: true },
  });
  if (existing) {
    throw conflict(
      "CUSTOMER_EXISTS",
      `Este telefone já é de ${existing.name}. Abra o cadastro dele em vez de criar outro.`,
      { customerId: existing.id },
    );
  }

  const customer = await prisma.customer.create({
    data: {
      companyId: request.user.companyId,
      name: input.name,
      phone,
      cpf: input.cpf ? input.cpf.replace(/\D/g, "") : null,
      email: input.email ?? null,
      birthDate: input.birthDate ? new Date(input.birthDate) : null,
      ringSize: input.ringSize ?? null,
      notes: input.notes ?? null,
      createdById: request.user.sub,
    },
  });

  await audit(request, {
    action: "CUSTOMER_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Customer",
    entityId: customer.id,
    newData: { name: customer.name, phone: customer.phone },
  });

  return customer;
}

export async function updateCustomer(params: {
  customerId: string;
  input: {
    name?: string | undefined;
    phone?: string | undefined;
    cpf?: string | undefined;
    email?: string | undefined;
    birthDate?: string | undefined;
    ringSize?: string | undefined;
    notes?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { customerId, input, request } = params;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: request.user.companyId, deletedAt: null },
  });
  if (!customer) {
    throw notFound("CUSTOMER_NOT_FOUND", "Cliente não encontrado.");
  }

  const phone = input.phone ? normalizePhone(input.phone) : undefined;

  if (phone && phone !== customer.phone) {
    const taken = await prisma.customer.findFirst({
      where: { companyId: request.user.companyId, phone },
      select: { id: true },
    });
    if (taken) {
      throw conflict("CUSTOMER_EXISTS", "Já existe outro cliente com este telefone.");
    }
  }

  if (input.cpf && !isValidCpf(input.cpf)) {
    throw badRequest("INVALID_CPF", "Este CPF não é válido. Confira os números.");
  }

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(input.cpf !== undefined ? { cpf: input.cpf.replace(/\D/g, "") || null } : {}),
      ...(input.email !== undefined ? { email: input.email || null } : {}),
      ...(input.birthDate !== undefined ? { birthDate: new Date(input.birthDate) } : {}),
      ...(input.ringSize !== undefined ? { ringSize: input.ringSize || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    },
  });

  await audit(request, {
    action: "CUSTOMER_UPDATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Customer",
    entityId: customer.id,
    previousData: { name: customer.name, phone: customer.phone },
    newData: { name: updated.name, phone: updated.phone },
  });

  return updated;
}

/**
 * Busca ou cria pelo telefone — o caminho do balcão.
 *
 * No PDV o vendedor digita o telefone e o nome; se o cliente já existe, o
 * cadastro é reaproveitado em vez de duplicado, porque histórico de compra
 * espalhado em dois cadastros não é histórico de ninguém.
 */
export async function findOrCreateByPhone(params: {
  name: string;
  phone: string;
  request: FastifyRequest;
}) {
  const phone = normalizePhone(params.phone);

  const existing = await prisma.customer.findFirst({
    where: { companyId: params.request.user.companyId, phone },
  });

  if (existing) return existing;

  return createCustomer({
    input: { name: params.name, phone },
    request: params.request,
  });
}
