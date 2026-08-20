import { PERMISSION_CODES, type PermissionCode } from "./permissions.const.js";
import type { UserRole } from "./roles.const.js";

/**
 * Cadastro é do dono. Só ele.
 *
 * Vendedor e gerente não criam, não editam e não removem registro nenhum —
 * produto, preço, estoque, funcionário, loja, jornada, cliente já cadastrado.
 * O que sobra para eles é o que a loja precisa para funcionar no dia: vender,
 * abrir e fechar o caixa, bater ponto, atender.
 *
 * Isso não é irreversível: o dono concede qualquer código deste catálogo a uma
 * matrícula específica em Funcionários → Permissões, com prazo se quiser, e o
 * ato fica auditado. A regra do cargo é o padrão; a exceção tem nome.
 */
const VENDEDOR_PERMISSIONS: PermissionCode[] = [
  "PRODUCT_VIEW",
  "STOCK_VIEW",
  "SALE_CREATE",
  "CASH_OPEN",
  "CASH_CLOSE",
  // Cadastrar quem está comprando agora faz parte de vender: sem isso a venda
  // sai sem dono e a garantia depois não acha o cliente. Corrigir o cadastro
  // de alguém que já existe, não — isso é edição, e é do dono.
  "CUSTOMER_CREATE",
  "TIMECLOCK_VIEW_OWN",
];

const GERENTE_PERMISSIONS: PermissionCode[] = [
  ...VENDEDOR_PERMISSIONS,
  "USER_VIEW",
  "STORE_VIEW",
  "REPORT_VIEW_STORE",
  "AUDIT_VIEW_STORE",
  "TIMECLOCK_VIEW_STORE",
  // Autorizar desconto, cancelar e estornar não alteram cadastro: são decisões
  // sobre uma venda que está acontecendo no balcão, e ninguém segura o cliente
  // até o dono atender o telefone. Cada uma delas é auditada.
  "SALE_AUTHORIZE_DISCOUNT",
  "SALE_CANCEL",
  "SALE_REFUND",
  // Imprimir etiqueta não muda o que está cadastrado — repõe a etiqueta que
  // caiu da peça.
  "PRODUCT_PRINT_LABEL",
  "LABEL_PRINT",
  "DEVICE_RESTART",
  "TERMINAL_TEST",
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
