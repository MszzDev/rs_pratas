import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { atorAutomatico } from "../../core/ator.js";
import { syncStockToNuvemshop } from "./integrations.service.js";
import { baixarPedidosDaNuvemshop } from "./nuvemshop-orders.service.js";

/**
 * A conversa com a loja virtual acontecendo sozinha.
 *
 * Antes, manter os dois lados em dia dependia de alguém lembrar de clicar em
 * dois botões numa tela de configurações que ninguém abre no dia a dia. O preço
 * do esquecimento não é abstrato: a peça vendida pela internet continua à venda
 * no balcão, e a mesma pulseira é vendida duas vezes.
 *
 * ## A ordem importa
 *
 * Primeiro busca os pedidos, depois publica o estoque. Ao contrário, o sistema
 * publicaria um saldo que ele mesmo está prestes a descobrir que mudou — e o
 * site passaria o intervalo inteiro anunciando peça que já saiu.
 *
 * ## O que NÃO entra aqui
 *
 * Trazer o estoque do site continua sendo um botão, apertado por uma pessoa que
 * viu a lista antes. Aquilo foi o acerto de uma vez só, quando o sistema estava
 * zerado e o site tinha a verdade. Repetindo sozinho, seria o contrário do que
 * o sistema é: toda contagem, toda entrada, todo acerto feito aqui seria
 * desfeito no ciclo seguinte pelo número do site.
 */

/**
 * Trava contra ciclos sobrepostos.
 *
 * Um catálogo grande pode levar mais que o intervalo, e dois ciclos ao mesmo
 * tempo dariam baixa dobrada no mesmo pedido se a idempotência falhasse por um
 * fio. Mais barato não deixar acontecer.
 */
let rodando = false;

export async function rodarUmCiclo(log: FastifyBaseLogger): Promise<void> {
  if (rodando) {
    log.warn("sincronia da nuvemshop ainda rodando, ciclo pulado");
    return;
  }

  rodando = true;

  try {
    /**
     * Uma empresa por vez, e só as que estão de fato ligadas.
     *
     * `storeId` nulo significa que ninguém escolheu qual loja alimenta o site.
     * Nesse estado os dois serviços recusam o trabalho com um erro claro — o
     * que é certo quando uma pessoa clicou, e viraria ruído a cada quinze
     * minutos quando é o relógio.
     */
    const ligadas = await prisma.integration.findMany({
      where: { provider: "NUVEMSHOP", status: "CONECTADA", storeId: { not: null } },
      select: { companyId: true },
    });

    for (const { companyId } of ligadas) {
      const ator = atorAutomatico(companyId);

      // Os dois passos são independentes: um falhar não pode impedir o outro
      // de rodar. Se a publicação quebrar por um produto removido no site, os
      // pedidos do dia ainda precisam baixar o estoque.
      try {
        const pedidos = await baixarPedidosDaNuvemshop({ ator });
        if (pedidos.pedidosNovos > 0) {
          log.info(
            { companyId, ...pedidos },
            "pedidos do site baixados pela rotina automática",
          );
        }
      } catch (error) {
        log.error({ err: error, companyId }, "falha ao buscar pedidos do site");
      }

      try {
        await syncStockToNuvemshop({ ator });
      } catch (error) {
        log.error({ err: error, companyId }, "falha ao publicar o estoque no site");
      }
    }
  } catch (error) {
    // A rotina nunca derruba o processo: o sistema da loja tem que continuar
    // vendendo mesmo com a loja virtual fora do ar.
    log.error({ err: error }, "falha na rotina da nuvemshop");
  } finally {
    rodando = false;
  }
}

export function iniciarRotinaDaNuvemshop(log: FastifyBaseLogger): NodeJS.Timeout | null {
  if (env.NUVEMSHOP_SYNC_MINUTES === 0) {
    log.info("rotina da nuvemshop desligada (NUVEMSHOP_SYNC_MINUTES=0)");
    return null;
  }

  const intervalo = env.NUVEMSHOP_SYNC_MINUTES * 60_000;

  /**
   * Um ciclo logo depois de subir, e não só daqui a quinze minutos.
   *
   * A hospedagem hiberna o serviço quando ninguém usa, então "subir" acontece
   * de manhã, quando a primeira pessoa abre o sistema — que é exatamente
   * quando os pedidos da noite precisam entrar. Esperar o primeiro intervalo
   * deixaria essa janela descoberta todo dia.
   *
   * Os vinte segundos de espera são para o banco terminar de migrar no boot
   * antes de a rotina consultar as integrações.
   */
  const primeiro = setTimeout(() => void rodarUmCiclo(log), 20_000);
  primeiro.unref();

  const timer = setInterval(() => void rodarUmCiclo(log), intervalo);
  // Sem `unref`, o encerramento fica esperando um temporizador que nunca vence.
  timer.unref();

  log.info(
    { minutos: env.NUVEMSHOP_SYNC_MINUTES },
    "rotina da nuvemshop ligada",
  );

  return timer;
}
