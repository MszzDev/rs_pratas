import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Building2, Clock, LogOut, Tablet, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/auth-context";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  /** Perfis que enxergam o item. Vazio = todos. */
  roles?: string[];
}

/**
 * A navegação esconde o que o perfil não usa — conveniência, não segurança.
 * Quem chamar a rota direto continua sendo barrado pelo backend.
 */
const NAV_ITEMS: NavItem[] = [
  { to: "/ponto", label: "Ponto", icon: Clock },
  { to: "/funcionarios", label: "Funcionários", icon: Users },
  { to: "/lojas", label: "Lojas", icon: Building2, roles: ["DONO", "DESENVOLVEDOR"] },
  { to: "/tablets", label: "Tablets", icon: Tablet, roles: ["DONO", "GERENTE", "DESENVOLVEDOR"] },
];

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

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );

  return (
    <div className="min-h-screen bg-background-secondary">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-lg font-semibold text-rose-primary">RS Pratas</span>

          <nav className="flex flex-1 flex-wrap gap-1" aria-label="Navegação principal">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-rose-soft text-rose-dark"
                      : "text-text-secondary hover:bg-background-secondary",
                  )
                }
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-text-secondary">{user?.name}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
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
  );
}
