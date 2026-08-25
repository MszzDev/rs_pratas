import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Clock,
  CreditCard,
  ListFilter,
  Users,
  Wallet,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch } from "@/lib/api-client";
import { frase, nomeDoCampo, valorLegivel } from "./audit-language";

interface AuditEntry {
  id: string;
  action: string;
  result: "SUCCESS" | "FAILURE" | "DENIED";
  entityType: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
  userRoleSnapshot: string | null;
  user: { name: string; employeeCode: string } | null;
  changes: Array<{ campo: string; de: unknown; para: unknown }>;
}

/**
 * As perguntas que levam alguém à auditoria.
 *
 * Cada aba é uma pergunta real do dia a dia — "mexeram no meu estoque?",
 * "quem deu esse desconto?", "alguém tentou entrar e não conseguiu?" — em vez
 * de um filtro por nome de evento. Ninguém abre esta tela pensando em
 * `STOCK_ADJUST`.
 */
const ABAS = [
  { chave: "", rotulo: "Tudo", icone: ListFilter, dica: "Tudo o que aconteceu, do mais recente." },
  {
    chave: "problemas",
    rotulo: "Deu errado",
    icone: AlertTriangle,
    dica: "Tentativas recusadas pelo sistema: senha errada, falta de permissão, PIN bloqueado.",
  },
  {
    chave: "dinheiro",
    rotulo: "Dinheiro",
    icone: Wallet,
    dica: "Vendas, cancelamentos, descontos, caixa e devoluções.",
  },
  {
    chave: "estoque",
    rotulo: "Estoque",
    icone: Boxes,
    dica: "Peças cadastradas, alteradas, ajustes e transferências entre lojas.",
  },
  {
    chave: "pessoas",
    rotulo: "Pessoas",
    icone: Users,
    dica: "Entradas, saídas, cadastros de funcionário e mudanças de permissão.",
  },
  {
    chave: "aparelhos",
    rotulo: "Tablets",
    icone: CreditCard,
    dica: "Tablets e maquininhas: vínculo, troca e saída do modo quiosque.",
  },
  {
    chave: "ponto",
    rotulo: "Ponto",
    icone: Clock,
    dica: "Marcações, correções e jornadas.",
  },
] as const;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "Hoje", "Ontem" ou a data por extenso — como se fala de um dia. */
function nomeDoDia(iso: string): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);

  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (mesmoDia(data, hoje)) return "Hoje";
  if (mesmoDia(data, ontem)) return "Ontem";

  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/** Agrupa por dia mantendo a ordem que veio (do mais recente). */
function porDia(entries: AuditEntry[]): Array<{ dia: string; registros: AuditEntry[] }> {
  const grupos: Array<{ dia: string; registros: AuditEntry[] }> = [];

  for (const entry of entries) {
    const dia = nomeDoDia(entry.createdAt);
    const ultimo = grupos[grupos.length - 1];

    if (ultimo?.dia === dia) ultimo.registros.push(entry);
    else grupos.push({ dia, registros: [entry] });
  }

  return grupos;
}

export function AuditPage() {
  const [aba, setAba] = useState<string>("");
  const [paginas, setPaginas] = useState<string[]>([]);

  const cursor = paginas[paginas.length - 1];
  const abaAtual = ABAS.find((item) => item.chave === aba) ?? ABAS[0];

  const audit = useQuery({
    queryKey: ["audit", aba, cursor],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      // "Deu errado" é resultado, não assunto: é a única aba que filtra pelo
      // desfecho em vez de pelo tipo de evento.
      if (aba === "problemas") params.set("result", "DENIED");
      else if (aba) params.set("topic", aba);

      return apiFetch<{ entries: AuditEntry[]; nextCursor: string | null }>(
        `/api/v1/audit?${params.toString()}`,
      );
    },
  });

  const grupos = porDia(audit.data?.entries ?? []);

  return (
    <PageShell
      eyebrow="Sistema"
      title="O que aconteceu"
      description="O histórico do sistema, em ordem. Nada aqui pode ser alterado ou apagado — nem por você."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {ABAS.map((item) => (
          <button
            key={item.chave}
            type="button"
            onClick={() => {
              setAba(item.chave);
              setPaginas([]);
            }}
            className={`flex min-h-[40px] items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
              aba === item.chave
                ? "border-rose-primary bg-rose-soft text-rose-dark"
                : "border-border bg-surface text-text-secondary hover:border-rose-light"
            }`}
          >
            <item.icone className="h-4 w-4 shrink-0" aria-hidden />
            {item.rotulo}
          </button>
        ))}
      </div>

      <p className="mb-5 text-sm text-text-muted">{abaAtual.dica}</p>

      {audit.isLoading && <p className="text-text-muted">Carregando...</p>}

      {audit.data?.entries.length === 0 && (
        <Alert tone="info">Nada registrado neste assunto ainda.</Alert>
      )}

      <div className="space-y-6">
        {grupos.map((grupo) => (
          <section key={grupo.dia}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
              {grupo.dia}
            </h2>

            <ul className="overflow-hidden rounded-lg border border-border bg-surface">
              {grupo.registros.map((registro) => (
                <li
                  key={registro.id}
                  className="flex gap-4 border-b border-border/70 px-4 py-3 last:border-0"
                >
                  <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-text-muted">
                    {hora(registro.createdAt)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        registro.result === "SUCCESS"
                          ? "text-text-primary"
                          : "font-medium text-danger"
                      }
                    >
                      {frase(registro)}
                    </p>

                    {registro.reason && (
                      <p className="mt-0.5 text-sm text-text-secondary">{registro.reason}</p>
                    )}

                    {/*
                      O antes e o depois, campo a campo. É a resposta para a
                      pergunta que traz a pessoa até aqui — "quem mudou esse
                      preço?" — e ela não estava na tela antiga.
                    */}
                    {registro.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {registro.changes.map((mudanca) => (
                          <li key={mudanca.campo} className="text-sm text-text-muted">
                            {nomeDoCampo(mudanca.campo)}:{" "}
                            <span className="line-through">{valorLegivel(mudanca.de)}</span>{" "}
                            <span className="text-text-secondary">
                              → {valorLegivel(mudanca.para)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {registro.user && (
                      <p className="mt-0.5 text-xs text-text-muted">
                        {registro.user.employeeCode}
                        {registro.ipAddress ? ` · ${registro.ipAddress}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {audit.data?.nextCursor && (
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() =>
            setPaginas((atual) => [...atual, audit.data.nextCursor as string])
          }
        >
          Ver mais antigos
        </Button>
      )}
    </PageShell>
  );
}
