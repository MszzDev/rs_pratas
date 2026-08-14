import { pino } from "pino";
import { env } from "../config/env.js";

/**
 * Logger para código que roda fora do ciclo de uma requisição — envio de
 * e-mail, tarefas de fundo. Dentro de uma rota continue usando
 * `request.log`, que carrega o id da requisição.
 */
export const logger = pino({ level: env.LOG_LEVEL });
