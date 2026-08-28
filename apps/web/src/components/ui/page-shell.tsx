import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowRightLeft,
  Boxes,
  Building2,
  Calculator,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileCheck,
  FileText,
  HandHeart,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
  Plug,
  RotateCcw,
  ScrollText,
  Settings,
  ShoppingCart,
  Tablet,
  Tag,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/features/auth/auth-context";
import { Logo, LogoMark } from "@/components/ui/logo";
import { StatusStrip } from "@/components/ui/status-strip";
import { PinExpiryNotice } from "@/features/auth/PinExpiryNotice";
import { KioskExitDialog, useKioskExitGesture } from "@/features/kiosk/KioskExit";
import { LeaveWithoutClockOut } from "@/features/timeclock/LeaveWithoutClockOut";
import { useShiftGuard } from "@/features/timeclock/use-shift-guard";

type NavSection = "dia-a-dia" | "gestao" | "sistema";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  section: NavSection;
  /** Perfis que enxergam o item. Ausente = todos. */
  roles?: string[];
  /**
   * Cor da área. O ícone carrega o tom; o texto continua neutro.
   *
   * Serve para achar a tela pela cor antes de ler o nome — depois de uma
   * semana a vendedora vai para o verde sem soletrar "Venda". Uma lista
   * inteira em cinza obriga a ler catorze palavras toda vez.
   */
  tone: string;
}

const GESTAO = ["DONO", "GERENTE", "DESENVOLVEDOR"];
const DONO = ["DONO", "DESENVOLVEDOR"];

/**
 * Só o que se abre por si mesmo.
 *
 * Tudo que é DETALHE de outra tela saiu daqui e virou atalho lá dentro:
 * jornada é assunto de funcionário, espelho de ponto é assunto de ponto,
 * tablet e maquininha são assunto de loja, orçamento e solicitação de peça são
 * abas da venda. Vinte e dois itens numa lista fazem o vendedor procurar;
 * catorze ele decora.
 *
 * A navegação esconde o que o perfil não usa — conveniência, não segurança.
 * Quem chamar a rota direto continua sendo barrado pelo backend.
 */
const NAV_ITEMS: NavItem[] = [
  { to: "/painel", label: "Painel", icon: LayoutDashboard, section: "dia-a-dia", roles: GESTAO, tone: "bg-rose-soft text-rose-primary" },
  { to: "/venda", label: "Venda", icon: ShoppingCart, section: "dia-a-dia", tone: "bg-sage-soft text-sage" },
  // Existe para quem NÃO tem o Painel: antes disto o vendedor não enxergava o
  // próprio resultado e perguntava à gerente, várias vezes por dia.
  { to: "/meu-dia", label: "Meu dia", icon: TrendingUp, section: "dia-a-dia", tone: "bg-sage-soft text-sage" },
  { to: "/caixa", label: "Caixa", icon: Wallet, section: "dia-a-dia", tone: "bg-gold-soft text-gold-dark" },
  { to: "/clientes", label: "Clientes", icon: UserRound, section: "dia-a-dia", tone: "bg-plum-soft text-plum" },
  // A entrada é a triagem, não a tela técnica: quem está no balcão sabe o que
  // o cliente disse, não se aquilo é devolução, troca ou garantia.
  { to: "/cliente-voltou", label: "Cliente voltou", icon: RotateCcw, section: "dia-a-dia", tone: "bg-clay-soft text-clay" },
  { to: "/ponto", label: "Ponto", icon: Clock, section: "dia-a-dia", tone: "bg-ocean-soft text-ocean" },

  { to: "/produtos", label: "Produtos", icon: Package, section: "gestao", tone: "bg-rose-soft text-rose-primary" },
  { to: "/estoque", label: "Estoque", icon: Boxes, section: "gestao", tone: "bg-ocean-soft text-ocean" },
  { to: "/etiquetas", label: "Etiquetas", icon: Tag, section: "gestao", roles: GESTAO, tone: "bg-gold-soft text-gold-dark" },
  // Quem trabalha no balcão não precisa da lista de colegas: matrícula, perfil
  // e situação de cada um são assunto de quem administra.
  { to: "/funcionarios", label: "Funcionários", icon: Users, section: "gestao", roles: GESTAO, tone: "bg-plum-soft text-plum" },

  { to: "/lojas", label: "Lojas", icon: Building2, section: "sistema", roles: DONO, tone: "bg-clay-soft text-clay" },
  { to: "/auditoria", label: "Auditoria", icon: ScrollText, section: "sistema", roles: GESTAO, tone: "bg-ocean-soft text-ocean" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, section: "sistema", roles: DONO, tone: "bg-rose-soft text-rose-primary" },
];

