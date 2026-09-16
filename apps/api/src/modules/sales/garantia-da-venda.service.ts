import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";

/**
 * A garantia nasce junto da venda.
 *
 * Antes ela existia, mas só saía se alguém abrisse a tela de pós-venda e
 * emitisse **peça por peça**. No balcão isso nunca acontece: há fila, a peça já
 * está embrulhada e ninguém lembra. O resultado prático era uma loja que promete
 * garantia e não entrega nenhuma — o e-mail de garantia que o sistema já sabia
 * mandar nunca tinha o que mandar.
 *
 * Emitir junto muda quem precisa lembrar: a vendedora não lembra de nada, e a
 * cliente recebe o documento no mesmo minuto da compra, quando ainda associa o
 * e-mail à peça que acabou de levar.
 *
 * ## Fora da transação da venda, de propósito
 *
 * Se a emissão entrasse na mesma transação, um erro aqui desfaria a venda — com
 * o dinheiro já na maquininha e a cliente na porta. A venda é o fato
 * importante; a garantia é consequência dela e pode ser emitida um segundo
 * depois, ou reemitida à mão se algo falhar.
 */

/**
 * O prazo padrão, quando a loja não configurou o seu.
 *
 * Noventa dias é o que o Código de Defesa do Consumidor já garante para produto
 * durável, então prometer menos não teria efeito nenhum e prometer nada seria
 * pior que o silêncio.
 */
const MESES_PADRAO = 3;

const TERMOS_PADRAO =
  "Garantia contra defeito de fabricação. Não cobre mau uso, batidas, contato " +
  "com produtos químicos, nem escurecimento natural da prata, que é reversível " +
  "com limpeza. Apresente este documento e o comprovante de compra.";

async function valorDaConfiguracao(companyId: string, chave: string): Promise<string | null> {
  const guardado = await prisma.appSetting.findFirst({ where: { companyId, key: chave } });
  if (guardado?.value === undefined || guardado.value === null) return null;

  const texto = String(guardado.value).trim();
  return texto.length > 0 ? texto : null;
}

export async function emitirGarantiasDaVenda(params: {
  saleId: string;
  request: FastifyRequest;
}): Promise<number> {
  const { saleId, request } = params;
  const companyId = request.user.companyId;

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId, status: "CONCLUIDA" },
    select: {
      id: true,
      storeId: true,
      completedAt: true,
      createdAt: true,
      items: {
        select: { id: true, warranty: { select: { id: true } } },
      },
    },
  });

  if (!sale) return 0;

  const mesesConfigurados = Number(await valorDaConfiguracao(companyId, "warranty_months"));
  const meses =
    Number.isInteger(mesesConfigurados) && mesesConfigurados > 0 ? mesesConfigurados : MESES_PADRAO;

  /**
   * Zero desliga a emissão automática.
   *
   * Uma loja que não quer prometer garantia precisa de um jeito de dizer isso
   * que não seja "deixe o campo em branco" — branco é indistinguível de
   * "ninguém configurou ainda", e aí o padrão voltaria a valer.
   */
  if (mesesConfigurados === 0) return 0;

  const termos = (await valorDaConfiguracao(companyId, "warranty_terms")) ?? TERMOS_PADRAO;

  // Vale a partir da venda, não da emissão: a garantia é da compra, e não do
  // instante em que o papel foi gerado.
  const startsAt = sale.completedAt ?? sale.createdAt;
  const expiresAt = new Date(startsAt);
  expiresAt.setMonth(expiresAt.getMonth() + meses);

  const semGarantia = sale.items.filter((item) => !item.warranty);
  let emitidas = 0;

  for (const item of semGarantia) {
    /**
     * Uma peça de cada vez, com o código lido na hora.
     *
     * O código vem de uma contagem, e contar antes do laço daria o mesmo número
     * para todas as peças da venda — a chave única barraria da segunda em
     * diante e a cliente sairia com uma garantia só.
     *
     * A falha de uma peça também não derruba as outras: é melhor a cliente
     * ficar com três garantias de quatro e a quarta ser reemitida à mão do que
     * perder as quatro por causa de uma.
     */
    try {
      const quantas = await prisma.warranty.count({ where: { companyId } });

      const warranty = await prisma.warranty.create({
        data: {
          companyId,
          saleItemId: item.id,
          code: `GA${String(quantas + 1).padStart(6, "0")}`,
          months: meses,
          startsAt,
          expiresAt,
          terms: termos,
          createdById: request.user.sub,
        },
      });

      emitidas += 1;

      await audit(request, {
        action: "WARRANTY_ISSUE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId,
        storeId: sale.storeId,
        userRoleSnapshot: request.user.role,
        entityType: "Warranty",
        entityId: warranty.id,
        reason: "emitida junto com a venda",
        newData: { code: warranty.code, months: meses, expiresAt },
      });
    } catch (erro) {
      request.log.warn({ erro, saleItemId: item.id }, "garantia não foi emitida");
    }
  }

  return emitidas;
}
