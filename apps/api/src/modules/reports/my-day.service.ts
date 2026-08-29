import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";

/**
 * O dia da vendedora, pelos olhos dela.
 *
 * O perfil VENDEDOR tem sete permissões, e nenhuma deixava ela ver quanto
 * vendeu. Na prática isso virava uma pergunta para a gerente — que abria o
 * Painel para responder, várias vezes por dia, sempre a mesma coisa.
 *
 * Três regras que este arquivo respeita:
 *
 * 1. **Só o número dela.** Não recebe `userId` por parâmetro de propósito: o
 *    dono da sessão é quem ele diz ser no token. Aceitar um id na URL
 *    transformaria isto na porta pela qual uma vendedora leria a comissão da
 *    colega.
 * 2. **Só o dia de hoje, na loja onde ela está.** Não é relatório; é o painel
 *    do turno. Histórico e comparação entre pessoas são assunto do Painel, que
 *    tem outro dono e outra permissão.
 * 3. **Comissão pela mesma regra do fechamento.** Reaproveita a resolução de
 *    regra do cálculo oficial. Uma segunda implementação daria um número
 *    parecido e diferente — e a vendedora acreditaria no que viu aqui.
 */

interface MeuDia {
  vendas: number;
  pecas: number;
  faturamento: string;
  /** Quanto a venda média dela está valendo hoje. */
  ticketMedio: string;
  meta: {
    alvo: string;
    alcancado: string;
    faltam: string;
    percentual: number;
    ateQuando: string;
  } | null;
  comissao: {
    valor: string;
    percentual: string;
    base: "FATURAMENTO" | "MARGEM";
    /** Explica o zero quando existe piso e ele não foi atingido. */
    observacao: string | null;
  } | null;

  /**
   * A semana da vendedora.
   *
   * O dia sozinho responde mal: uma terça fraca depois de uma segunda cheia
   * parece fracasso, e não é. A semana é o menor período em que o esforço de
   * quem está no balcão aparece como tendência — e ainda dá tempo de mudar
   * antes que ela acabe.
   */
  semana: {
    faturamento: string;
    vendas: number;
    pecas: number;
    ticketMedio: string;
    /** Em quantos dias da semana ela já vendeu. */
    diasComVenda: number;
    /** O melhor dia até agora, para ela saber o que dá para repetir. */
    melhorDia: { dia: string; valor: string } | null;
    /** O MESMO trecho da semana passada, para comparar sem enganar. */
    semanaPassada: string;
  };
}

function emReal(valor: Prisma.Decimal): string {
  return valor.toFixed(2);
}

/**
 * A regra de comissão que vale para esta pessoa nesta loja.
 *
 * A ordem é a mesma do cálculo oficial: regra da pessoa vence regra da loja,
 * que vence a regra geral. Repetir a ordem errada aqui faria a vendedora ver
 * um número e receber outro.
 */
async function regraDaPessoa(params: { companyId: string; storeId: string; userId: string }) {
  const candidatas = await prisma.commissionRule.findMany({
    where: {
      companyId: params.companyId,
      isActive: true,
      OR: [
        { userId: params.userId },
        { userId: null, storeId: params.storeId },
        { userId: null, storeId: null },
      ],
    },
  });

  return (
    candidatas.find((regra) => regra.userId === params.userId) ??
    candidatas.find((regra) => regra.userId === null && regra.storeId === params.storeId) ??
    candidatas.find((regra) => regra.userId === null && regra.storeId === null) ??
    null
  );
}

