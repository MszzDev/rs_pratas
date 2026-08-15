import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Boxes,
  Building2,
  Calculator,
  CalendarClock,
  Clock,
  CreditCard,
  FileCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/auth-context";

type NavSection = "dia-a-dia" | "gestao" | "sistema";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  section: NavSection;
  /** Perfis que enxergam o item. Ausente = todos. */
  roles?: string[];
}

const GESTAO = ["DONO", "GERENTE", "DESENVOLVEDOR"];
const DONO = ["DONO", "DESENVOLVEDOR"];

/**
 * A navegação esconde o que o perfil não usa — conveniência, não segurança.
 * Quem chamar a rota direto continua sendo barrado pelo backend.
 *
 * Três seções em vez de duas: com PDV, estoque, relatórios e configuração na
 * mesma lista, o item que o vendedor abre trinta vezes por dia se perdia entre
 * os que o dono abre uma vez por mês.
 */
const NAV_ITEMS: NavItem[] = [
  { to: "/painel", label: "Painel", icon: LayoutDashboard, section: "dia-a-dia", roles: GESTAO },
  { to: "/venda", label: "Venda", icon: ShoppingCart, section: "dia-a-dia" },
  { to: "/orcamentos", label: "Orçamentos", icon: Calculator, section: "dia-a-dia" },
  { to: "/caixa", label: "Caixa", icon: Wallet, section: "dia-a-dia" },
  { to: "/clientes", label: "Clientes", icon: UserRound, section: "dia-a-dia" },
  { to: "/pos-venda", label: "Pós-venda", icon: RotateCcw, section: "dia-a-dia" },
  { to: "/ponto", label: "Ponto", icon: Clock, section: "dia-a-dia" },
  { to: "/meus-documentos", label: "Meus documentos", icon: FileText, section: "dia-a-dia" },

  { to: "/produtos", label: "Produtos", icon: Package, section: "gestao" },
  { to: "/estoque", label: "Estoque", icon: Boxes, section: "gestao" },
  { to: "/etiquetas", label: "Etiquetas", icon: Tag, section: "gestao", roles: GESTAO },
  { to: "/relatorios", label: "Relatórios", icon: TrendingUp, section: "gestao", roles: GESTAO },
  { to: "/funcionarios", label: "Funcionários", icon: Users, section: "gestao" },
  {
    to: "/documentos",
    label: "Conferir documentos",
    icon: FileCheck,
    section: "gestao",
    roles: GESTAO,
  },
  { to: "/espelho-de-ponto", label: "Espelho de ponto", icon: CalendarClock, section: "gestao" },
  { to: "/jornadas", label: "Jornadas", icon: CalendarClock, section: "gestao", roles: GESTAO },

  { to: "/lojas", label: "Lojas", icon: Building2, section: "sistema", roles: DONO },
  { to: "/tablets", label: "Tablets", icon: Tablet, section: "sistema", roles: GESTAO },
  { to: "/maquininhas", label: "Maquininhas", icon: CreditCard, section: "sistema", roles: GESTAO },
  { to: "/auditoria", label: "Auditoria", icon: ScrollText, section: "sistema", roles: GESTAO },
  { to: "/sessoes", label: "Meus acessos", icon: MonitorSmartphone, section: "sistema" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, section: "sistema", roles: DONO },
];

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
  const { user, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const items = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
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
      <Sidebar items={items} onLogout={() => void logout()} user={user} />

      <MobileBar
        open={drawerOpen}
        onToggle={() => setDrawerOpen((current) => !current)}
        items={items}
        onLogout={() => void logout()}
        user={user}
      />

      <div className="flex-1 lg:min-w-0">
        <main className="mx-auto w-full max-w-[82rem] px-4 py-6 md:px-6 md:py-8">
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

          {children}
        </main>
      </div>
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

function initialsOf(name: string | undefined): string {
  if (!name) return "RS";
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

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
  user: { name: string; role: string } | null;
  onLogout: () => void;
}) {
  return (
    <div className="border-t border-border/70 p-3">
      <div className="mb-2 flex items-center gap-3 rounded-md px-2 py-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-soft text-xs font-semibold text-rose-dark">
          {initialsOf(user?.name)}
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-text-primary">
            {user?.name ?? "Usuário"}
          </p>
          <p className="truncate text-xs font-medium text-text-muted">
            {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
          </p>
        </div>
      </div>

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
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
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
}: {
  items: NavItem[];
  user: { name: string; role: string } | null;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen">
      <div className="flex h-16 items-center border-b border-border/70 px-5">
        <span className="text-lg font-semibold tracking-tight text-rose-primary">RS Pratas</span>
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
}: {
  open: boolean;
  onToggle: () => void;
  items: NavItem[];
  user: { name: string; role: string } | null;
  onLogout: () => void;
}) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-surface lg:hidden">
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

          <span className="shrink-0 text-lg font-semibold text-rose-primary">RS Pratas</span>

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
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  <span className="whitespace-nowrap">{item.label}</span>
                </NavLink>
              ))}
          </nav>
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

          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-lifted">
            <div className="flex h-16 items-center justify-between border-b border-border/70 px-4">
              <span className="text-lg font-semibold text-rose-primary">RS Pratas</span>
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
