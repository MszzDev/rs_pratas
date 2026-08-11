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
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(stepUpToken ? { "X-Step-Up-Token": stepUpToken } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
      errorBody?.error?.message ?? "Não foi possível concluir a operação. Tente novamente.",
      errorBody?.error?.details,
    );
  }

  return payload as T;
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
