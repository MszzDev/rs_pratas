import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthenticatedUser, LoginResponse } from "@rs-pratas/shared";
import { apiFetch, clearSession, setAccessToken } from "@/lib/api-client";
import { readRefreshToken, saveRefreshToken } from "@/lib/secure-storage";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  loginWithPassword: (identifier: string, password: string) => Promise<void>;
  loginWithPin: (deviceId: string, employeeCode: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(async (session: LoginResponse) => {
    setAccessToken(session.accessToken);
    await saveRefreshToken(session.refreshToken);
    setUser(session.user);
  }, []);

  // Retoma a sessão ao abrir o app: o refresh token sobrevive ao recarregamento,
  // o access token (só em memória) não.
  useEffect(() => {
    void (async () => {
      try {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) return;

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
  }, []);

  const value = useMemo(
    () => ({ user, loading, loginWithPassword, loginWithPin, logout }),
    [user, loading, loginWithPassword, loginWithPin, logout],
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
