import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";

/**
 * Os pedidos de LGPD que chegam da loja virtual.
 *
 * A Nuvemshop avisa quando um cliente pede para apagar os dados dele, quando
 * pede uma cópia deles, ou quando a loja desinstala o aplicativo. Os avisos já
 * chegavam e ficavam registrados; o que faltava era o que fazer com eles.
 *
 * Atender é um ATO DO DONO, não automático. A mensagem chega pela internet, e
 * apagar cliente porque uma mensagem mandou é o tipo de coisa que, feita
 * errado, não tem volta — o histórico de compras da pessoa some junto. Aqui a
 * fila fica visível, com um botão, e quem responde tem nome.
 *
 * O que se apaga é a IDENTIFICAÇÃO, não a venda: nome, telefone e e-mail saem;
 * a compra continua no faturamento e no estoque, sem dono. É o que a lei pede
 * e o que a contabilidade exige — nota fiscal emitida não se apaga.
 */

/** Os assuntos que a Nuvemshop manda quando o tema é dado pessoal. */
const TOPICOS = {
  apagarCliente: "customers/redact",
  copiaDosDados: "customers/data_request",
  lojaSaiu: "store/redact",
} as const;

const TOPICOS_LGPD = Object.values(TOPICOS) as string[];

interface PedidoDeLgpd {
  id: string;
  topic: string;
  createdAt: Date;
  processedAt: Date | null;
  /** Quem o pedido menciona, quando dá para saber. */
  cliente: { id: string; name: string; phone: string | null } | null;
  descricao: string;
}

function descrever(topic: string, nome: string | null): string {
  if (topic === TOPICOS.apagarCliente) {
    return nome
      ? `${nome} pediu que os dados dela sejam apagados.`
      : "Um cliente pediu que os dados dele sejam apagados.";
  }

  if (topic === TOPICOS.copiaDosDados) {
    return nome
      ? `${nome} pediu uma cópia dos dados que a loja guarda.`
      : "Um cliente pediu uma cópia dos dados que a loja guarda.";
  }

  return "A loja virtual desinstalou o aplicativo e pediu a remoção dos dados dela.";
}

/**
 * Acha o cliente citado no pedido.
 *
 * A Nuvemshop manda o id dela e, quando existe, o e-mail — e é pelo e-mail e
 * pelo telefone que o cadastro daqui se reconhece, porque o id de lá não é o
 * id daqui.
 */
async function clienteDoPedido(companyId: string, payload: unknown) {
  const corpo = payload as { customer?: { email?: string; phone?: string; identification?: string } };
  const email = corpo?.customer?.email;
  const telefone = (corpo?.customer?.phone ?? "").replace(/\D/g, "");

  if (!email && !telefone) return null;

  return prisma.customer.findFirst({
    where: {
      companyId,
      deletedAt: null,
      OR: [...(email ? [{ email }] : []), ...(telefone ? [{ phone: telefone }] : [])],
    },
    select: { id: true, name: true, phone: true },
  });
}

