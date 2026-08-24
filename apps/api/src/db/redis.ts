import { Redis } from "ioredis";
import { env } from "../config/env.js";

/**
 * Redis é OPCIONAL neste sistema.
 *
 * Ele guarda só o cache de permissões: sem ele o RBAC consulta o banco a cada
 * requisição — mais lento, igualmente correto. Por isso a ausência não pode
 * derrubar nada.
 *
 * O cuidado aqui é com o caso "não configurado". Apontar o cliente para o
 * endereço padrão e deixá-lo tentar produz uma enxurrada de
 * `ECONNREFUSED 127.0.0.1:6379` a cada meio segundo, para sempre: o log fica
 * ilegível, e o log é onde se procura a causa quando algo dá errado de
 * verdade. Um serviço opcional não pode sequestrar o diagnóstico dos outros.
 *
 * Sem REDIS_URL configurada, devolvemos um dublê que falha na hora, em
 * silêncio. Quem chama já trata a falha caindo para o banco.
 */

/** Um cliente que não vai a lugar nenhum, para quando não há Redis. */
function clienteAusente(): Redis {
  const recusar = () => Promise.reject(new Error("Redis não configurado."));

  return {
    get: recusar,
    set: recusar,
    del: recusar,
    ping: recusar,
    quit: () => Promise.resolve("OK"),
    on: () => undefined,
  } as unknown as Redis;
}

/**
 * "Configurado" significa apontar para outro lugar que não o padrão local.
 *
 * Em desenvolvimento o padrão É o Redis local, e conectar é o certo. Em
 * produção, encontrar o padrão significa que ninguém informou nada.
 */
const configurado =
  env.NODE_ENV !== "production" || !env.REDIS_URL.includes("127.0.0.1");

export const redis = configurado
  ? new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Desiste depois de algumas tentativas em vez de reconectar para sempre.
      retryStrategy: (tentativas) => (tentativas > 5 ? null : Math.min(tentativas * 200, 2000)),
    })
  : clienteAusente();

// Erro de conexão não pode virar exceção não tratada e derrubar o processo:
// para este sistema, Redis fora do ar é degradação, não indisponibilidade.
redis.on("error", () => undefined);