/**
 * Atalhos que cada tela oferece para as suas telas-filhas.
 *
 * Aparecem no topo da tela-mãe, onde a pessoa já está quando precisa deles —
 * em vez de exigirem uma volta ao menu. É por isso que o mapa é recíproco:
 * de Produtos se chega a Estoque, e de Estoque se volta a Produtos.
 */
interface Atalho {
  to: string;
  label: string;
  icon: typeof Users;
  /** Sem esta permissão o atalho não aparece — a tela devolveria 403. */
  permission?: string;
}

const SUBPAGINAS: Record<string, Atalho[]> = {
  "/configuracoes": [
    { to: "/integracoes", label: "Integrações", icon: Plug, permission: "SETTINGS_MANAGE_APP" },
  ],
  "/integracoes": [{ to: "/configuracoes", label: "Configurações", icon: Settings }],
  "/cliente-voltou": [
    { to: "/pos-venda", label: "Trocas e garantias", icon: RotateCcw },
    { to: "/ordens-de-servico", label: "Ordens de serviço", icon: Wrench },
  ],
  "/pos-venda": [
    { to: "/cliente-voltou", label: "Cliente voltou", icon: RotateCcw },
    { to: "/ordens-de-servico", label: "Ordens de serviço", icon: Wrench },
    { to: "/venda", label: "Venda", icon: ShoppingCart },
  ],
  "/ordens-de-servico": [
    { to: "/cliente-voltou", label: "Cliente voltou", icon: RotateCcw },
    { to: "/pos-venda", label: "Trocas e garantias", icon: RotateCcw },
    { to: "/clientes", label: "Clientes", icon: UserRound },
  ],
  "/venda": [
    { to: "/orcamentos", label: "Orçamentos", icon: Calculator },
    { to: "/solicitar-peca", label: "Solicitar peça", icon: HandHeart },
  ],
  "/orcamentos": [
    { to: "/venda", label: "Venda", icon: ShoppingCart },
    { to: "/solicitar-peca", label: "Solicitar peça", icon: HandHeart },
  ],
  "/solicitar-peca": [
    { to: "/venda", label: "Venda", icon: ShoppingCart },
    { to: "/orcamentos", label: "Orçamentos", icon: Calculator },
  ],
  "/fechar-o-dia": [
    { to: "/caixa", label: "Caixa", icon: Wallet },
    { to: "/ponto", label: "Bater ponto", icon: Clock },
  ],
  "/ponto": [
    { to: "/fechar-o-dia", label: "Fechar o dia", icon: Check },
    { to: "/meu-perfil", label: "Meu perfil", icon: UserRound },
    { to: "/espelho-de-ponto", label: "Meu espelho", icon: CalendarClock },
    { to: "/meus-documentos", label: "Meus documentos", icon: FileText },
    { to: "/sessoes", label: "Meus acessos", icon: MonitorSmartphone },
  ],
  "/espelho-de-ponto": [
    { to: "/ponto", label: "Bater ponto", icon: Clock },
    {
      to: "/jornadas",
      label: "Jornadas",
      icon: CalendarClock,
      permission: "TIMECLOCK_VIEW_STORE",
    },
  ],
  "/meus-documentos": [{ to: "/ponto", label: "Ponto", icon: Clock }],
  "/sessoes": [{ to: "/ponto", label: "Ponto", icon: Clock }],
  "/funcionarios": [
    { to: "/jornadas", label: "Jornadas", icon: CalendarClock, permission: "TIMECLOCK_VIEW_STORE" },
    { to: "/documentos", label: "Conferir documentos", icon: FileCheck, permission: "USER_EDIT" },
    { to: "/espelho-de-ponto", label: "Espelho de ponto", icon: CalendarClock },
  ],
  "/jornadas": [{ to: "/funcionarios", label: "Funcionários", icon: Users }],
  "/documentos": [{ to: "/funcionarios", label: "Funcionários", icon: Users }],
  "/lojas": [
    { to: "/tablets", label: "Tablets", icon: Tablet },
    { to: "/maquininhas", label: "Maquininhas", icon: CreditCard },
  ],
  "/tablets": [
    { to: "/lojas", label: "Lojas", icon: Building2 },
    { to: "/maquininhas", label: "Maquininhas", icon: CreditCard },
  ],
  "/maquininhas": [
    { to: "/lojas", label: "Lojas", icon: Building2 },
    { to: "/tablets", label: "Tablets", icon: Tablet },
  ],
  "/produtos": [
    { to: "/estoque", label: "Estoque", icon: Boxes },
    { to: "/etiquetas", label: "Etiquetas", icon: Tag, permission: "LABEL_PRINT" },
  ],
  "/estoque": [
    { to: "/produtos", label: "Produtos", icon: Package },
    { to: "/contagem", label: "Contagem", icon: ClipboardCheck, permission: "STOCK_INVENTORY" },
    {
      to: "/transferencias",
      label: "Transferências",
      icon: ArrowRightLeft,
      permission: "STOCK_TRANSFER",
    },
    { to: "/etiquetas", label: "Etiquetas", icon: Tag, permission: "LABEL_PRINT" },
  ],
  "/contagem": [
    { to: "/estoque", label: "Estoque", icon: Boxes },
    {
      to: "/transferencias",
      label: "Transferências",
      icon: ArrowRightLeft,
      permission: "STOCK_TRANSFER",
    },
  ],
  "/transferencias": [
    { to: "/estoque", label: "Estoque", icon: Boxes },
    { to: "/contagem", label: "Contagem", icon: ClipboardCheck, permission: "STOCK_INVENTORY" },
  ],
  "/etiquetas": [
    { to: "/produtos", label: "Produtos", icon: Package },
    { to: "/estoque", label: "Estoque", icon: Boxes },
  ],
};

