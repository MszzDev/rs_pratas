import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { installBackgroundPrivacy, installKioskGuards } from "./lib/kiosk";
import { useDeviceRegistration } from "./features/devices/use-device-registration";
import { WaitingForStore } from "./features/devices/WaitingForStore";
import { ChangePinPage } from "./features/auth/ChangePinPage";
import { useShiftGuard } from "./features/timeclock/use-shift-guard";
import { ScreenLock } from "./features/kiosk/ScreenLock";
import { ConfirmProvider } from "./components/ui/confirm-dialog";
import { restaurarBrilho } from "./components/ui/brightness-control";
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
import { CloseDayPage } from "@/features/timeclock/CloseDayPage";
import { CustomerReturnedPage } from "@/features/aftersales/CustomerReturnedPage";
import { AfterSalesPage } from "./features/aftersales/AfterSalesPage";
import { ServiceOrdersPage } from "@/features/aftersales/ServiceOrdersPage";
import { IntegrationsPage } from "@/features/settings/IntegrationsPage";
import { PhoneUploadPage } from "@/features/uploads/PhoneUploadPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { MyDayPage } from "@/features/dashboard/MyDayPage";
import { PainelPage } from "./features/dashboard/PainelPage";

/**
 * Guarda de rota — conveniência de navegação, NUNCA controle de acesso.
 * Toda decisão real de permissão é do backend: esconder um botão não impede
 * ninguém de chamar o endpoint direto.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const turno = useShiftGuard();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-secondary">
        Carregando...
      </div>
    );
  }

  if (!user) {
    // No tablet não existe senha para digitar: a entrada é matrícula e PIN.
    return <Navigate to={Capacitor.isNativePlatform() ? "/pin" : "/login"} replace />;
  }

  // O backend recusa todas as outras rotas até o segundo fator ser confirmado.
  // Levar direto à configuração é melhor que deixar o usuário esbarrar num
  // "sem permissão" em cada tela que tentar abrir.
  if (user.twoFactorPending) {
    return <Navigate to="/verificacao-duas-etapas" replace />;
  }

  // PIN vencido (inclusive o temporário liberado pelo responsável, que já nasce
  // vencido de propósito): a sessão vale, mas a primeira coisa é escolher um
  // PIN novo. Sem isto, o PIN dito em voz alta no balcão valeria trinta dias.
  if (user.pinExpired) {
    return <Navigate to="/trocar-pin" replace />;
  }

  // No tablet, o expediente começa pelo relógio de ponto. Quem chegou e ainda
  // não registrou a entrada é levado para lá antes de qualquer outra tela —
  // não é bloqueio, é a primeira coisa do dia acontecendo na ordem certa.
  if (turno.exigirEntrada && turno.precisaEntrada && location.pathname !== "/ponto") {
    return <Navigate to="/ponto" replace />;
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

      {/*
        Fora do RequireAuth porque quem abre está no PRÓPRIO celular, fora do
        sistema. O que autoriza é o token do endereço, que veio do QR Code na
        tela do tablet — sorteado, de uso único e válido por minutos.
      */}
      <Route path="/enviar/:token" element={<PhoneUploadPage />} />

      {/* Fora do RequireAuth de propósito: é a única rota que o dono alcança
          enquanto o segundo fator não estiver confirmado. */}
      <Route path="/verificacao-duas-etapas" element={<TwoFactorSetupPage />} />

      {/* Fora do RequireAuth pela mesma razão: é para onde quem está com o PIN
          vencido é mandado, e o guarda o devolveria para cá em círculo. */}
      <Route path="/trocar-pin" element={<ChangePinPage />} />

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

      {/*
        O roteiro do fim do turno. Caixa e ponto moravam em telas separadas de
        um menu, e nada avisava que faltou uma — o caixa esquecido aberto trava
        a abertura do dia seguinte.
      */}
      <Route
        path="/fechar-o-dia"
        element={
          <RequireAuth>
            <CloseDayPage />
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
            <PainelPage />
          </RequireAuth>
        }
      />
      {/*
        A tela onde a vendedora vê o próprio número. Sem exigência de perfil:
        a permissão é ser você mesma, e o servidor só devolve o dado de quem
        pediu.
      */}
      {/*
        O perfil de cada funcionário: foto, senha e como ele quer ver o
        sistema. Sem exigência de perfil — é a própria pessoa.
      */}
      <Route
        path="/meu-perfil"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/meu-dia"
        element={
          <RequireAuth>
            <MyDayPage />
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
      {/* Relatórios e comissões viraram abas do Painel: as três respondiam a
          mesma pergunta — como o negócio está indo —, separadas por telas que
          obrigavam a voltar ao menu para comparar o dia com o mês. Os
          endereços antigos continuam levando ao lugar certo. */}
      <Route path="/relatorios" element={<Navigate to="/painel" replace />} />
      {/*
        A porta única de quem chegou com uma peça na mão. Traduz "o que houve"
        para devolução, troca, garantia ou ordem de serviço — a escolha que a
        vendedora tinha de fazer sozinha, e onde errar custava dinheiro.
      */}
      <Route
        path="/cliente-voltou"
        element={
          <RequireAuth>
            <CustomerReturnedPage />
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
        path="/integracoes"
        element={
          <RequireAuth>
            <IntegrationsPage />
          </RequireAuth>
        }
      />
      <Route path="/comissoes" element={<Navigate to="/painel" replace />} />
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

  /**
   * O tablet se apresenta sozinho ao abrir e espera o dono escolher a loja.
   *
   * Enquanto isso não acontece, nem o login aparece: não há loja para vender,
   * caixa para abrir nem ponto para bater. Mostrar a tela de entrada seria
   * oferecer algo que não funciona.
   */
  const registro = useDeviceRegistration();

  useEffect(() => {
    // O brilho escolhido ontem vale hoje: quem ajustou não deve ter que
    // ajustar de novo a cada abertura do aplicativo.
    void restaurarBrilho();

    const removeKioskGuards = installKioskGuards();
    const removePrivacy = installBackgroundPrivacy(setHidden);

    return () => {
      removeKioskGuards();
      removePrivacy();
    };
  }, []);

  if (registro.estado === "verificando") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand">
        <Logo size="lg" />
      </div>
    );
  }

  if (registro.estado === "aguardando") {
    return <WaitingForStore apelido={registro.apelido} />;
  }

  return (
    <AuthProvider>
      <ConfirmProvider>
        <AppRoutes />

        {/*
          Trava a tela depois do tempo configurado sem toque. Fica fora das
          rotas porque não pertence a tela nenhuma: vale para todas.
        */}
        <ScreenLock />

        {/*
          Cortina opaca enquanto o app está em segundo plano: o Android
          fotografa a tela para a lista de recentes, e sem isso dados de venda
          ou de caixa ficariam visíveis na miniatura para quem pegasse o tablet.
        */}
        {hidden && (
          <div
            aria-hidden
            className="fixed inset-0 z-50 flex items-center justify-center bg-background"
          >
            <Logo size="lg" />
          </div>
        )}
      </ConfirmProvider>
    </AuthProvider>
  );
}
