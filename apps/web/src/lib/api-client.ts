import { clearRefreshToken, readRefreshToken, saveRefreshToken } from "./secure-storage";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Erro da API já com a mensagem pronta para exibir. A API sempre devolve texto
 * amigável em português; a tela nunca precisa inventar uma mensagem própria nem
 * mostrar "Erro 500".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Access token vive só em memória — nunca em storage, para reduzir o alcance de um XSS. */
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  await clearRefreshToken();
}

/**
 * Obtém a confirmação de identidade exigida pelas ações sensíveis.
 *
 * O token vale para UMA ação e expira em minutos, então é pedido na hora de
 * agir — nunca guardado para usar depois.
 */
export async function requestStepUpToken(params: {
  purpose: string;
  password?: string;
  totpCode?: string;
}): Promise<string> {
  const result = await apiFetch<{ stepUpToken: string }>("/api/v1/auth/step-up", {
    method: "POST",
    body: params,
  });

  return result.stepUpToken;
}

/**
 * Busca um arquivo protegido e devolve uma URL de objeto para usar em `<img>`.
 *
 * `<img src>` não manda cabeçalho, e a rota da foto exige o token — então o
 * arquivo é buscado por fetch e vira um blob local. Quem chama é responsável
 * por revogar a URL: sem isso o navegador segura cada foto na memória até a
 * aba fechar, e uma lista de duzentas peças rolada duas vezes já pesa.
 */
export async function fetchProtectedObjectUrl(path: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (response.status === 401) {
    const renewed = await refreshAccessToken();
    if (renewed) return fetchProtectedObjectUrl(path);
  }

  if (!response.ok) {
    throw new ApiError(response.status, "IMAGE_FAILED", "Não foi possível carregar a imagem.");
  }

  return URL.createObjectURL(await response.blob());
}

/** Primeira mensagem específica de um erro de validação, se houver. */
function firstValidationMessage(body: ApiErrorBody | null): string | null {
  const issues = (body?.error?.details as { issues?: Array<{ message?: string }> } | undefined)
    ?.issues;

  return issues?.[0]?.message ?? null;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Token de reautenticação para ações sensíveis. */
  stepUpToken?: string;
  skipAuthRetry?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, stepUpToken, skipAuthRetry, headers, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      // Só declara JSON quando há corpo JSON.
      //
      // Sem corpo: o Fastify recusa uma requisição que anuncia
      // application/json e chega vazia, o que quebraria todo POST sem corpo
      // (confirmar 2FA, encerrar sessões, reenviar credenciais).
      //
      // Com FormData: quem define o Content-Type é o navegador, porque ele
      // precisa incluir o `boundary` que separa as partes. Declarar aqui
      // apagaria o boundary e o servidor não conseguiria ler o arquivo.
      ...(body !== undefined && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(stepUpToken ? { "X-Step-Up-Token": stepUpToken } : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });

  // Access token expirado: renova uma vez e repete. Um único refresh em voo
  // atende todas as requisições paralelas — sem isso, dez chamadas simultâneas
  // disparariam dez rotações e a detecção de reuso derrubaria a sessão.
  if (response.status === 401 && !skipAuthRetry) {
    const renewed = await refreshAccessToken();
    if (renewed) {
      return apiFetch<T>(path, { ...options, skipAuthRetry: true });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;

    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? "UNKNOWN",
      // Erro de validação vem com a lista de campos que falharam; usar a
      // mensagem genérica desperdiça isso e deixa a pessoa adivinhando qual
      // dos campos está errado.
      firstValidationMessage(errorBody) ??
        errorBody?.error?.message ??
        "Não foi possível concluir a operação. Tente novamente.",
      errorBody?.error?.details,
    );
  }

  return payload as T;
}

/**
 * Busca um ARQUIVO da API, devolvendo a resposta crua.
 *
 * O `apiFetch` interpreta tudo como JSON, o que não serve aqui: o AFD é texto
 * de posição fixa e os avisos (quantas marcações, quem ficou de fora por não
 * ter CPF) vêm em cabeçalhos que se perderiam. Compartilha com ele o essencial
 * — token, renovação de sessão expirada e tradução do erro.
 */
export async function apiFetchRaw(path: string): Promise<Response> {
  const chamar = () =>
    fetch(`${API_BASE_URL}${path}`, {
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });

  let response = await chamar();

  if (response.status === 401 && (await refreshAccessToken())) {
    response = await chamar();
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null;

    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? "UNKNOWN",
      errorBody?.error?.message ?? "Não foi possível baixar o arquivo.",
    );
  }

  return response;
}

async function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const refreshToken = await readRefreshToken();
      if (!refreshToken) return false;

      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        await clearSession();
        return false;
      }

      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      accessToken = data.accessToken;
      await saveRefreshToken(data.refreshToken);
      return true;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
