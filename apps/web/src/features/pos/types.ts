export interface StockRow {
  id: string;
  storeId: string;
  productId: string;
  variationId: string | null;
  sku: string;
  name: string;
  size: string | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  /** Pode vir null: o servidor mascara valores para o perfil desenvolvedor. */
  salePrice: string | null;
  /** Nulo = sem foto. Também é a chave de cache da imagem. */
  imageChecksum: string | null;
  imageExternalUrl: string | null;
}

export interface CartLine {
  stockItemId: string;
  productId: string;
  variationId: string | null;
  name: string;
  size: string | null;
  sku: string;
  salePrice: string | null;
  imageChecksum: string | null;
  imageExternalUrl: string | null;
  /** Teto do que dá para vender agora — já desconta o que está reservado. */
  available: number;
  quantity: number;
}

export const PAYMENT_METHODS = [
  "DINHEIRO",
  "PIX",
  "DEBITO",
  "CREDITO",
  "CREDITO_PARCELADO",
  "TRANSFERENCIA",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  DEBITO: "Débito",
  CREDITO: "Crédito à vista",
  CREDITO_PARCELADO: "Crédito parcelado",
  TRANSFERENCIA: "Transferência",
};

/** Métodos que passam por maquininha — o servidor recusa sem terminal. */
export const CARD_METHODS: PaymentMethod[] = ["DEBITO", "CREDITO", "CREDITO_PARCELADO"];
