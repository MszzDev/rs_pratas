import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  Boxes,
  Calculator,
  Clock,
  CreditCard,
  FileCheck,
  FileText,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
  RotateCcw,
  ScrollText,
  ShoppingCart,
  TrendingUp,
  Settings,
  Tablet,
  Tag,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/auth-context";

type NavSection = "dia-a-dia" | "gestao";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  section: NavSection;
  /** Perfis que enxergam o item. Ausente = todos. */
  roles?: string[];
}

/**
 * A navegação esconde o que o perfil não usa — conveniência, não segurança.
 * Quem chamar a rota direto continua sendo barrado pelo backend.
 *
 * Agrupado em duas seções porque a lista vai crescer bastante com PDV, produtos,
 * estoque e relatórios. Separar o que o vendedor usa todo dia do que só a
 * gestão abre evita que o item mais frequente se perca numa lista longa.
 */
const NAV_ITEMS: NavItem[] = [
  { to: "/venda", label: "Venda", icon: ShoppingCart, section: "dia-a-dia" },
  { to: "/orcamentos", label: "Orçamentos", icon: Calculator, section: "dia-a-dia" },
  { to: "/caixa", label: "Caixa", icon: Wallet, section: "dia-a-dia" },
  { to: "/clientes", label: "Clientes", icon: UserRound, section: "dia-a-dia" },
  { to: "/pos-venda", label: "Pós-venda", icon: RotateCcw, section: "dia-a-dia" },
  { to: "/ponto", label: "Ponto", icon: Clock, section: "dia-a-dia" },
  { to: "/meus-documentos", label: "Meus documentos", icon: FileText, section: "dia-a-dia" },
  { to: "/espelho-de-ponto", label: "Espelho de ponto", icon: CalendarClock, section: "dia-a-dia" },
  { to: "/sessoes", label: "Meus acessos", icon: MonitorSmartphone, section: "dia-a-dia" },

  { to: "/produtos", label: "Produtos", icon: Package, section: "gestao" },
  { to: "/estoque", label: "Estoque", icon: Boxes, section: "gestao" },
  {
    to: "/etiquetas",
    label: "Etiquetas",
    icon: Tag,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  {
    to: "/documentos",
    label: "Conferir documentos",
    icon: FileCheck,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  { to: "/funcionarios", label: "Funcionários", icon: Users, section: "gestao" },
  {
    to: "/lojas",
    label: "Lojas",
    icon: Building2,
    section: "gestao",
    roles: ["DONO", "DESENVOLVEDOR"],
  },
  {
    to: "/tablets",
    label: "Tablets",
    icon: Tablet,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  {
    to: "/jornadas",
    label: "Jornadas",
    icon: CalendarClock,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  {
    to: "/maquininhas",
    label: "Maquininhas",
    icon: CreditCard,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  {
    to: "/relatorios",
    label: "Relatórios",
    icon: TrendingUp,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  {
    to: "/auditoria",
    label: "Auditoria",
    icon: ScrollText,
    section: "gestao",
    roles: ["DONO", "GERENTE", "DESENVOLVEDOR"],
  },
  {
    to: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    section: "gestao",
    roles: ["DONO", "DESENVOLVEDOR"],
  },
];

const SECTION_LABELS: Record<NavSection, string> = {
  "dia-a-dia": "Dia a dia",
  gestao: "Gestão",
};

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
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
      {/*
        Computador: menu lateral fixo.
        Tablet: barra horizontal no topo — o toque alcança melhor o topo que a
        lateral, e a tela ainda comporta os rótulos lado a lado.
        Celular: gaveta atrás do botão de três linhas.
      */}
      <Sidebar items={items} onLogout={() => void logout()} userName={user?.name} />

      <MobileBar
        open={drawerOpen}
        onToggle={() => setDrawerOpen((current) => !current)}
        items={items}
        onLogout={() => void logout()}
        userName={user?.name}
      />

      <div className="flex-1 lg:min-w-0">
        <main className="mx-auto max-w-5xl px-4 py-6 md:py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
              {description && <p className="mt-1 text-text-secondary">{description}</p>}
            </div>
            {actions}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-h-[48px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
    isActive ? "bg-rose-soft text-rose-dark" : "text-text-secondary hover:bg-background-secondary",
  );

/** Lista agrupada, usada no menu lateral e na gaveta do celular. */
function GroupedNav({ items }: { items: NavItem[] }) {
  const sections: NavSection[] = ["dia-a-dia", "gestao"];

  return (
    <nav className="space-y-5" aria-label="Navegação principal">
      {sections.map((section) => {
        const sectionItems = items.filter((item) => item.section === section);
        if (sectionItems.length === 0) return null;

        return (
          <div key={section}>
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {SECTION_LABELS[section]}
            </p>
            <div className="space-y-1">
              {sectionItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={linkClass}>
                  <item.icon className="h-5 w-5 shrink-0" aria-hidden />
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

/** Só no computador (lg em diante). */
function Sidebar({
  items,
  userName,
  onLogout,
}: {
  items: NavItem[];
  userName: string | undefined;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:flex lg:flex-col">
      <div className="border-b border-border px-5 py-5">
        <span className="text-xl font-semibold text-rose-primary">RS Pratas</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <GroupedNav items={items} />
      </div>

      <div className="border-t border-border p-3">
        <p className="px-3 pb-2 text-sm text-text-secondary">{userName}</p>
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-[48px] w-full items-center gap-3 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
        >
          <LogOut className="h-5 w-5" aria-hidden />
          Sair
        </button>
      </div>
    </aside>
  );
}

/** Tablet: abas no topo. Celular: botão de três linhas abrindo a gaveta. */
function MobileBar({
  open,
  onToggle,
  items,
  userName,
  onLogout,
}: {
  open: boolean;
  onToggle: () => void;
  items: NavItem[];
  userName: string | undefined;
  onLogout: () => void;
}) {
  return (
    <>
      <header className="border-b border-border bg-surface lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            className="flex h-12 w-12 items-center justify-center rounded-md text-text-secondary hover:bg-background-secondary md:hidden"
          >
            <Menu className="h-6 w-6" aria-hidden />
          </button>

          <span className="text-lg font-semibold text-rose-primary">RS Pratas</span>

          {/* Tablet mostra as abas direto; celular deixa tudo na gaveta. */}
          <nav className="hidden flex-1 flex-wrap gap-1 md:flex" aria-label="Navegação principal">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                <item.icon className="h-5 w-5 shrink-0" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={onLogout}
            className="ml-auto hidden min-h-[48px] items-center gap-2 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary md:flex"
          >
            <LogOut className="h-5 w-5" aria-hidden />
            Sair
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={onToggle}
            className="absolute inset-0 bg-text-primary/40"
          />

          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-lg font-semibold text-rose-primary">RS Pratas</span>
              <button
                type="button"
                onClick={onToggle}
                aria-label="Fechar menu"
                className="flex h-12 w-12 items-center justify-center rounded-md text-text-secondary"
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <GroupedNav items={items} />
            </div>

            <div className="border-t border-border p-3">
              <p className="px-3 pb-2 text-sm text-text-secondary">{userName}</p>
              <button
                type="button"
                onClick={onLogout}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
              >
                <LogOut className="h-5 w-5" aria-hidden />
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
