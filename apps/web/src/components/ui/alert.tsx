import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "error" | "success" | "info";

const TONE_STYLES: Record<Tone, { container: string; icon: ReactNode }> = {
  error: {
    container: "border-danger/30 bg-danger/5 text-danger",
    icon: <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />,
  },
  success: {
    container: "border-success/30 bg-success/5 text-success",
    icon: <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />,
  },
  info: {
    container: "border-info/30 bg-info/5 text-info",
    icon: <Info className="h-5 w-5 shrink-0" aria-hidden />,
  },
};

/**
 * Sempre acompanha ícone e texto — a cor nunca é o único sinal, requisito de
 * acessibilidade para quem não distingue vermelho de verde.
 */
export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  const style = TONE_STYLES[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md border p-4 text-sm", style.container)}
    >
      {style.icon}
      <div className="flex flex-col gap-1">
        {title && <strong className="font-semibold">{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
