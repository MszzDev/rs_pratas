import { AppError } from "../../core/errors.js";
/**
 * Cliente da API do Mercado Pago.
 *
 * Duas credenciais diferentes, que costumam ser confundidas:
 *
 *   - o ACCESS TOKEN opera a conta (consultar pagamento, estornar). É o que
 *     guardamos cifrado e nunca sai da API.
 *   - a PUBLIC KEY vai para a tela, e só serve para tokenizar cartão no
 *     navegador — não permite mover dinheiro.
 *
 * O client_secret aparece só no OAuth, para trocar código por token. Depois
 * disso ele não é usado em nenhuma chamada do dia a dia.
 */

const BASE = "https://api.mercadopago.com";

export interface MercadoPagoCredentials {
  accessToken: string;
  /** Presentes quando a conexão foi por OAuth. */
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  refreshToken?: string | undefined;
  publicKey?: string | undefined;
}

export interface MercadoPagoPayment {
  id: number;
  status: string;
  status_detail: string;
  transaction_amount: number;
  currency_id: string;
  date_approved: string | null;
  date_created: string;
  payment_method_id: string;
  payment_type_id: string;
  external_reference: string | null;
  payer?: { email?: string | null; first_name?: string | null } | null;
}

/**
 * Estende AppError para a mensagem CHEGAR ao dono.
 *
 * O tratador central so expoe a mensagem de AppError; qualquer outro erro
 * vira "erro interno" generico, por seguranca. So que aqui a mensagem e
 * justamente a informacao util — "o token foi recusado" diz o que fazer, e
 * "erro interno" manda o dono adivinhar.
 */
export class MercadoPagoError extends AppError {
  constructor(status: number, message: string) {
    // 400 e nao 502: quem erra e a credencial que o dono colou, e e ele
    // quem corrige.
    super(400, "INTEGRATION_REJECTED", message);
    this.name = "MercadoPagoError";
  }
}

async function request<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const corpo = await response.text().catch(() => "");

    throw new MercadoPagoError(
      response.status,
      response.status === 401
        ? "O Mercado Pago recusou o token. Verifique se é o access token da aplicação e não a chave pública."
        : `O Mercado Pago respondeu ${response.status}. ${corpo.slice(0, 200)}`,
    );
  }

  return (await response.json()) as T;
}

/** Confirma que o token é válido e diz de qual conta ele é. */
export function getAccount(accessToken: string) {
  return request<{ id: number; nickname: string; email?: string; site_id: string }>(
    accessToken,
    "/users/me",
  );
}

export function getPayment(accessToken: string, paymentId: string | number) {
  return request<MercadoPagoPayment>(accessToken, `/v1/payments/${paymentId}`);
}

/**
 * Estorna um pagamento, total ou parcial.
 *
 * Sem valor, estorna tudo. Com valor, estorna a parte — que é o caso da
 * devolução de uma peça numa compra de várias.
 */
export function refundPayment(accessToken: string, paymentId: string | number, amount?: number) {
  return request<{ id: number; status: string }>(
    accessToken,
    `/v1/payments/${paymentId}/refunds`,
    {
      method: "POST",
      body: JSON.stringify(amount !== undefined ? { amount } : {}),
    },
  );
}

// ------------------------------------------------------------------ Point
//
// A cobrança sai do PDV e aparece na tela da maquininha. O que isso resolve
// não é conforto: é o valor digitado errado. Com o valor indo pelo sistema,
// R$ 189,90 não vira R$ 18,99 na pressa do fim de tarde — e o número do
// pagamento volta sozinho, que é o que faz o estorno e a conferência do caixa
// funcionarem sem ninguém copiar comprovante à mão.

export interface PointDevice {
  id: string;
  pos_id?: number;
  store_id?: string;
  external_pos_id?: string;
  operating_mode?: string;
}

/** As maquininhas Point que existem NESTA conta. */
export async function listPointDevices(accessToken: string) {
  const resposta = await request<{ devices?: PointDevice[] }>(
    accessToken,
    "/point/integration-api/devices",
  );

  return resposta.devices ?? [];
}

/**
 * Manda o valor para a maquininha.
 *
 * `external_reference` leva o código da venda: é por ele que o pagamento que
 * volta do Mercado Pago se reconhece como sendo daquela venda, sem depender de
 * horário nem de valor — dois clientes pagando R$ 200 no mesmo minuto seriam
 * indistinguíveis por qualquer outro critério.
 *
 * O valor vai em CENTAVOS, que é como a API do Point espera. Mandar reais faz
 * a maquininha cobrar cem vezes menos, e a venda fecha como se estivesse certa.
 */
export function createPaymentIntent(
  accessToken: string,
  deviceId: string,
  params: {
    amountCents: number;
    description: string;
    externalReference: string;
    installments?: number;
    /** "credit" | "debit". Ausente: a maquininha pergunta ao cliente. */
    type?: string;
  },
) {
  return request<{ id: string; state: string }>(
    accessToken,
    `/point/integration-api/devices/${deviceId}/payment-intents`,
    {
      method: "POST",
      body: JSON.stringify({
        amount: params.amountCents,
        description: params.description,
        additional_info: { external_reference: params.externalReference, print_on_terminal: true },
        ...(params.type
          ? {
              payment: {
                type: params.type,
                installments: params.installments ?? 1,
                installments_cost: "seller",
              },
            }
          : {}),
      }),
    },
  );
}

/** Em que pé está a cobrança que está na tela da maquininha. */
export function getPaymentIntent(accessToken: string, paymentIntentId: string) {
  return request<{
    id: string;
    state: string;
    payment?: { id?: number; status?: string } | null;
  }>(accessToken, `/point/integration-api/payment-intents/${paymentIntentId}`);
}

/**
 * Cancela a cobrança que está na maquininha.
 *
 * Existe para o caso comum de desistência: o cliente muda de ideia com o valor
 * já na tela do aparelho. Sem isto, a maquininha ficaria presa esperando um
 * cartão que não vem, e a próxima venda não conseguiria usá-la.
 */
export function cancelPaymentIntent(
  accessToken: string,
  deviceId: string,
  paymentIntentId: string,
) {
  return request<{ id: string }>(
    accessToken,
    `/point/integration-api/devices/${deviceId}/payment-intents/${paymentIntentId}`,
    { method: "DELETE" },
  );
}

/**
 * Troca o código do OAuth pelo access token da conta do lojista.
 *
 * É o único momento em que o client_secret é usado. O `redirect_uri` precisa
 * ser IDÊNTICO ao cadastrado na aplicação — divergir uma barra faz o Mercado
 * Pago recusar sem dizer qual é o problema.
 */
export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  const response = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    const corpo = await response.text().catch(() => "");
    throw new MercadoPagoError(
      response.status,
      `Não foi possível concluir a autorização. ${corpo.slice(0, 200)}`,
    );
  }

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    user_id: number;
    public_key?: string;
    expires_in?: number;
  };
}

/** Monta o endereço para o qual o dono é enviado ao clicar em "conectar". */
export function authorizationUrl(params: { clientId: string; redirectUri: string; state: string }) {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: "code",
    platform_id: "mp",
    redirect_uri: params.redirectUri,
    state: params.state,
  });

  return `https://auth.mercadopago.com.br/authorization?${query.toString()}`;
}
