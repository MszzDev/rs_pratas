export interface PermissionDefinition {
  code: string;
  category: string;
  description: string;
}

/**
 * Catálogo completo de permissões granulares (RS Pratas, especificação
 * seção 14) + extensões definidas na Fase 1 (multiloja, ponto oficial,
 * sessão, configurações, 2FA). Nem todo código aqui é aplicado por um
 * módulo já implementado — muitos pertencem a fases futuras (Product,
 * Stock, Sale, Terminal, Integration) mas o catálogo é seedado completo
 * desde já para que RolePermission/UserPermission já tenham o vocabulário
 * final disponível.
 */
export const PERMISSIONS: readonly PermissionDefinition[] = [
  // USER
  { code: "USER_VIEW", category: "USER", description: "Visualizar usuários" },
  { code: "USER_CREATE", category: "USER", description: "Criar usuário" },
  { code: "USER_EDIT", category: "USER", description: "Editar usuário" },
  { code: "USER_DISABLE", category: "USER", description: "Bloquear/desativar usuário" },
  { code: "USER_PROMOTE_OWNER", category: "USER", description: "Promover usuário a dono" },
  { code: "USER_MANAGE_PERMISSIONS", category: "USER", description: "Conceder/revogar permissões granulares" },

  // PRODUCT (fase futura — catálogo seedado desde já)
  { code: "PRODUCT_VIEW", category: "PRODUCT", description: "Visualizar produtos" },
  { code: "PRODUCT_CREATE", category: "PRODUCT", description: "Criar produto" },
  { code: "PRODUCT_EDIT", category: "PRODUCT", description: "Editar produto" },
  { code: "PRODUCT_ARCHIVE", category: "PRODUCT", description: "Arquivar produto" },
  { code: "PRODUCT_VIEW_COST", category: "PRODUCT", description: "Visualizar custo do produto" },
  { code: "PRODUCT_CHANGE_PRICE", category: "PRODUCT", description: "Alterar preço do produto" },
  { code: "PRODUCT_PRINT_LABEL", category: "PRODUCT", description: "Imprimir etiqueta de produto" },

  // STOCK (fase futura)
  { code: "STOCK_VIEW", category: "STOCK", description: "Visualizar estoque" },
  { code: "STOCK_ADJUST", category: "STOCK", description: "Ajustar estoque" },
  { code: "STOCK_TRANSFER", category: "STOCK", description: "Transferir estoque entre lojas" },
  { code: "STOCK_INVENTORY", category: "STOCK", description: "Realizar inventário" },

  // SALE (fase futura)
  { code: "SALE_CREATE", category: "SALE", description: "Criar venda" },
  { code: "SALE_CANCEL", category: "SALE", description: "Cancelar venda" },
  { code: "SALE_REFUND", category: "SALE", description: "Estornar venda" },
  { code: "SALE_APPLY_DISCOUNT", category: "SALE", description: "Aplicar desconto" },
  { code: "SALE_AUTHORIZE_DISCOUNT", category: "SALE", description: "Autorizar desconto de outro vendedor" },

  // CASH (fase futura)
  { code: "CASH_OPEN", category: "CASH", description: "Abrir caixa" },
  { code: "CASH_CLOSE", category: "CASH", description: "Fechar caixa" },
  { code: "CASH_WITHDRAW", category: "CASH", description: "Realizar sangria" },
  { code: "CASH_SUPPLY", category: "CASH", description: "Realizar suprimento de caixa" },

  // CUSTOMER (fase futura)
  { code: "CUSTOMER_CREATE", category: "CUSTOMER", description: "Criar cliente" },
  { code: "CUSTOMER_EDIT", category: "CUSTOMER", description: "Editar cliente" },

  // LABEL (fase futura)
  { code: "LABEL_PRINT", category: "LABEL", description: "Imprimir etiqueta" },
  { code: "LABEL_TEMPLATE_MANAGE", category: "LABEL", description: "Gerenciar modelos de etiqueta" },

  // REPORT (fase futura)
  { code: "REPORT_VIEW_STORE", category: "REPORT", description: "Visualizar relatórios da loja" },
  { code: "REPORT_VIEW_ALL", category: "REPORT", description: "Visualizar relatórios de todas as lojas" },
  { code: "REPORT_EXPORT", category: "REPORT", description: "Exportar relatórios" },

  // COMISSAO / META
  { code: "COMMISSION_VIEW", category: "COMMISSION", description: "Consultar comissões" },
  { code: "COMMISSION_MANAGE", category: "COMMISSION", description: "Definir regras de comissão" },
  { code: "GOAL_MANAGE", category: "COMMISSION", description: "Definir metas de venda" },

  // INTEGRATION (fase futura)
  { code: "INTEGRATION_NUVEMSHOP", category: "INTEGRATION", description: "Configurar integração Nuvemshop" },
  { code: "INTEGRATION_MERCADOPAGO", category: "INTEGRATION", description: "Configurar integração Mercado Pago" },
  { code: "INTEGRATION_REDE", category: "INTEGRATION", description: "Configurar integração Rede/TEF" },

  // DEVICE
  { code: "DEVICE_CREATE", category: "DEVICE", description: "Cadastrar dispositivo/tablet" },
  { code: "DEVICE_EDIT", category: "DEVICE", description: "Editar dispositivo" },
  { code: "DEVICE_MOVE", category: "DEVICE", description: "Mover dispositivo entre lojas" },
  { code: "DEVICE_RESTART", category: "DEVICE", description: "Reiniciar aplicativo remotamente" },
  { code: "DEVICE_EXIT_KIOSK", category: "DEVICE", description: "Sair do modo quiosque" },
  { code: "DEVICE_UNLINK", category: "DEVICE", description: "Desvincular dispositivo" },

  // TERMINAL (fase futura — maquininhas)
  { code: "TERMINAL_CREATE", category: "TERMINAL", description: "Cadastrar maquininha" },
  { code: "TERMINAL_EDIT", category: "TERMINAL", description: "Editar maquininha" },
  { code: "TERMINAL_MOVE", category: "TERMINAL", description: "Mover maquininha" },
  { code: "TERMINAL_REPLACE", category: "TERMINAL", description: "Substituir maquininha" },
  { code: "TERMINAL_DISABLE", category: "TERMINAL", description: "Desativar maquininha" },
  { code: "TERMINAL_TEST", category: "TERMINAL", description: "Testar conexão de maquininha" },

  // STORE / COMPANY
  { code: "STORE_VIEW", category: "STORE", description: "Visualizar lojas" },
  { code: "STORE_CREATE", category: "STORE", description: "Criar loja" },
  { code: "STORE_EDIT", category: "STORE", description: "Editar loja" },
  { code: "STORE_DEACTIVATE", category: "STORE", description: "Desativar loja" },
  { code: "COMPANY_EDIT", category: "STORE", description: "Editar dados da empresa" },

  // TIMECLOCK (novo — ponto oficial)
  { code: "TIMECLOCK_VIEW_OWN", category: "TIMECLOCK", description: "Consultar próprio espelho de ponto" },
  { code: "TIMECLOCK_VIEW_STORE", category: "TIMECLOCK", description: "Consultar ponto da loja" },
  { code: "TIMECLOCK_VIEW_ALL", category: "TIMECLOCK", description: "Consultar ponto de todas as lojas" },
  { code: "TIMECLOCK_CORRECT", category: "TIMECLOCK", description: "Registrar correção de ponto" },
  { code: "TIMECLOCK_MANAGE_SCHEDULE", category: "TIMECLOCK", description: "Gerenciar jornada de trabalho" },

  // SESSION
  { code: "SESSION_VIEW", category: "SESSION", description: "Visualizar sessões ativas" },
  { code: "SESSION_REVOKE", category: "SESSION", description: "Revogar sessão de outro usuário" },

  // SETTINGS
  { code: "SETTINGS_MANAGE_APP", category: "SETTINGS", description: "Gerenciar configurações da empresa" },
  { code: "SETTINGS_MANAGE_STORE", category: "SETTINGS", description: "Gerenciar configurações da loja" },
  { code: "SETTINGS_MANAGE_DEVICE", category: "SETTINGS", description: "Gerenciar configurações do dispositivo" },

  // SECURITY
  { code: "TWO_FACTOR_MANAGE", category: "SECURITY", description: "Gerenciar 2FA de outro usuário" },
  {
    code: "AUTH_LOGIN_OFF_DEVICE",
    category: "SECURITY",
    description: "Entrar fora dos tablets da loja (computador ou celular próprio)",
  },

  // AUDIT
  { code: "AUDIT_VIEW_STORE", category: "AUDIT", description: "Visualizar auditoria da loja" },
  { code: "AUDIT_VIEW_ALL", category: "AUDIT", description: "Visualizar auditoria de todas as lojas" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);