const SECTION_LABELS: Record<NavSection, string> = {
  "dia-a-dia": "Dia a dia",
  gestao: "Gestão",
  sistema: "Sistema",
};

const ROLE_LABELS: Record<string, string> = {
  DONO: "Dono",
  GERENTE: "Gerente",
  VENDEDOR: "Vendedor",
  DESENVOLVEDOR: "Suporte técnico",
};

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sair do sistema em turno aberto passa por uma pergunta: quem vai embora
  // sem bater a saída deixa um buraco no espelho de ponto que ninguém
  // consegue reconstruir depois.
  const turno = useShiftGuard();
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);

  const sair = () => {
    if (turno.turnoAberto) {
      setConfirmandoSaida(true);
      return;
    }
    void logout();
  };

  const items = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );

  // Cinco toques na logo abrem a saida do quiosque. Sem botao visivel: um
  // botao "sair" na tela de um caixa e um convite.
  const quiosque = useKioskExitGesture();

  const atalhos = (SUBPAGINAS[location.pathname] ?? []).filter(
    (atalho) => !atalho.permission || can(atalho.permission),
  );

  // Fecha ao navegar: sem isso o menu fica por cima da tela que acabou de abrir.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // Esc fecha o menu — quem abriu sem querer precisa de saída sem mirar no X.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-background-secondary lg:flex">
      <Sidebar
        items={items}
        onLogout={sair}
        user={user}
        onLogoTap={quiosque.registrarToque}
      />

      <MobileBar
        open={drawerOpen}
        onToggle={() => setDrawerOpen((current) => !current)}
        items={items}
        onLogout={sair}
        user={user}
        onLogoTap={quiosque.registrarToque}
      />

      {/*
        Pular para o conteúdo.
        Invisível até receber o foco do teclado. Sem ele, quem navega por Tab —
        por deficiência motora, ou só porque o balcão é mais rápido sem mouse —
        atravessa o menu inteiro a cada tela antes de chegar no que interessa.
      */}
      <a
        href="#conteudo"
        className="sr-only rounded-md bg-rose-primary px-4 py-2 font-semibold text-rose-contraste focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Pular para o conteúdo
      </a>

      <div className="flex-1 lg:min-w-0">
        <main
          id="conteudo"
          tabIndex={-1}
          className="mx-auto w-full max-w-[82rem] px-4 py-6 focus:outline-none md:px-6 md:py-8"
        >
          <PinExpiryNotice />

          {/*
            No computador a entrada é lembrada, não exigida: o gerente que abre
            o sistema em casa às dez da noite não está começando um turno.
          */}
          {turno.precisaEntrada && !turno.exigirEntrada && location.pathname !== "/ponto" && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-ocean/30 bg-ocean-soft/40 p-4 text-sm">
              <Clock className="h-5 w-5 shrink-0 text-ocean" aria-hidden />
              <p className="flex-1 text-text-primary">
                <strong className="font-semibold">Você ainda não bateu o ponto hoje.</strong> A
                entrada e a saída são obrigatórias.
              </p>
              <NavLink
                to="/ponto"
                className="flex min-h-[40px] items-center rounded-md bg-ocean px-4 font-medium text-contraste"
              >
                Bater ponto
              </NavLink>
            </div>
          )}

          <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-primary">
                  {eyebrow}
                </p>
              )}
              <h1 className="mt-1 text-2xl font-semibold text-text-primary">{title}</h1>
              {description && (
                <p className="mt-1 max-w-3xl text-sm text-text-secondary">{description}</p>
              )}
            </div>
            {actions && (
              <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                {actions}
              </div>
            )}
          </header>

          {/* Atalhos para as telas-filhas desta, onde a pessoa já está. */}
          {atalhos.length > 0 && (
            <nav
              className="mb-6 flex flex-wrap gap-2 border-b border-border/70 pb-4"
              aria-label="Telas relacionadas"
            >
              {atalhos.map((atalho) => (
                <NavLink
                  key={atalho.to}
                  to={atalho.to}
                  className="flex min-h-[38px] items-center gap-2 rounded-full border border-border/70 bg-surface px-3.5 text-sm font-medium text-text-secondary transition-colors hover:border-rose-primary hover:text-rose-dark"
                >
                  <atalho.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {atalho.label}
                </NavLink>
              ))}
            </nav>
          )}

          {children}
        </main>
      </div>

      {quiosque.aberto && <KioskExitDialog onClose={quiosque.fechar} />}

      {confirmandoSaida && (
        <LeaveWithoutClockOut
          diaCurto={turno.diaCurto}
          onCancelar={() => setConfirmandoSaida(false)}
          onSairMesmoAssim={() => {
            setConfirmandoSaida(false);
            void logout();
          }}
        />
      )}
    </div>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
    isActive
      ? "bg-rose-soft text-rose-dark"
      : "text-text-secondary hover:bg-background-secondary hover:text-text-primary",
  );

