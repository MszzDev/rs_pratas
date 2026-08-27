import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Pedido {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
  requestedAt: string;
  /** O que a pessoa perdeu. Sem isto o dono não sabe o que vai liberar. */
  type: "PIN" | "SENHA";
  esperandoHaMinutos: number;
}

interface Liberado {
  employeeCode: string;
  name: string;
  type: "PIN" | "SENHA";
  /** O nome do campo é antigo; hoje carrega o PIN ou a senha temporária. */
  temporaryPin: string;
  aviso: string;
}

function esperaEmTexto(minutos: number): string {
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  return horas === 1 ? "há 1 hora" : `há ${horas} horas`;
}

/**
 * Quem esqueceu o PIN está esperando do outro lado do balcão.
 *
 * A fila aparece dentro de Funcionários porque é lá que quem resolve já está —
 * e some quando está vazia, para não virar mais uma caixa cinza na tela.
 *
 * O PIN temporário aparece UMA vez, para ser dito à pessoa que está ali. Não
 * vai por e-mail nem fica guardado: já nasce vencido, e na primeira entrada o
 * sistema pede que o funcionário escolha o dele.
 */
export function PinResetRequests() {
  const queryClient = useQueryClient();
  const confirmar = useConfirm();

  const [liberado, setLiberado] = useState<Liberado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pedidos = useQuery({
    queryKey: ["pin-reset-requests"],
    queryFn: () => apiFetch<Pedido[]>("/api/v1/auth/pin/reset-requests"),
    refetchInterval: 30_000,
  });

  const aprovar = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Liberado>(`/api/v1/auth/pin/reset-requests/${id}/approve`, { method: "POST" }),
    onSuccess: (resultado) => {
      setErro(null);
      setLiberado(resultado);
      void queryClient.invalidateQueries({ queryKey: ["pin-reset-requests"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível liberar o PIN."),
  });

  const recusar = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch(`/api/v1/auth/pin/reset-requests/${params.id}/reject`, {
        method: "POST",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ["pin-reset-requests"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível recusar."),
  });

  const lista = pedidos.data ?? [];

  if (lista.length === 0 && !liberado && !erro) return null;

  return (
    <section className="mb-6">
      {erro && (
        <div className="mb-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {liberado && (
        <div className="mb-4">
          <Alert
            tone="success"
            title={`${liberado.type === "SENHA" ? "Senha temporária" : "PIN temporário"} de ${liberado.name}`}
          >
            <p>{liberado.aviso}</p>
            {/*
              A senha é longa e a fonte monoespaçada com espaçamento largo
              estouraria a linha; o PIN são seis dígitos e o espaçamento é o
              que os torna legíveis a três metros, para serem ditos em voz alta.
            */}
            <p
              className={
                liberado.type === "SENHA"
                  ? "mt-3 select-all break-all font-mono text-2xl text-text-primary"
                  : "mt-3 font-mono text-3xl tracking-[0.3em] text-text-primary"
              }
            >
              {liberado.temporaryPin}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="mt-3"
              onClick={() => setLiberado(null)}
            >
              Já anotei
            </Button>
          </Alert>
        </div>
      )}

      {lista.length > 0 && (
        <>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-medium text-text-primary">
            <KeyRound className="h-5 w-5 text-gold-dark" aria-hidden />
            {lista.length === 1 ? "Um pedido de credencial" : `${lista.length} pedidos de credencial`}
          </h2>
          <p className="mb-3 text-sm text-text-secondary">
            Confira que é a própria pessoa antes de liberar — a credencial nova entra no lugar da
            antiga.
          </p>

          <ul className="space-y-2">
            {lista.map((pedido) => (
              <li
                key={pedido.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-soft"
              >
                <div>
                  <p className="font-medium text-text-primary">{pedido.name}</p>
                  <p className="text-sm text-text-muted">
                    Matrícula {pedido.employeeCode} · pediu{" "}
                    {pedido.type === "SENHA" ? "senha nova" : "PIN novo"}{" "}
                    {esperaEmTexto(pedido.esperandoHaMinutos)}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={aprovar.isPending}
                    onClick={() => aprovar.mutate(pedido.id)}
                  >
                    {pedido.type === "SENHA" ? "Liberar senha temporária" : "Liberar PIN temporário"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={recusar.isPending}
                    onClick={async () => {
                      const motivo = await confirmar({
                        titulo: `Recusar o pedido de ${pedido.name}?`,
                        descricao:
                          "A pessoa continua sem entrar até resolver de outro jeito. Diga o porquê — ela vai perguntar.",
                        acao: "Recusar",
                        pedirMotivo: true,
                      });

                      if (motivo !== null) recusar.mutate({ id: pedido.id, reason: motivo });
                    }}
                  >
                    Recusar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
