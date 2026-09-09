import type { FastifyRequest } from "fastify";

/**
 * Quem está mandando o trabalho: uma pessoa pela tela, ou o próprio relógio.
 *
 * Serviços que só precisavam saber a empresa e quem assinava a ação pediam a
 * requisição inteira do Fastify. Isso os prendia à tela: a rotina automática
 * não tem requisição nenhuma, e a única saída seria fabricar um objeto falso
 * com `user` inventado — que passaria no compilador e mentiria na auditoria,
 * registrando a máquina como se fosse uma pessoa.
 *
 * Com o ator explícito, os dois caminhos entram pela mesma porta e a auditoria
 * conta a verdade: `userId` nulo quer dizer que não foi ninguém, foi a rotina.
 */
export interface Ator {
  companyId: string;
  /** Nulo quando é a rotina automática. */
  userId: string | null;
  role: string | null;
  /** A requisição, quando existe. Só serve para o IP e o log da auditoria. */
  request: FastifyRequest | null;
}

export function atorDaRequisicao(request: FastifyRequest): Ator {
  return {
    companyId: request.user.companyId,
    userId: request.user.sub,
    role: request.user.role,
    request,
  };
}

/** O ator da rotina que roda sozinha. */
export function atorAutomatico(companyId: string): Ator {
  return { companyId, userId: null, role: null, request: null };
}
