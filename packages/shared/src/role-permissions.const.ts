import { PERMISSION_CODES, type PermissionCode } from "./permissions.const.js";
import type { UserRole } from "./roles.const.js";

const VENDEDOR_PERMISSIONS: PermissionCode[] = [
  "PRODUCT_VIEW",
  "STOCK_VIEW",
  "SALE_CREATE",
  "CASH_OPEN",
  "CASH_CLOSE",
  "CUSTOMER_CREATE",
  "CUSTOMER_EDIT",
  "TIMECLOCK_VIEW_OWN",
];

const GERENTE_PERMISSIONS: PermissionCode[] = [
  ...VENDEDOR_PERMISSIONS,
  "USER_VIEW",
  "STORE_VIEW",
  "REPORT_VIEW_STORE",
  "SALE_AUTHORIZE_DISCOUNT",
  "SALE_CANCEL",
  "SALE_REFUND",
  "STOCK_ADJUST",
  "STOCK_INVENTORY",
  "STOCK_TRANSFER",
  "PRODUCT_CREATE",
  "PRODUCT_EDIT",
  "PRODUCT_PRINT_LABEL",
  "LABEL_PRINT",
  "AUDIT_VIEW_STORE",
  "DEVICE_RESTART",
  "TERMINAL_TEST",
  "TIMECLOCK_VIEW_STORE",
  "TIMECLOCK_CORRECT",
  "TIMECLOCK_MANAGE_SCHEDULE",
  // O gerente consulta a comissao da equipe dele, mas nao define a regra —
  // quem decide quanto se paga de comissao e o dono.
  "COMMISSION_VIEW",
];

/** DONO tem acesso completo — todo o catálogo. */
const DONO_PERMISSIONS: PermissionCode[] = [...PERMISSION_CODES];

/**
 * AUTH_LOGIN_OFF_DEVICE fica de fora de VENDEDOR e GERENTE de propósito.
 *
 * Funcionário entra pelo tablet da loja, ponto. Entrar de casa é exceção, e
 * exceção se concede nominalmente — o dono libera a matrícula específica, com
 * prazo se quiser, e o ato fica auditado. Colocar no perfil transformaria a
 * exceção em regra para todo mundo daquele cargo.
 */

/**
 * DESENVOLVEDOR recebe automaticamente todo código de permissão "de
 * visualização" (contém `VIEW` no nome) — inclusive os que expõem campos
 * monetários, como PRODUCT_VIEW_COST: o dado chega, mas o hook de
 * mascaramento monetário (apps/api core/security/money-mask.hook.ts) troca
 * qualquer valor monetário por null antes da resposta sair. RBAC decide "dá
 * pra acessar este endpoint"; o mascaramento decide "o que vem dentro dele".
 * Nenhum código de escrita/criação/ajuste é concedido aqui — o hook global
 * `block-write-for-developer.hook.ts` também bloqueia por garantia extra.
 */
const DESENVOLVEDOR_PERMISSIONS: PermissionCode[] = PERMISSION_CODES.filter((code) =>
  code.includes("VIEW"),
);

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  VENDEDOR: VENDEDOR_PERMISSIONS,
  GERENTE: GERENTE_PERMISSIONS,
  DONO: DONO_PERMISSIONS,
  DESENVOLVEDOR: DESENVOLVEDOR_PERMISSIONS,
};
