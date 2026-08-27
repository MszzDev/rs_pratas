import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AuthenticatedUser, LoginResponse } from "@rs-pratas/shared";
import { apiFetch, clearSession, setAccessToken } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";
import { readRefreshToken, saveRefreshToken } from "@/lib/secure-storage";
import {
  aplicarPreferencias,
  guardarPreferencias,
  PADRAO,
} from "@/features/profile/apply-preferences";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  loginWithPassword: (identifier: string, password: string) => Promise<void>;
  loginWithPin: (deviceId: string, employeeCode: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Marca o segundo fator como resolvido nesta sessão.
   *
   * Sem isso, confirmar o 2FA levava de volta à própria tela de 2FA: o token
   * de acesso continua o mesmo (ele só é reemitido no próximo refresh), então
   * o guarda de rota ainda lia `twoFactorPending` e devolvia o usuário para
   * onde ele acabara de sair.
   */
  markTwoFactorResolved: () => void;
  /**
   * Renova a contagem dos 30 dias depois que o funcionário troca o PIN.
   *
   * Mesma razão do 2FA: o access token atual ainda diz que o PIN venceu, e sem
   * isto a tela de troca mandaria a pessoa de volta para ela mesma.
   */
  markPinChanged: () => void;
  /**
   * Este usuário tem a permissão? Serve para ESCONDER, nunca para liberar.
   *
   * A lista vem do servidor junto com a sessão, já com concessões nominais e
   * DENY resolvidos. Se alguém adulterar isso no navegador, ganha um botão que
   * não funciona: quem autoriza de verdade é a API, requisição por requisição.
   */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(async (session: LoginResponse) => {
    /**
     * Nada da pessoa anterior sobrevive à troca.
     *
     * O tablet do balcão troca de gente várias vezes por dia, e o cache de
     * consultas fica na memória da página — ele não sabe que trocou de
     * usuário. Sem esta limpeza, Carlos entrava com o PIN dele e via, por um
     * instante, "Meus documentos" e "Meu perfil" da Juliana: as chaves são as
     * mesmas para todo mundo, e o dado velho aparece antes de a resposta nova
     * chegar.
     *
     * O servidor nunca entregaria o documento dela a ele — a autorização é por
     * registro e é checada a cada requisição. O vazamento era só na tela, e na
     * tela é onde a pessoa está olhando.
     *
     * Limpa na ENTRADA e na saída: só na saída não bastaria, porque a troca
     * mais comum no balcão é a tela travar e outra pessoa destravar com o PIN
     * dela, sem logout no meio.
     */
    queryClient.clear();

    setAccessToken(session.accessToken);
    await saveRefreshToken(session.refreshToken);
    setUser(session.user);

    // As preferências são da PESSOA, não do aparelho: quem prefere a tela
    // escura prefere em qualquer tablet da rede, e o balcão troca de gente
    // várias vezes por dia. Aplicar no login é o que faz a escolha viajar
    // junto com a matrícula.
    aplicarPreferencias(session.user.preferences);
    guardarPreferencias(session.user.preferences);
  }, []);

  /**
   * Ao sair, a tela volta ao padrão da casa.
   *
   * Sem isto, o tablet ficaria escuro para a próxima pessoa só porque a
   * anterior gostava assim — e a tela de login não pertence a ninguém.
   */
  const limparPreferencias = useCallback(() => {
    aplicarPreferencias(PADRAO);
    guardarPreferencias(PADRAO);
  }, []);

  /**
   * Trava de execução única da restauração.
   *
   * Em desenvolvimento o React monta o efeito duas vezes, e sem esta guarda as
   * duas execuções chamam /auth/refresh com o MESMO token. O servidor rotaciona
   * uma e recusa a outra — comportamento correto dele, mas o app interpretava a
   * recusa como sessão inválida e deslogava o usuário que acabara de entrar.
   */
  const restoreStarted = useRef(false);

  // Retoma a sessão ao abrir o app: o refresh token sobrevive ao recarregamento,
  // o access token (só em memória) não.
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;

    void (async () => {
      try {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) {
          setLoading(false);
          return;
        }

        const session = await apiFetch<LoginResponse>("/api/v1/auth/refresh", {
          method: "POST",
          body: { refreshToken },
          skipAuthRetry: true,
        });
        await applySession(session);
      } catch {
        await clearSession();
      } finally {
        setLoading(false);
      }
    })();
  }, [applySession]);

  const loginWithPassword = useCallback(
    async (identifier: string, password: string) => {
      const session = await apiFetch<LoginResponse>("/api/v1/auth/login/password", {
        method: "POST",
        body: { identifier, password },
        skipAuthRetry: true,
      });
      await applySession(session);
    },
    [applySession],
  );

  const loginWithPin = useCallback(
    async (deviceId: string, employeeCode: string, pin: string) => {
      const session = await apiFetch<LoginResponse>("/api/v1/auth/login/pin", {
        method: "POST",
        body: { deviceId, employeeCode, pin },
        skipAuthRetry: true,
      });
      await applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const refreshToken = await readRefreshToken();
    if (refreshToken) {
      await apiFetch("/api/v1/auth/logout", {
        method: "POST",
        body: { refreshToken },
        skipAuthRetry: true,
      }).catch(() => undefined);
    }
    await clearSession();
    setUser(null);
    limparPreferencias();
    queryClient.clear();
  }, [limparPreferencias]);

  const can = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  const markTwoFactorResolved = useCallback(() => {
    setUser((current) => (current ? { ...current, twoFactorPending: false } : current));
  }, []);

  const markPinChanged = useCallback(() => {
    setUser((current) =>
      current ? { ...current, pinExpired: false, pinExpiresInDays: 30 } : current,
    );
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      loginWithPassword,
      loginWithPin,
      logout,
      markTwoFactorResolved,
      markPinChanged,
      can,
    }),
    [
      user,
      loading,
      loginWithPassword,
      loginWithPin,
      logout,
      markTwoFactorResolved,
      markPinChanged,
      can,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  }
  return context;
}
