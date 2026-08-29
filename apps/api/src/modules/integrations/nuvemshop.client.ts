import { AppError } from "../../core/errors.js";
/**
 * Cliente da API da Nuvemshop.
 *
 * A autenticação é por token permanente obtido uma vez: não há refresh nem
 * expiração, o que simplifica muito em relação ao OAuth do Mercado Pago. O
 * token vai no cabeçalho `Authentication` (sem "Bearer" — a API deles é
 * assim mesmo, e usar Bearer devolve 401 sem explicar por quê).
 *
 * A Nuvemshop exige `User-Agent` identificando a aplicação e um e-mail de
 * contato; requisição sem isso é recusada.
 */

const BASE = "https://api.nuvemshop.com.br/v1";

export interface NuvemshopCredentials {
  storeId: string;
  accessToken: string;
}

export interface NuvemshopProduct {
  id: number;
  name: Record<string, string> | string;
  /** Fotos publicadas na loja virtual, na ordem em que aparecem lá. */
  images?: Array<{ id: number; src: string; position?: number }>;
  variants: Array<{
    id: number;
    sku: string | null;
    price: string | null;
    stock: number | null;
    values?: Array<Record<string, string>>;
  }>;
}

export interface NuvemshopOrder {
  id: number;
  number: number;
  status: string;
  payment_status: string;
  total: string;
  created_at: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  customer?: { name?: string | null; phone?: string | null; email?: string | null } | null;
  products: Array<{
    product_id: number;
    variant_id: number;
    name: string;
    sku: string | null;
    quantity: number;
    price: string;
  }>;

  /**
   * Para onde a compra vai.
   *
   * Vem preenchido nos pedidos com entrega e ausente nos de retirada na loja.
   * Os nomes dos campos sao os da Nuvemshop, em ingles, de proposito: este
   * arquivo e a fronteira com a API deles, e traduzir aqui esconderia de qual
   * campo veio o que — que e justamente o que se precisa saber quando um
   * endereco chega errado.
   */
  shipping_address?: {
    name?: string | null;
    address?: string | null;
    number?: string | null;
    floor?: string | null;
    locality?: string | null;
    city?: string | null;
    province?: string | null;
    zipcode?: string | null;
    country?: string | null;
    phone?: string | null;
  } | null;

  shipping_status?: string | null;
}

/**
 * Estende AppError para a mensagem CHEGAR ao dono.
 *
 * O tratador central so expoe a mensagem de AppError; qualquer outro erro
 * vira "erro interno" generico, por seguranca. So que aqui a mensagem e
 * justamente a informacao util — "o token foi recusado" diz o que fazer, e
 * "erro interno" manda o dono adivinhar.
 */
export class NuvemshopError extends AppError {
  /** O status que a Nuvemshop devolveu, preservado para quem precisa distinguir. */
  readonly upstreamStatus: number;

  constructor(status: number, message: string) {
    // 400 e nao 502: quem erra e a credencial que o dono colou, e e ele
    // quem corrige.
    super(400, "INTEGRATION_REJECTED", message);
    this.name = "NuvemshopError";
    this.upstreamStatus = status;
  }
}

async function request<T>(
  credentials: NuvemshopCredentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE}/${credentials.storeId}${path}`, {
    ...init,
    headers: {
      Authentication: `bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
      // Exigido pela Nuvemshop: sem identificação a requisição é recusada.
      "User-Agent": "RS Pratas ERP (contato@rspratas.com.br)",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const corpo = await response.text().catch(() => "");

    throw new NuvemshopError(
      response.status,
      response.status === 401
        ? "A Nuvemshop recusou o token. Confira se ele foi copiado inteiro e se ainda é válido."
        : `A Nuvemshop respondeu ${response.status}. ${corpo.slice(0, 200)}`,
    );
  }

  // Alguns endpoints (DELETE) devolvem corpo vazio.
  const texto = await response.text();
  return (texto ? JSON.parse(texto) : null) as T;
}

