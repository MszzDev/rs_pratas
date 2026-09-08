import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { badRequest } from "../../core/errors.js";
import { audit } from "../../core/audit.service.js";
import { lerCredenciais } from "../integrations/integrations.service.js";
import * as mercadopago from "../integrations/mercadopago.client.js";

/**
 * O dinheiro que entrou na maquininha contra as vendas registradas.
 *
 * É a checagem que fecha o dia. A maquininha e o sistema são dois registros
 * independentes do mesmo fato, e quando eles discordam a diferença tem sempre
 * uma explicação — só que ela some se ninguém procurar na hora.
 *
 * ## O caso que importa
 *
 * **Pagamento na maquininha sem venda no sistema.** O cliente pagou, levou a
 * peça, e a venda não foi registrada: a vendedora cobrou direto na maquininha e
 * pulou o sistema, ou registrou e algo falhou no meio.
 *
 * O estrago é duplo e silencioso: a peça continua no estoque para ser vendida
 * de novo, e o faturamento do dia fica menor que o dinheiro que entrou. Nenhum
 * dos dois aparece sozinho — o caixa "bate" porque ninguém contou a peça, e a
 * diferença só é notada meses depois, se for.
 *
 * ## O caso inverso
 *
 * **Venda no sistema sem pagamento na maquininha.** Mais raro, e normalmente é
 * atraso: a operadora leva alguns minutos para registrar. Por isso aparece
 * separado e com tom mais brando — cobrar explicação de algo que se resolve
 * sozinho em cinco minutos gera desconfiança à toa.
 *
 * ## O que o sistema NÃO faz
 *
 * Não cria venda sozinho a partir de um pagamento, não cancela nada, não baixa
 * estoque por conta própria. Um pagamento não diz **qual peça** saiu, e chutar
 * isso estragaria o estoque com a aparência de tê-lo corrigido. O sistema
 * mostra a diferença; quem sabe o que aconteceu é quem estava no balcão.
 */

/** Estados em que o dinheiro efetivamente entrou. */
const ENTROU = ["approved", "authorized", "in_process"];

export interface Diferenca {
  tipo: "PAGAMENTO_SEM_VENDA" | "VENDA_SEM_PAGAMENTO";
  quando: Date;
  valor: string;
  /** O identificador do lado que existe: id do pagamento, ou código da venda. */
  referencia: string;
  detalhe: string;
}

export interface Conciliacao {
  de: Date;
  ate: Date;
  loja: string;
  pagamentosNaMaquininha: number;
  vendasNoSistema: number;
  totalNaMaquininha: string;
  totalNoSistema: string;
  diferencas: Diferenca[];
}

/**
 * Compara um período da maquininha com as vendas do sistema.
 *
 * O casamento é por **valor e horário**, e não por código de autorização,
 * porque hoje o código é digitado à mão pela vendedora — quando é digitado. Um
 * campo que às vezes está preenchido não serve de chave.
 *
 * A janela de tolerância existe porque os dois relógios não são o mesmo: o da
 * maquininha carimba quando a operadora aprovou, o do sistema quando a
 * vendedora terminou de fechar a venda. Alguns minutos entre eles é o normal,
 * não uma divergência.
 */
