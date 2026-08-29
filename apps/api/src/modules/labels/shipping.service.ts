import type { FastifyRequest } from "fastify";
import type { LabelElement } from "@rs-pratas/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess } from "../../core/rbac/require-role.hook.js";
import * as nuvemshop from "../integrations/nuvemshop.client.js";
import { credenciaisDaNuvemshop } from "../integrations/nuvemshop-import.service.js";

/**
 * Etiqueta de envio a partir da compra na loja virtual.
 *
 * A etiqueta da peça responde "o que é isto e quanto custa". A do pacote
 * responde "para onde vai e quem mandou". Compartilham o editor, o desenho e a
 * impressora — posicionar em milímetros é a mesma mecânica — e não
 * compartilham a origem dos dados.
 *
 * O endereço vem do PEDIDO, e não do cadastro de cliente. Dois motivos: é o
 * endereço que a pessoa digitou para aquela compra (ela pode ter mandado para
 * o trabalho, ou de presente para outra pessoa), e é o único que já existe
 * preenchido — o cadastro de cliente do balcão nunca teve campo de endereço.
 *
 * Copiar o endereço para dentro do trabalho de impressão, em vez de buscar na
 * hora, é a mesma regra do preço na etiqueta da peça: o que sai no papel é o
 * que foi conferido na tela, mesmo que o cliente mude o endereço no site cinco
 * minutos depois.
 */

export interface PedidoParaEnviar {
  id: string;
  numero: number;
  cliente: string | null;
  criadoEm: string;
  total: string;
  situacao: string;
  situacaoDoEnvio: string | null;
  /** Falso quando é retirada na loja: não há endereço, e não há o que imprimir. */
  temEndereco: boolean;
  destino: string | null;
  cep: string | null;
  /** Já existe etiqueta deste pedido na fila ou impressa. */
  jaEnfileirado: boolean;
}

/**
 * Os pedidos recentes da loja virtual, com o que interessa para despachar.
 *
 * Traz também quais já têm etiqueta pedida. Sem isso, o funcionário que
 * atende o balcão entre um pacote e outro perde a conta e imprime a mesma
 * etiqueta duas vezes — e duas etiquetas no mesmo pacote é como um vai para o
 * endereço errado.
 */
export async function listShippingOrders(params: {
  request: FastifyRequest;
  desdeDias?: number | undefined;
}): Promise<PedidoParaEnviar[]> {
  const { request } = params;
  const { conta } = await credenciaisDaNuvemshop(request.user.companyId);

  const desde = new Date();
  desde.setDate(desde.getDate() - (params.desdeDias ?? 30));

  const pedidos = await nuvemshop.listOrders(conta, desde);

  const jobs = await prisma.printJob.findMany({
    where: {
      companyId: request.user.companyId,
      referenceType: REFERENCIA,
      referenceId: { in: pedidos.map((pedido) => String(pedido.id)) },
    },
    select: { referenceId: true },
  });

  const enfileirados = new Set(jobs.map((job) => job.referenceId));

  return pedidos.map((pedido) => {
    const endereco = pedido.shipping_address ?? null;
    const cidade = [endereco?.city, endereco?.province].filter(Boolean).join(" - ");

    return {
      id: String(pedido.id),
      numero: pedido.number,
      cliente: endereco?.name ?? pedido.contact_name ?? pedido.customer?.name ?? null,
      criadoEm: pedido.created_at,
      total: pedido.total,
      situacao: pedido.status,
      situacaoDoEnvio: pedido.shipping_status ?? null,
      // Endereço sem CEP não vira etiqueta que os Correios triam: é o CEP que
      // decide o caminho do pacote.
      temEndereco: Boolean(endereco?.address && endereco.zipcode),
      destino: cidade || null,
      cep: endereco?.zipcode ?? null,
      jaEnfileirado: enfileirados.has(String(pedido.id)),
    };
  });
}

/** O que grava em `referenceType`, para reconhecer a etiqueta deste pedido depois. */
const REFERENCIA = "NuvemshopOrder";

