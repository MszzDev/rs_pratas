import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * A conta de suporte técnico.
 *
 * Ela não aparece na lista de funcionários de propósito: é manutenção do
 * sistema, não gente que trabalha na loja. Misturada ao quadro, vira uma linha
 * que o dono não reconhece e não sabe se pode apagar.
 *
 * Esconder criou um beco, porém: a conta nasce em primeiro acesso, e a única
 * tela capaz de emitir credencial era justamente a que a omitia. Ela ficava
 * inacessível para sempre — e o suporte não conseguia entrar no dia em que
 * algo quebrasse, que é exatamente o dia em que ele é chamado.
 *
 * Aqui ela tem lugar próprio: fora do quadro de pessoal, dentro do que é
 * configuração, com a única ação que o dono precisa ter sobre ela.
 */

interface ContaDeSuporte {
  name: string;
  employeeCode: string;
  status: string;
  email: string | null;
  lastLoginAt: string | null;
}

const SITUACAO: Record<string, string> = {
  PENDING_FIRST_ACCESS: "Nunca entrou — precisa de credencial",
  ACTIVE: "Ativa",
  BLOCKED: "Bloqueada",
  INACTIVE: "Desativada",
};

const RECADO_DA_ENTREGA: Record<string, string> = {
  ENVIADO: "Enviada também por e-mail. Anote mesmo assim — não aparece de novo.",
  SEM_ENDERECO: "A conta não tem e-mail cadastrado, então nada foi enviado.",
  DESLIGADO: "O envio de e-mail está desligado — nada foi enviado.",
  RECUSADO: "O provedor de e-mail recusou o envio.",
};

export function SupportAccount() {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [credencial, setCredencial] = useState<{
    code: string;
    pin: string;
    password: string;
    entrega: string;
  } | null>(null);

  const conta = useQuery({
    queryKey: ["support-account"],
    queryFn: () => apiFetch<{ conta: ContaDeSuporte | null }>("/api/v1/settings/support-account"),
  });

  const gerar = useMutation({
    mutationFn: () =>
      apiFetch<{
        employeeCode: string;
        temporaryPassword: string;
        temporaryPin: string;
        entregaPorEmail: string;
      }>("/api/v1/settings/support-account/credentials", { method: "POST" }),
    onSuccess: (resultado) => {
      setErro(null);
      setCredencial({
        code: resultado.employeeCode,
        pin: resultado.temporaryPin,
        password: resultado.temporaryPassword,
        entrega: resultado.entregaPorEmail,
      });
      void queryClient.invalidateQueries({ queryKey: ["support-account"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível gerar agora."),
  });

  const dados = conta.data?.conta;
  if (!dados) return null;

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-ocean-soft text-ocean"
            aria-hidden
          >
            <LifeBuoy className="h-5 w-5" />
          </span>

          <div>
            <p className="font-medium text-text-primary">Suporte técnico</p>
            <p className="mt-0.5 text-sm text-text-secondary">
              {dados.name} · matrícula {dados.employeeCode} ·{" "}
              {SITUACAO[dados.status] ?? dados.status}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-text-muted">
              Conta de manutenção do sistema — enxerga todas as lojas, com todo valor em dinheiro
              escondido, e não escreve nada. Fica fora da lista de funcionários porque não é
              alguém que trabalha na loja.
            </p>
          </div>
        </div>

        {/*
          Vale para quem ainda não entrou e para quem esqueceu: gerar credencial
          nova invalida a anterior, então não há como "ressuscitar" uma que
          circulou por aí.
        */}
        <Button type="button" variant="outline" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
          <KeyRound className="h-5 w-5" aria-hidden />
          {gerar.isPending ? "Gerando..." : "Gerar credencial"}
        </Button>
      </div>

      {erro && (
        <div className="mt-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {credencial && (
        <div className="mt-4">
          <Alert tone="success" title="Credencial do suporte técnico">
            <p>
              {RECADO_DA_ENTREGA[credencial.entrega] ?? RECADO_DA_ENTREGA.SEM_ENDERECO} Anote agora:
              a credencial anterior deixou de valer.
            </p>

            <dl className="mt-3 grid gap-2 rounded-md bg-surface p-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-text-secondary">Matrícula</dt>
                <dd className="font-mono text-lg">{credencial.code}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">PIN (tablet)</dt>
                <dd className="font-mono text-lg tracking-widest">{credencial.pin}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">Senha (computador)</dt>
                <dd className="font-mono text-lg">{credencial.password}</dd>
              </div>
            </dl>
          </Alert>
        </div>
      )}
    </section>
  );
}