export async function getMyDay(params: {
  request: FastifyRequest;
  storeId: string;
}): Promise<MeuDia> {
  const { request, storeId } = params;

  // O dia começa à meia-noite do fuso da loja. Usar UTC faria a vendedora do
  // turno da noite ver o dia virar às nove da noite.
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0, 0);

  const vendas = await prisma.sale.findMany({
    where: {
      companyId: request.user.companyId,
      sellerId: request.user.sub,
      storeId,
      status: "CONCLUIDA",
      completedAt: { gte: inicio, lte: agora },
    },
    select: {
      totalAmount: true,
      items: { select: { quantity: true, unitCostSnapshot: true } },
    },
  });

  let faturamento = new Prisma.Decimal(0);
  let custo = new Prisma.Decimal(0);
  let pecas = 0;

  for (const venda of vendas) {
    faturamento = faturamento.plus(venda.totalAmount);

    for (const item of venda.items) {
      pecas += item.quantity;
      if (item.unitCostSnapshot) {
        custo = custo.plus(item.unitCostSnapshot.mul(item.quantity));
      }
    }
  }

  const ticket =
    vendas.length > 0 ? faturamento.div(vendas.length) : new Prisma.Decimal(0);

  // ------------------------------------------------------------- a semana
  //
  // Começa no domingo, como o calendário — e não sete dias para trás. "Minha
  // semana" tem que ser a mesma semana que ela vê no celular, senão o número
  // não bate com nada que ela conheça.
  const inicioDaSemana = new Date(inicio);
  inicioDaSemana.setDate(inicio.getDate() - inicio.getDay());

  const daSemana = await prisma.sale.findMany({
    where: {
      companyId: request.user.companyId,
      sellerId: request.user.sub,
      storeId,
      status: "CONCLUIDA",
      completedAt: { gte: inicioDaSemana, lte: agora },
    },
    select: {
      totalAmount: true,
      completedAt: true,
      items: { select: { quantity: true } },
    },
  });

  /**
   * A comparação usa o MESMO TRECHO da semana passada.
   *
   * Comparar uma quarta-feira com a semana passada inteira diria sempre que
   * ela está pior — e número que sempre desanima acaba ignorado. Numa quarta,
   * compara-se com domingo a quarta da semana anterior.
   */
  const inicioAnterior = new Date(inicioDaSemana);
  inicioAnterior.setDate(inicioDaSemana.getDate() - 7);

  const mesmoPontoAnterior = new Date(agora);
  mesmoPontoAnterior.setDate(agora.getDate() - 7);

  const anteriores = await prisma.sale.aggregate({
    where: {
      companyId: request.user.companyId,
      sellerId: request.user.sub,
      storeId,
      status: "CONCLUIDA",
      completedAt: { gte: inicioAnterior, lte: mesmoPontoAnterior },
    },
    _sum: { totalAmount: true },
  });

  let faturamentoSemana = new Prisma.Decimal(0);
  let pecasSemana = 0;
  const porDia = new Map<string, { dia: Date; valor: Prisma.Decimal }>();

  for (const venda of daSemana) {
    faturamentoSemana = faturamentoSemana.plus(venda.totalAmount);
    for (const item of venda.items) pecasSemana += item.quantity;

    const quando = venda.completedAt ?? agora;
    const chave = `${quando.getFullYear()}-${quando.getMonth()}-${quando.getDate()}`;
    const acumulado = porDia.get(chave);

    porDia.set(chave, {
      dia: acumulado?.dia ?? quando,
      valor: (acumulado?.valor ?? new Prisma.Decimal(0)).plus(venda.totalAmount),
    });
  }

  const melhor = [...porDia.values()].sort((a, b) => b.valor.comparedTo(a.valor))[0];

  const semana: MeuDia["semana"] = {
    faturamento: emReal(faturamentoSemana),
    vendas: daSemana.length,
    pecas: pecasSemana,
    ticketMedio: emReal(
      daSemana.length > 0 ? faturamentoSemana.div(daSemana.length) : new Prisma.Decimal(0),
    ),
    diasComVenda: porDia.size,
    melhorDia: melhor
      ? {
          dia: melhor.dia.toLocaleDateString("pt-BR", { weekday: "long" }),
          valor: emReal(melhor.valor),
        }
      : null,
    semanaPassada: emReal(anteriores._sum.totalAmount ?? new Prisma.Decimal(0)),
  };

  // --------------------------------------------------------------- a meta

  const meta = await prisma.goal.findFirst({
    where: {
      companyId: request.user.companyId,
      storeId,
      scope: "VENDEDOR",
      userId: request.user.sub,
      periodStart: { lte: agora },
      periodEnd: { gte: agora },
    },
    orderBy: { periodStart: "desc" },
  });

  let metaResposta: MeuDia["meta"] = null;

  if (meta) {
    // O alcançado é do PERÍODO da meta, não do dia: meta de março se mede em
    // março. Mostrar só o dia de hoje contra o alvo do mês faria toda meta
    // parecer impossível às nove da manhã.
    const doPeriodo = await prisma.sale.aggregate({
      where: {
        companyId: request.user.companyId,
        sellerId: request.user.sub,
        storeId,
        status: "CONCLUIDA",
        completedAt: { gte: meta.periodStart, lte: agora },
      },
      _sum: { totalAmount: true },
    });

    const alcancado = doPeriodo._sum.totalAmount ?? new Prisma.Decimal(0);
    const faltam = Prisma.Decimal.max(meta.targetAmount.minus(alcancado), 0);

    metaResposta = {
      alvo: emReal(meta.targetAmount),
      alcancado: emReal(alcancado),
      faltam: emReal(faltam),
      percentual: meta.targetAmount.isZero()
        ? 0
        : Math.min(100, Math.round(alcancado.div(meta.targetAmount).mul(100).toNumber())),
      ateQuando: meta.periodEnd.toISOString(),
    };
  }

  // ----------------------------------------------------------- a comissão

  const regra = await regraDaPessoa({
    companyId: request.user.companyId,
    storeId,
    userId: request.user.sub,
  });

  let comissaoResposta: MeuDia["comissao"] = null;

  if (regra) {
    const base = regra.basis === "MARGEM" ? faturamento.minus(custo) : faturamento;
    const abaixoDoPiso = faturamento.lessThan(regra.minimumSalesAmount);

    const valor = abaixoDoPiso
      ? new Prisma.Decimal(0)
      : Prisma.Decimal.max(base, 0).mul(regra.percent).div(100);

    comissaoResposta = {
      valor: emReal(valor),
      percentual: regra.percent.toFixed(2),
      base: regra.basis,
      observacao: abaixoDoPiso
        ? `A comissão começa a contar a partir de R$ ${emReal(regra.minimumSalesAmount)} vendidos no dia.`
        : null,
    };
  }

  return {
    vendas: vendas.length,
    pecas,
    faturamento: emReal(faturamento),
    ticketMedio: emReal(ticket),
    meta: metaResposta,
    comissao: comissaoResposta,
    semana,
  };
}