export async function queueShippingLabel(params: {
  input: {
    storeId: string;
    orderId: string;
    copies: number;
    templateId?: string | undefined;
    deviceId?: string | undefined;
  };
  request: FastifyRequest;
}) {
  const { input, request } = params;
  await assertStoreAccess(request, input.storeId);

  const { conta } = await credenciaisDaNuvemshop(request.user.companyId);
  const pedido = await nuvemshop.getOrder(conta, input.orderId);

  const endereco = pedido.shipping_address ?? null;
  if (!endereco?.address || !endereco.zipcode) {
    throw badRequest(
      "NO_SHIPPING_ADDRESS",
      "Este pedido não tem endereço de entrega — provavelmente é retirada na loja.",
    );
  }

  /**
   * O modelo tem de ser escolhido, e não adivinhado.
   *
   * O modelo padrão da empresa é o da etiqueta de joia: 90 × 12 mm. Imprimir um
   * endereço nele gastaria o rolo e não daria para ler nada. Sem modelo
   * indicado, é melhor recusar e dizer o porquê.
   */
  const template = input.templateId
    ? await prisma.labelTemplate.findFirst({
        where: { id: input.templateId, companyId: request.user.companyId, deletedAt: null },
      })
    : null;

  if (!template) {
    throw badRequest(
      "SHIPPING_TEMPLATE_REQUIRED",
      "Escolha o modelo da etiqueta de envio. O modelo padrão é o da peça, e um endereço não cabe nele.",
    );
  }

  const loja = await prisma.store.findFirstOrThrow({
    where: { id: input.storeId, companyId: request.user.companyId },
    select: { name: true, phone: true, addressJson: true },
  });

  const job = await prisma.printJob.create({
    data: {
      companyId: request.user.companyId,
      storeId: input.storeId,
      deviceId: input.deviceId ?? null,
      type: "ETIQUETA",
      templateId: template.id,
      copies: input.copies,
      referenceType: REFERENCIA,
      referenceId: String(pedido.id),
      requestedById: request.user.sub,
      payload: {
        // A etiqueta de envio não fala de peça nenhuma: os campos de produto
        // vão nulos, e o desenho simplesmente não os mostra.
        productName: null,
        sku: null,
        price: null,
        size: null,
        weightGrams: null,
        // O código de barras carrega o número do pedido: é o que casa o pacote
        // com a venda quando ele volta, e o que o balcão bipa na conferência.
        barcode: `PED${pedido.number}`,
        envio: {
          destinatario: endereco.name ?? pedido.contact_name ?? null,
          endereco: linhasDoEndereco(endereco),
          bairro: endereco.locality ?? null,
          cidadeUf: [endereco.city, endereco.province].filter(Boolean).join(" - ") || null,
          cep: endereco.zipcode ?? null,
          remetente: blocoDoRemetente(loja),
          pedido: String(pedido.number),
        },
        layout: {
          widthMm: Number(template.widthMm),
          heightMm: Number(template.heightMm),
          offsetXMm: Number(template.offsetXMm),
          offsetYMm: Number(template.offsetYMm),
          fontScale: Number(template.fontScale),
          // Etiqueta de pacote nunca é dupla: ela é colada, não dobrada.
          isDoubleSided: false,
          elements: (template.elements as LabelElement[] | null) ?? null,
        },
      } satisfies Prisma.InputJsonValue,
    },
  });

  await audit(request, {
    action: "PRINT_JOB_CREATE",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId: input.storeId,
    userRoleSnapshot: request.user.role,
    entityType: "PrintJob",
    entityId: job.id,
    newData: { pedido: pedido.number, copies: input.copies, template: template.code },
    reason: "etiqueta de envio da loja virtual",
  });

  return job;
}

/**
 * O endereço em linhas, montado aqui e não na tela.
 *
 * Quem monta o texto é o servidor porque a etiqueta precisa sair igual no
 * tablet e no computador, e porque o trabalho na fila tem de carregar o texto
 * pronto: se a regra de montagem mudar amanhã, o pacote que já estava na fila
 * não pode sair com endereço em outro formato.
 */
function linhasDoEndereco(endereco: {
  address?: string | null;
  number?: string | null;
  floor?: string | null;
}): string {
  const ruaENumero = [endereco.address, endereco.number].filter(Boolean).join(", ");

  // O complemento vai na própria linha: espremido no fim da rua, ele é a parte
  // que o carteiro deixa de ler, e é justamente ela que diz o apartamento.
  return [ruaENumero, endereco.floor].filter(Boolean).join("\n");
}

function blocoDoRemetente(loja: {
  name: string;
  phone: string | null;
  addressJson: unknown;
}): string {
  const endereco = loja.addressJson as {
    logradouro?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  } | null;

  const ruaENumero = [endereco?.logradouro, endereco?.numero].filter(Boolean).join(", ");
  const cidade = [endereco?.bairro, endereco?.cidade, endereco?.uf].filter(Boolean).join(" - ");

  return [
    `Remetente: ${loja.name}`,
    ruaENumero,
    [endereco?.cep, cidade].filter(Boolean).join(" "),
    loja.phone,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Usado pela rota para recusar cedo quando a integração não está conectada. */
export async function assertNuvemshopConectada(companyId: string): Promise<void> {
  const integration = await prisma.integration.findUnique({
    where: { companyId_provider: { companyId, provider: "NUVEMSHOP" } },
  });

  if (!integration || integration.status !== "CONECTADA") {
    throw notFound(
      "INTEGRATION_NOT_CONNECTED",
      "A loja virtual não está conectada. Configurações → Integrações.",
    );
  }
}
