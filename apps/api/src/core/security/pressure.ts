import type { FastifyRequest } from "fastify";

/**
 * Rotas que respondem mesmo com o servidor sob pressão.
 *
 * O health check é a pergunta "você está de pé?". Responder 503 estando de pé
 * faz a hospedagem concluir que o serviço morreu e reiniciar — o que aumenta a
 * pressão que causou o 503. O serviço entra em laço de reinício, e o sintoma
 * na loja é o sistema que "cai sozinho" em horário de movimento.
 *
 * Aconteceu no boot deste servidor: o medidor de atraso do laço de eventos
 * nasce carregando o pico da própria subida do processo, e as duas primeiras
 * batidas do Render voltaram 503 enquanto o servidor já respondia. Daquela vez
 * ele subiu. Numa partida mais lenta — banco frio, migração maior — não
 * subiria.
 *
 * Recusar as OUTRAS rotas sob pressão continua certo: é o que impede a fila de
 * crescer até o processo cair de vez.
 */
const SEMPRE_RESPONDEM = new Set(["/health"]);

/**
 * Decide se a requisição escapa da recusa por pressão.
 *
 * Separado da montagem do servidor para poder ser testado: o custo de errar
 * isto não aparece em desenvolvimento, só em produção e em forma de reinício
 * em laço.
 */
export function escapaDaPressao(request: Pick<FastifyRequest, "url">): boolean {
  // A URL pode vir com query string; o que importa é o caminho.
  const caminho = request.url.split("?")[0] ?? request.url;
  return SEMPRE_RESPONDEM.has(caminho);
}