/** A fila de pedidos, com o que ainda não foi atendido primeiro. */
export async function listLgpdRequests(request: FastifyRequest): Promise<PedidoDeLgpd[]> {
  const eventos = await prisma.integrationEvent.findMany({
    where: { companyId: request.user.companyId, topic: { in: TOPICOS_LGPD } },
    orderBy: [{ processedAt: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return Promise.all(
    eventos.map(async (evento) => {
      const cliente = await clienteDoPedido(request.user.companyId, evento.payload);

      return {
        id: evento.id,
        topic: evento.topic,
        createdAt: evento.createdAt,
        processedAt: evento.processedAt,
        cliente,
        descricao: descrever(evento.topic, cliente?.name ?? null),
      };
    }),
  );
}

/**
 * Atende o pedido.
 *
 * Apagar dado de cliente aqui significa anonimizar: a pessoa deixa de ser
 * identificável, e a venda continua existindo sem dono. Apagar a linha inteira
 * levaria junto o faturamento do mês e o histórico de garantia de quem comprou
 * antes — e a lei que manda apagar o dado pessoal é a mesma que reconhece a
 * obrigação fiscal de guardar a venda.
 */
export async function fulfillLgpdRequest(params: { eventId: string; request: FastifyRequest }) {
  const { eventId, request } = params;

  const evento = await prisma.integrationEvent.findFirst({
    where: { id: eventId, companyId: request.user.companyId },
  });

  if (!evento || !TOPICOS_LGPD.includes(evento.topic)) {
    throw notFound("REQUEST_NOT_FOUND", "Pedido não encontrado.");
  }

  if (evento.processedAt) {
    throw badRequest("ALREADY_FULFILLED", "Este pedido já foi atendido.");
  }

  const cliente = await clienteDoPedido(request.user.companyId, evento.payload);

  if (evento.topic === TOPICOS.apagarCliente) {
    if (!cliente) {
      // Nada a apagar: o cliente do site nunca virou cadastro aqui. Marcar
      // como atendido é o registro honesto disso.
      await prisma.integrationEvent.update({
        where: { id: evento.id },
        data: { processedAt: new Date() },
      });

      return { atendido: true, resultado: "Nenhum cadastro correspondente nesta loja." };
    }

    await prisma.customer.update({
      where: { id: cliente.id },
      data: {
        name: "Cliente removido a pedido",
        email: null,
        // O telefone é chave de busca no PDV: esvaziá-lo é o que impede
        // reencontrar a pessoa pelo número que ela pediu para apagar.
        phone: `apagado-${cliente.id.slice(0, 8)}`,
        cpf: null,
        birthDate: null,
        notes: null,
        deletedAt: new Date(),
      },
    });
  }

  await prisma.integrationEvent.update({
    where: { id: evento.id },
    data: { processedAt: new Date() },
  });

  await audit(request, {
    action: "DATA_EXPORT",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    userRoleSnapshot: request.user.role,
    entityType: "Customer",
    ...(cliente ? { entityId: cliente.id } : {}),
    reason: `pedido de LGPD atendido: ${evento.topic}`,
  });

  return {
    atendido: true,
    resultado:
      evento.topic === TOPICOS.apagarCliente
        ? "Dados pessoais apagados. As compras continuam no histórico, sem identificação."
        : "Pedido marcado como atendido.",
  };
}

/**
 * A cópia dos dados que a loja guarda de um cliente.
 *
 * Sai como texto para o dono enviar à pessoa — é o que a lei chama de direito
 * de acesso. Não vai por e-mail automático de propósito: quem confirma que o
 * pedido é da própria pessoa é quem atende, não o sistema.
 */
export async function exportCustomerData(params: { customerId: string; request: FastifyRequest }) {
  const cliente = await prisma.customer.findFirst({
    where: { id: params.customerId, companyId: params.request.user.companyId },
    include: {
      sales: {
        select: { code: true, completedAt: true, totalAmount: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      },
    },
  });

  if (!cliente) {
    throw notFound("CUSTOMER_NOT_FOUND", "Cliente não encontrado.");
  }

  await audit(params.request, {
    action: "DATA_EXPORT",
    result: "SUCCESS",
    userId: params.request.user.sub,
    companyId: params.request.user.companyId,
    userRoleSnapshot: params.request.user.role,
    entityType: "Customer",
    entityId: cliente.id,
    reason: "cópia dos dados entregue ao titular",
  });

  return {
    cliente: {
      nome: cliente.name,
      telefone: cliente.phone,
      email: cliente.email,
      documento: cliente.cpf,
      nascimento: cliente.birthDate,
      cadastradoEm: cliente.createdAt,
    },
    compras: cliente.sales.map((venda) => ({
      codigo: venda.code,
      data: venda.completedAt,
      total: venda.totalAmount.toString(),
      situacao: venda.status,
    })),
  };
}
