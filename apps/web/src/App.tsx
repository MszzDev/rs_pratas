import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { installBackgroundPrivacy, installKioskGuards } from "./lib/kiosk";
import { AuthProvider, useAuth } from "./features/auth/auth-context";
import { LoginPage } from "./features/auth/LoginPage";
import { FirstAccessPage } from "./features/auth/FirstAccessPage";
import { PinLoginPage } from "./features/auth/PinLoginPage";
import { TwoFactorSetupPage } from "./features/auth/TwoFactorSetupPage";
import { TimeClockPage } from "./features/timeclock/TimeClockPage";
import { UsersPage } from "./features/users/UsersPage";

/**
 * Guarda de rota — conveniência de navegação, NUNCA controle de acesso.
 * Toda decisão real de permissão é do backend: esconder um botão não impede
 * ninguém de chamar o endpoint direto.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-secondary">
        Carregando...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // O backend recusa todas as outras rotas até o segundo fator ser confirmado.
  // Levar direto à configuração é melhor que deixar o usuário esbarrar num
  // "sem permissão" em cada tela que tentar abrir.
  if (user.twoFactorPending) {
    return <Navigate to="/verificacao-duas-etapas" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pin" element={<PinLoginPage />} />
      <Route path="/primeiro-acesso" element={<FirstAccessPage />} />

      {/* Fora do RequireAuth de propósito: é a única rota que o dono alcança
          enquanto o segundo fator não estiver confirmado. */}
      <Route path="/verificacao-duas-etapas" element={<TwoFactorSetupPage />} />

      <Route
        path="/ponto"
        element={
          <RequireAuth>
            <TimeClockPage />
          </RequireAuth>
        }
      />
      <Route
        path="/funcionarios"
        element={
          <RequireAuth>
            <UsersPage />
          </RequireAuth>
        }
      />

      <Route path="/" element={<Navigate to="/ponto" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const removeKioskGuards = installKioskGuards();
    const removePrivacy = installBackgroundPrivacy(setHidden);

    return () => {
      removeKioskGuards();
      removePrivacy();
    };
  }, []);

  return (
    <AuthProvider>
      <AppRoutes />

      {/*
        Cortina opaca enquanto o app está em segundo plano: o Android fotografa
        a tela para a lista de recentes, e sem isso dados de venda ou de caixa
        ficariam visíveis na miniatura para quem pegasse o tablet.
      */}
      {hidden && (
        <div
          aria-hidden
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
        >
          <span className="text-2xl font-semibold text-rose-primary">RS Pratas</span>
        </div>
      )}
    </AuthProvider>
  );
}