export async function conciliarMaquininha(params: {
  request: FastifyRequest;
  storeId: string;
  de: Date;
  ate: Date;
}): Promise<Conciliacao> {
  const { request, storeId, de, ate } = params;

  const loja = await prisma.store.findFirst({
    where: { id: storeId, companyId: request.user.companyId, deletedAt: null },
    select: { name: true },
  });

  if (!loja) throw badRequest("STORE_NOT_FOUND", "Loja não encontrada.");

  /**
   * A credencial é da MAQUININHA, não da empresa.
   *
   * Cada aparelho está numa conta própria — foi assim que a loja contratou. Uma
   * credencial só da empresa consultaria a conta errada e diria que um
   * pagamento que existe não foi encontrado, que é o pior erro possível numa
   * conferência: o falso alarme destrói a confiança na ferramenta inteira.
   */
  const terminais = await prisma.paymentTerminal.findMany({
    where: { storeId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, serialNumber: true, credentialsEncrypted: true },
  });

  const comCredencial = terminais.filter((t) => t.credentialsEncrypted);

  if (comCredencial.length === 0) {
    throw badRequest(
      "TERMINAL_WITHOUT_CREDENTIAL",
      "Nenhuma maquininha desta loja tem a conta do Mercado Pago ligada. Ligue em Configurações → Maquininhas.",
    );
  }

  const pagamentos: Array<{ id: string; valor: number; quando: Date }> = [];

  for (const terminal of comCredencial) {
    const credenciais = lerCredenciais(terminal.credentialsEncrypted);
    if (!credenciais.accessToken) continue;

    const encontrados = await mercadopago.searchPayments(credenciais.accessToken, { de, ate });

    for (const p of encontrados) {
      if (!ENTROU.includes(p.status)) continue;
      pagamentos.push({
        id: String(p.id),
        valor: Number(p.transaction_amount ?? 0),
        quando: new Date(p.date_approved ?? p.date_created),
      });
    }
  }

  const vendas = await prisma.salePayment.findMany({
    where: {
      method: { in: ["DEBITO", "CREDITO", "CREDITO_PARCELADO"] },
      sale: {
        storeId,
        status: "CONCLUIDA",
        createdAt: { gte: de, lte: ate },
      },
    },
    select: {
      amount: true,
      createdAt: true,
      sale: { select: { code: true, createdAt: true } },
    },
  });

  /** Cinco minutos: a distância normal entre o relógio da operadora e o nosso. */
  const TOLERANCIA_MS = 5 * 60 * 1000;

  const vendasSobrando = [...vendas];
  const diferencas: Diferenca[] = [];

  for (const pagamento of pagamentos) {
    const indice = vendasSobrando.findIndex(
      (v) =>
        Math.abs(Number(v.amount) - pagamento.valor) < 0.01 &&
        Math.abs(v.sale.createdAt.getTime() - pagamento.quando.getTime()) < TOLERANCIA_MS,
    );

    if (indice >= 0) {
      // Casou: cada venda casa com um pagamento só, senão dois pagamentos
      // iguais no mesmo minuto casariam com a mesma venda e um sumiria.
      vendasSobrando.splice(indice, 1);
      continue;
    }

    diferencas.push({
      tipo: "PAGAMENTO_SEM_VENDA",
      quando: pagamento.quando,
      valor: pagamento.valor.toFixed(2),
      referencia: pagamento.id,
      detalhe:
        "Entrou dinheiro na maquininha e não há venda registrada no sistema. " +
        "A peça pode ter saído da loja sem baixa no estoque.",
    });
  }

  for (const venda of vendasSobrando) {
    diferencas.push({
      tipo: "VENDA_SEM_PAGAMENTO",
      quando: venda.sale.createdAt,
      valor: Number(venda.amount).toFixed(2),
      referencia: venda.sale.code,
      detalhe:
        "Venda registrada no cartão sem pagamento correspondente na maquininha. " +
        "Costuma ser atraso da operadora; confira daqui a pouco antes de investigar.",
    });
  }

  diferencas.sort((a, b) => b.quando.getTime() - a.quando.getTime());

  const totalMaquininha = pagamentos.reduce((s, p) => s + p.valor, 0);
  const totalSistema = vendas.reduce((s, v) => s + Number(v.amount), 0);

  await audit(request, {
    action: "DATA_EXPORT",
    result: "SUCCESS",
    userId: request.user.sub,
    companyId: request.user.companyId,
    storeId,
    userRoleSnapshot: request.user.role,
    entityType: "Store",
    entityId: storeId,
    reason: "conciliação da maquininha",
    metadata: {
      pagamentos: pagamentos.length,
      vendas: vendas.length,
      diferencas: diferencas.length,
    },
  });

  return {
    de,
    ate,
    loja: loja.name,
    pagamentosNaMaquininha: pagamentos.length,
    vendasNoSistema: vendas.length,
    totalNaMaquininha: totalMaquininha.toFixed(2),
    totalNoSistema: totalSistema.toFixed(2),
    diferencas,
  };
}
