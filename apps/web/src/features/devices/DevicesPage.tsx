import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "../auth/auth-context";
import { PendingDevices } from "./PendingDevices";

interface Store {
  id: string;
  code: string;
  name: string;
}

interface CashRegister {
  id: string;
  code: string;
  name: string;
}

interface POSStation {
  id: string;
  code: string;
  name: string;
  cashRegisters: CashRegister[];
}

interface Device {
  id: string;
  name: string;
  status: string;
  storeId: string;
  cashRegisterId: string;
  model: string | null;
  lastSeenAt: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Aguardando pareamento",
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
  UNLINKED: "Desvinculado",
  RETIRED: "Aposentado",
};

export function DevicesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.role === "DONO";

  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/api/v1/stores"),
  });

  // Assim que as lojas chegam, seleciona a primeira — evita a tela vazia sem
  // motivo aparente quando existe só uma loja.
  const selectedStoreId = storeId || stores.data?.[0]?.id || "";

  const stations = useQuery({
    queryKey: ["pos-stations", selectedStoreId],
    queryFn: () => apiFetch<POSStation[]>(`/api/v1/pos-stations?storeId=${selectedStoreId}`),
    enabled: Boolean(selectedStoreId),
  });

  const devices = useQuery({
    queryKey: ["devices", selectedStoreId],
    queryFn: () => apiFetch<Device[]>(`/api/v1/devices?storeId=${selectedStoreId}`),
    enabled: Boolean(selectedStoreId),
  });

  function handleError(caught: unknown, fallback: string) {
    setError(caught instanceof ApiError ? caught.message : fallback);
  }

  const createStation = useMutation({
    mutationFn: (input: { code: string; name: string }) =>
      apiFetch("/api/v1/pos-stations", {
        method: "POST",
        body: { storeId: selectedStoreId, ...input },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["pos-stations"] }),
    onError: (caught) => handleError(caught, "Não foi possível criar a estação."),
  });

  const createRegister = useMutation({
    mutationFn: (input: { posStationId: string; code: string; name: string }) =>
      apiFetch("/api/v1/cash-registers", { method: "POST", body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["pos-stations"] }),
    onError: (caught) => handleError(caught, "Não foi possível criar o caixa."),
  });

  return (
    <PageShell
      title="Tablets"
      description="Ligue o tablet com internet e ele aparece aqui sozinho. Você escolhe a loja; ninguém digita nada no aparelho."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* A fila de quem chegou e ainda não tem loja. Some sozinha quando vazia. */}
      <PendingDevices stores={stores.data ?? []} />

      <div className="mb-6 max-w-sm">
        <label htmlFor="store" className="text-sm font-medium text-text-secondary">
          Loja
        </label>
        <select
          id="store"
          value={selectedStoreId}
          onChange={(event) => setStoreId(event.target.value)}
          className="mt-1.5 min-h-[48px] w-full rounded-md border border-border bg-surface px-4"
        >
          {stores.data?.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name} ({store.code})
            </option>
          ))}
        </select>
      </div>

      {stores.data?.length === 0 && (
        <Alert tone="info" title="Cadastre uma loja primeiro">
          Tablets pertencem a um caixa de uma estação — e estações pertencem a uma loja.
        </Alert>
      )}

      {selectedStoreId && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-surface p-6">
            <h2 className="font-semibold text-text-primary">Estações e caixas</h2>
            <p className="mt-1 text-sm text-text-secondary">
              A estação agrupa o caixa, o tablet, as maquininhas e as impressoras.
            </p>

            <ul className="mt-4 space-y-3">
              {stations.data?.map((station) => (
                <li key={station.id} className="rounded-md border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {station.name} <span className="text-text-muted">({station.code})</span>
                    </span>
                    {isOwner && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const nextCode = `C${String(station.cashRegisters.length + 1).padStart(2, "0")}`;
                          createRegister.mutate({
                            posStationId: station.id,
                            code: nextCode,
                            name: `Caixa ${nextCode}`,
                          });
                        }}
                        disabled={createRegister.isPending}
                      >
                        Adicionar caixa
                      </Button>
                    )}
                  </div>

                  {station.cashRegisters.length === 0 ? (
                    <p className="mt-2 text-sm text-text-muted">Nenhum caixa nesta estação.</p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {station.cashRegisters.map((register) => (
                        <li
                          key={register.id}
                          className="rounded bg-background-secondary px-3 py-1 text-sm"
                        >
                          {register.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {isOwner && (
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                disabled={createStation.isPending}
                onClick={() => {
                  const nextCode = `E${String((stations.data?.length ?? 0) + 1).padStart(2, "0")}`;
                  createStation.mutate({ code: nextCode, name: `Estação ${nextCode}` });
                }}
              >
                <Plus className="h-5 w-5" aria-hidden />
                Nova estação
              </Button>
            )}
          </section>

          <section className="rounded-lg border border-border bg-surface p-6">
            <h2 className="font-semibold text-text-primary">Tablets desta loja</h2>

            {devices.data?.length === 0 && (
              <p className="mt-2 text-sm text-text-muted">Nenhum tablet cadastrado.</p>
            )}

            <ul className="mt-4 space-y-3">
              {devices.data?.map((device) => (
                <li
                  key={device.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
                >
                  <div>
                    <p className="font-medium">{device.name}</p>
                    <p className="text-sm text-text-secondary">
                      {STATUS_LABELS[device.status] ?? device.status}
                      {device.model && ` — ${device.model}`}
                    </p>
                  </div>

                  {isOwner && device.status === "ACTIVE" && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt("Motivo do desvínculo:");
                        if (!reason || reason.trim().length < 3) return;

                        void apiFetch(`/api/v1/devices/${device.id}/unlink`, {
                          method: "POST",
                          body: { reason: reason.trim() },
                        })
                          .then(() => queryClient.invalidateQueries({ queryKey: ["devices"] }))
                          .catch((caught) =>
                            handleError(caught, "Não foi possível desvincular."),
                          );
                      }}
                    >
                      <Unlink className="h-4 w-4" aria-hidden />
                      Desvincular
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {/*
              Não há formulário para cadastrar tablet: quem se cadastra é o
              próprio aparelho, ao ser ligado. O antigo caminho — gerar um
              código aqui e alguém digitá-lo lá — era trabalho do vendedor para
              resolver um problema do dono.
            */}
            <p className="mt-5 border-t border-border pt-5 text-sm text-text-muted">
              Para adicionar um tablet, ligue o aparelho com internet e abra o RS Pratas. Ele
              aparece no topo desta tela em segundos.
            </p>
          </section>
        </div>
      )}
    </PageShell>
  );
}