/**
 * Rodapé com quem está logado.
 *
 * Num tablet compartilhado, saber de cara em qual conta se está evita a venda
 * lançada no nome de quem saiu para o almoço.
 */

function UserFooter({
  user,
  onLogout,
}: {
  user: { id: string; name: string; role: string } | null;
  onLogout: () => void;
}) {
  return (
    <div className="border-t border-border/70 p-3">
      {/*
        O próprio nome é onde a pessoa procura pelas próprias coisas — foto,
        senha, tamanho da letra. Escondido no menu, o perfil não seria achado
        por quem mais precisa dele.
      */}
      <NavLink
        to="/meu-perfil"
        className={({ isActive }) =>
          cn(
            "mb-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors",
            isActive ? "bg-rose-soft" : "hover:bg-background-secondary",
          )
        }
      >
        <Avatar userId={user?.id} nome={user?.name} className="h-9 w-9 text-xs" />

        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-text-primary">
            {user?.name ?? "Usuário"}
          </p>
          <p className="truncate text-xs font-medium text-text-muted">
            {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
          </p>
        </div>
      </NavLink>

      <button
        type="button"
        onClick={onLogout}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
      >
        <LogOut className="h-5 w-5" aria-hidden />
        Sair
      </button>
    </div>
  );
}

function GroupedNav({ items }: { items: NavItem[] }) {
  const sections: NavSection[] = ["dia-a-dia", "gestao", "sistema"];

  return (
    <nav className="space-y-5" aria-label="Navegação principal">
      {sections.map((section) => {
        const sectionItems = items.filter((item) => item.section === section);
        if (sectionItems.length === 0) return null;

        return (
          <div key={section}>
            <p className="mb-1 px-3 text-[0.68rem] font-semibold uppercase tracking-wider text-text-muted">
              {SECTION_LABELS[section]}
            </p>
            <div className="space-y-0.5">
              {sectionItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={linkClass}>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${item.tone}`}
                    aria-hidden
                  >
                    <item.icon className="h-[17px] w-[17px]" />
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Computador: menu lateral fixo, acompanhando a rolagem. */
function Sidebar({
  items,
  user,
  onLogout,
  onLogoTap,
}: {
  items: NavItem[];
  user: { id: string; name: string; role: string } | null;
  onLogout: () => void;
  /** Conta os toques na logo — cinco abrem a saída do quiosque. */
  onLogoTap: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 bg-brand lg:sticky lg:top-0 lg:flex lg:h-screen">
      {/*
        Empilhados, e não lado a lado.
        Com a logo no tamanho certo, ela e o relógio não cabem juntos numa
        barra de 240 pixels — e o que cedia era a logo, espremida até virar uma
        tira. Em duas linhas cada um tem a largura inteira.
      */}
      <div className="flex min-h-[4.5rem] flex-col items-center gap-2 border-b border-border/70 px-4 py-3">
        <button type="button" onClick={onLogoTap} aria-label="RS Pratas">
          <Logo size="md" />
        </button>

        {/* Hora e bateria: no tablet a barra do Android está desligada, e é
            daqui que a pessoa tira as duas informações. */}
        <StatusStrip className="text-xs" />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <GroupedNav items={items} />
      </div>

      <UserFooter user={user} onLogout={onLogout} />
    </aside>
  );
}

/** Tablet: abas do dia a dia no topo. Celular: gaveta atrás das três linhas. */
function MobileBar({
  open,
  onToggle,
  items,
  user,
  onLogout,
  onLogoTap,
}: {
  open: boolean;
  onToggle: () => void;
  items: NavItem[];
  user: { id: string; name: string; role: string } | null;
  onLogout: () => void;
  /** Conta os toques na logo — cinco abrem a saída do quiosque. */
  onLogoTap: () => void;
}) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-brand lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-background-secondary"
          >
            <Menu className="h-6 w-6" aria-hidden />
          </button>

          <button type="button" onClick={onLogoTap} aria-label="RS Pratas">
            <LogoMark className="h-11 w-11 sm:h-14 sm:w-14" />
          </button>

          {/*
            No tablet as abas do dia a dia ficam à mão — é o que o vendedor usa
            o tempo todo. O resto continua na gaveta.
          */}
          <nav
            className="hidden flex-1 gap-1 overflow-x-auto md:flex"
            aria-label="Atalhos do dia a dia"
          >
            {items
              .filter((item) => item.section === "dia-a-dia")
              .map((item) => (
                <NavLink key={item.to} to={item.to} className={linkClass}>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${item.tone}`}
                    aria-hidden
                  >
                    <item.icon className="h-[17px] w-[17px]" />
                  </span>
                  <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
              ))}
          </nav>

          <StatusStrip className="ml-auto shrink-0 text-xs" />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={onToggle}
            className="absolute inset-0 bg-text-primary/40"
          />

          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-brand shadow-lifted">
            <div className="flex h-[4.5rem] items-center justify-between border-b border-border/70 px-4">
              <Logo size="sm" />
              <button
                type="button"
                onClick={onToggle}
                aria-label="Fechar menu"
                className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary"
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <GroupedNav items={items} />
            </div>

            <UserFooter user={user} onLogout={onLogout} />
          </div>
        </div>
      )}
    </>
  );
}
