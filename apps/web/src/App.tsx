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
import { StoresPage } from "./features/stores/StoresPage";
import { DevicesPage } from "./features/devices/DevicesPage";
import { MyDocumentsPage } from "./features/documents/MyDocumentsPage";
import { ReviewDocumentsPage } from "./features/documents/ReviewDocumentsPage";
import { TimeSheetPage } from "./features/timeclock/TimeSheetPage";
import { AuditPage } from "./features/audit/AuditPage";
import { SessionsPage } from "./features/auth/SessionsPage";
import { SchedulesPage } from "./features/timeclock/SchedulesPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TerminalsPage } from "./features/terminals/TerminalsPage";
import { ProductsPage } from "./features/catalog/ProductsPage";
import { StockPage } from "./features/stock/StockPage";
import { PosPage } from "./features/pos/PosPage";
import { QuotesPage } from "./features/pos/QuotesPage";
import { PieceRequestsPage } from "./features/pos/PieceRequestsPage";
import { CashPage } from "./features/cash/CashPage";
import { CustomersPage } from "./features/customers/CustomersPage";
import { LabelsPage } from "./features/labels/LabelsPage";
import { Logo } from "./components/ui/logo";
import { ReportsPage } from "./features/reports/ReportsPage";
import { AfterSalesPage } from "./features/aftersales/AfterSalesPage";
import { ServiceOrdersPage } from "@/features/aftersales/ServiceOrdersPage";
import { CommissionRulesPage } from "@/features/reports/CommissionRulesPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";

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

/**
 * A raiz depende de quem entrou.
 *
 * O vendedor abre o sistema para vender; o dono, para saber como a rede está.
 * Mandar os dois para a mesma tela obrigaria um deles a navegar toda vez.
 */
function HomeRedirect() {
  const { user } = useAuth();
  const vaiParaPainel = user?.role === "DONO" || user?.role === "GERENTE" || user?.role === "DESENVOLVEDOR";

  return <Navigate to={vaiParaPainel ? "/painel" : "/venda"} replace />;
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
      <Route
        path="/lojas"
        element={
          <RequireAuth>
            <StoresPage />
          </RequireAuth>
        }
      />
      <Route
        path="/meus-documentos"
        element={
          <RequireAuth>
            <MyDocumentsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/documentos"
        element={
          <RequireAuth>
            <ReviewDocumentsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tablets"
        element={
          <RequireAuth>
            <DevicesPage />
          </RequireAuth>
        }
      />

      <Route
        path="/espelho-de-ponto"
        element={
          <RequireAuth>
            <TimeSheetPage />
          </RequireAuth>
        }
      />
      <Route
        path="/auditoria"
        element={
          <RequireAuth>
            <AuditPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sessoes"
        element={
          <RequireAuth>
            <SessionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/jornadas"
        element={
          <RequireAuth>
            <SchedulesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/maquininhas"
        element={
          <RequireAuth>
            <TerminalsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/produtos"
        element={
          <RequireAuth>
            <ProductsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/estoque"
        element={
          <RequireAuth>
            <StockPage />
          </RequireAuth>
        }
      />
      <Route
        path="/painel"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/venda"
        element={
          <RequireAuth>
            <PosPage />
          </RequireAuth>
        }
      />
      <Route
        path="/orcamentos"
        element={
          <RequireAuth>
            <QuotesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/solicitar-peca"
        element={
          <RequireAuth>
            <PieceRequestsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/caixa"
        element={
          <RequireAuth>
            <CashPage />
          </RequireAuth>
        }
      />
      <Route
        path="/clientes"
        element={
          <RequireAuth>
            <CustomersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/etiquetas"
        element={
          <RequireAuth>
            <LabelsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/relatorios"
        element={
          <RequireAuth>
            <ReportsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/pos-venda"
        element={
          <RequireAuth>
            <AfterSalesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/comissoes"
        element={
          <RequireAuth>
            <CommissionRulesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/ordens-de-servico"
        element={
          <RequireAuth>
            <ServiceOrdersPage />
          </RequireAuth>
        }
      />
      <Route
        path="/configuracoes"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />

      <Route path="/" element={<HomeRedirect />} />
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
          <Logo size="lg" />
        </div>
      )}
    </AuthProvider>
  );
}
