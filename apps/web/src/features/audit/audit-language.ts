/**
 * Auditoria escrita como se conta o que aconteceu.
 *
 * A tela antiga mostrava uma tabela de constantes — `STOCK_ADJUST`, `DENIED` —
 * e quem abria precisava traduzir código de cabeça para descobrir se algo
 * estava errado. Aqui cada registro vira uma frase com sujeito, verbo e
 * complemento, do jeito que a dona contaria: "Juliana ajustou o estoque".
 *
 * Não é enfeite. Auditoria que não se lê não é lida — e um histórico que
 * ninguém lê protege tanto quanto um cofre que ninguém fecha.
 */

/** O verbo de cada evento, na terceira pessoa: o sujeito é quem fez. */
const VERBOS: Record<string, string> = {
  LOGIN_SUCCESS: "entrou no sistema",
  LOGIN_FAILED: "tentou entrar",
  LOGOUT: "saiu do sistema",
  LOGOUT_ALL: "encerrou todas as sessões",
  PASSWORD_CHANGE: "trocou a senha",
  PIN_SET: "criou o PIN",
  PIN_CHANGE: "trocou o PIN",
  FIRST_ACCESS_COMPLETED: "concluiu o primeiro acesso",

  USER_CREATE: "cadastrou um funcionário",
  USER_UPDATE: "alterou um funcionário",
  USER_BLOCK: "bloqueou um funcionário",
  USER_UNBLOCK: "desbloqueou um funcionário",
  USER_PROMOTE_TO_OWNER: "promoveu alguém a dono",
  USER_ROLE_CHANGE: "mudou o perfil de um funcionário",
  PERMISSION_GRANT: "concedeu uma permissão",
  PERMISSION_REVOKE: "tirou uma permissão",
  PERMISSION_DENIED: "tentou fazer algo sem permissão",

  DEVICE_PAIR_INITIATED: "cadastrou um tablet",
  DEVICE_PAIR_CLAIMED: "vinculou um tablet a uma loja",
  DEVICE_UPDATE: "alterou um tablet",
  DEVICE_UNLINK: "desvinculou um tablet",
  DEVICE_BLOCK: "bloqueou um tablet",
  DEVICE_KIOSK_EXIT: "tirou o tablet do modo quiosque",
  TERMINAL_CREATE: "cadastrou uma maquininha",
  TERMINAL_MOVE: "mudou a maquininha de tablet",
  TERMINAL_REPLACE: "trocou uma maquininha",
  TERMINAL_STATUS_CHANGE: "mudou a situação de uma maquininha",

  SESSION_REVOKE: "encerrou uma sessão",
  SESSION_REUSE_DETECTED: "teve a sessão derrubada por reuso de credencial",

  STORE_CREATE: "cadastrou uma loja",
  STORE_UPDATE: "alterou uma loja",
  STORE_DEACTIVATE: "desativou uma loja",
  STORE_OPEN: "abriu a loja",
  STORE_CLOSE: "fechou a loja",

  SALE_COMPLETE: "concluiu uma venda",
  SALE_CANCEL: "cancelou uma venda",
  SALE_DISCOUNT_AUTHORIZED: "autorizou um desconto",
  CASH_OPEN: "abriu o caixa",
  CASH_CLOSE: "fechou o caixa",
  CASH_WITHDRAWAL: "fez uma sangria",
  CASH_SUPPLY: "reforçou o troco",
  REFUND_ISSUED: "devolveu dinheiro ao cliente",
  PRICE_CHANGE: "mudou um preço",

  PRODUCT_CREATE: "cadastrou uma peça",
  PRODUCT_UPDATE: "alterou uma peça",
  PRODUCT_DELETE: "removeu uma peça",
  PRODUCT_IMAGE_SET: "trocou a foto de uma peça",
  STOCK_ADJUST: "ajustou o estoque",
  STOCK_TRANSFER: "transferiu peças entre lojas",
  STOCK_COUNT: "fez uma contagem de estoque",

  DATA_EXPORT: "abriu um documento",
  TIMECLOCK_ENTRY_CREATE: "bateu o ponto",
  TIMECLOCK_CORRECTION: "corrigiu uma marcação de ponto",
  WORK_SCHEDULE_CREATE: "cadastrou uma jornada",
  WORK_SCHEDULE_UPDATE: "alterou uma jornada",

  TWO_FACTOR_SETUP_STARTED: "começou a configurar a verificação em duas etapas",
  TWO_FACTOR_ENABLE: "ativou a verificação em duas etapas",
  TWO_FACTOR_DISABLE: "desativou a verificação em duas etapas",
  TWO_FACTOR_CHALLENGE_FAILED: "errou o código de verificação",
  TWO_FACTOR_RECOVERY_USED: "usou um código de recuperação",
  STEP_UP_ISSUED: "confirmou a identidade",
  STEP_UP_FAILED: "não conseguiu confirmar a identidade",
  SETTING_UPDATE: "mudou uma configuração",
};

/** Nome legível dos campos que aparecem no "antes e depois". */
const CAMPOS: Record<string, string> = {
  name: "nome",
  code: "código",
  salePrice: "preço de venda",
  costPrice: "preço de custo",
  quantity: "quantidade",
  status: "situação",
  role: "perfil",
  email: "e-mail",
  phone: "telefone",
  cnpj: "CNPJ",
  isActive: "ativo",
  isOpen: "aberta",
  storeName: "loja",
  apelido: "apelido",
  contaId: "conta",
  minQuantity: "estoque mínimo",
  reason: "motivo",
  deviceUuid: "aparelho",
  employeeCode: "matrícula",
  openingHours: "horário",
};

export function nomeDoCampo(campo: string): string {
  return CAMPOS[campo] ?? campo;
}

/** Valores como a pessoa lê, não como o JSON guarda. */
export function valorLegivel(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "vazio";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

export interface RegistroDeAuditoria {
  action: string;
  result: "SUCCESS" | "FAILURE" | "DENIED";
  user: { name: string; employeeCode: string } | null;
  reason: string | null;
}

/**
 * A frase de um registro.
 *
 * O resultado entra no verbo, não num rótulo ao lado: "tentou entrar e o
 * sistema recusou" é uma frase; "Tentativa de entrada · Negado" é um formulário.
 */
export function frase(registro: RegistroDeAuditoria): string {
  const quem = registro.user?.name ?? "Alguém";
  const verbo = VERBOS[registro.action] ?? registro.action.toLowerCase().replace(/_/g, " ");

  if (registro.result === "DENIED") {
    return `${quem} ${verbo} — e o sistema não deixou`;
  }

  if (registro.result === "FAILURE") {
    return `${quem} ${verbo} — e não deu certo`;
  }

  return `${quem} ${verbo}`;
}
