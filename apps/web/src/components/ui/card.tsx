import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bloco de conteúdo.
 *
 * Sombra em vez de borda dura: o sistema fica aberto o dia inteiro num tablet,
 * e uma tela riscada de linhas cansa a vista. A borda continua existindo, mas
 * bem clara — ela é o que segura o card quando o monitor tem pouco contraste.
 */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border/70 bg-surface shadow-soft",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

/**
 * Cartão de número — faturamento do dia, peças vendidas, estoque baixo.
 *
 * O número vem grande e sozinho: quem passa os olhos no painel entre um
 * cliente e outro precisa ler em um segundo, não interpretar uma tabela.
 */
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "rose",
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  icon: LucideIcon;
  tone?: "rose" | "success" | "warning" | "info" | "graphite";
}) {
  const tones: Record<string, string> = {
    rose: "bg-rose-soft text-rose-dark",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
    graphite: "bg-text-primary text-white",
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary">{value}</p>
          {hint && <p className="mt-1.5 text-xs font-medium text-text-muted">{hint}</p>}
        </div>
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
            tones[tone],
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </Card>
  );
}

/** Etiqueta curta de estado — em uso, vencida, aguardando. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "rose" | "success" | "warning" | "danger" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-background-secondary text-text-secondary",
    rose: "bg-rose-soft text-rose-dark",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
    info: "bg-info/10 text-info",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