/** Dados da loja — usado para confirmar que o token funciona. */
export function getStore(credentials: NuvemshopCredentials) {
  return request<{ id: number; name: Record<string, string> | string; url?: string }>(
    credentials,
    "/store",
  );
}

/**
 * Uma página do catálogo. Página além da última devolve lista vazia.
 *
 * A Nuvemshop responde 404 quando se pede uma página que não existe — com a
 * mensagem "Last page is 3", que é informação, não erro. Sem tratar isso, a
 * importação percorria tudo certinho e terminava mostrando ao dono um erro
 * vermelho no fim de um trabalho que deu certo.
 */
export async function listProducts(credentials: NuvemshopCredentials, page = 1) {
  try {
    return await request<NuvemshopProduct[]>(credentials, `/products?per_page=200&page=${page}`);
  } catch (erro) {
    if (erro instanceof NuvemshopError && erro.upstreamStatus === 404) {
      return [];
    }
    throw erro;
  }
}

export function listOrders(credentials: NuvemshopCredentials, desde?: Date) {
  const params = new URLSearchParams({ per_page: "50" });
  if (desde) params.set("created_at_min", desde.toISOString());

  return request<NuvemshopOrder[]>(credentials, `/orders?${params.toString()}`);
}

export function getOrder(credentials: NuvemshopCredentials, orderId: number | string) {
  return request<NuvemshopOrder>(credentials, `/orders/${orderId}`);
}

/**
 * Atualiza o estoque de uma variação no site.
 *
 * O corpo manda só o estoque de propósito: um PUT com o produto inteiro
 * sobrescreveria descrição, fotos e preço com o que o ERP tem — e o site tem
 * texto e imagem que o ERP não conhece.
 */
export function updateVariantStock(
  credentials: NuvemshopCredentials,
  productId: number,
  variantId: number,
  stock: number,
) {
  return request<unknown>(credentials, `/products/${productId}/variants/${variantId}`, {
    method: "PUT",
    body: JSON.stringify({ stock }),
  });
}

/** O nome vem como objeto de idiomas ({ pt: "Anel" }) ou string simples. */
export function nomeDe(valor: Record<string, string> | string | undefined): string {
  if (typeof valor === "string") return valor;
  if (!valor) return "";
  return valor.pt ?? valor.es ?? valor.en ?? Object.values(valor)[0] ?? "";
}

/**
 * Troca o codigo da autorizacao pelo token permanente da loja.
 *
 * E aqui que o App ID + chave secreta viram uma credencial utilizavel. O que
 * o painel de desenvolvedor mostra NAO e um token: e o par que identifica o
 * aplicativo. Usa-lo direto na API devolve "Invalid access token", que foi
 * exatamente o que aconteceu na primeira tentativa.
 *
 * A resposta traz o user_id, que E o id da loja para todas as chamadas
 * seguintes — nao ha um campo separado para isso.
 */
export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
}) {
  const response = await fetch("https://www.nuvemshop.com.br/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: "authorization_code",
      code: params.code,
    }),
  });

  const corpo = (await response.json().catch(() => null)) as
    | { access_token?: string; user_id?: number; error?: string; error_description?: string }
    | null;

  if (!response.ok || !corpo?.access_token || !corpo.user_id) {
    throw new NuvemshopError(
      response.status,
      corpo?.error_description ??
        corpo?.error ??
        "A Nuvemshop nao aceitou o codigo de autorizacao. Ele vale uma vez so e expira rapido — refaca a autorizacao.",
    );
  }

  return { accessToken: corpo.access_token, storeId: String(corpo.user_id) };
}

/** Para onde o dono e enviado ao autorizar o aplicativo na loja dele. */
export function authorizationUrl(appId: string): string {
  return `https://www.nuvemshop.com.br/apps/${appId}/authorize`;
}
