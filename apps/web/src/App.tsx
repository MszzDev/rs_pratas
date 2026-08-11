import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./features/auth/auth-context";
import { LoginPage } from "./features/auth/LoginPage";
import { FirstAccessPage } from "./features/auth/FirstAccessPage";
import { PinLoginPage } from "./features/auth/PinLoginPage";
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

  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pin" element={<PinLoginPage />} />
      <Route path="/primeiro-acesso" element={<FirstAccessPage />} />

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
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
