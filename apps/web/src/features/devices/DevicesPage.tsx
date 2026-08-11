import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "../auth/auth-context";

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
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; name: string } | null>(
    null,
  );

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

  const createDevice = useMutation({
    mutationFn: (input: { cashRegisterId: string; name: string }) =>
      apiFetch<{ pairingCode: string; expiresAt: string; device: Device }>("/api/v1/devices", {
        method: "POST",
        body: input,
      }),
    onSuccess: (result) => {
      setPairing({
        code: result.pairingCode,
        expiresAt: result.expiresAt,
        name: result.device.name,
      });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível cadastrar o tablet."),
  });

  const registers = stations.data?.flatMap((station) =>
    station.cashRegisters.map((register) => ({ ...register, stationCode: station.code })),
  );

  return (
    <PageShell
      title="Tablets"
      description="Cada tablet pertence a um caixa, que pertence a uma estação de uma loja."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {pairing && (
        <div className="mb-6">
          <Alert tone="success" title={`Tablet "${pairing.name}" cadastrado`}>
            <p>Digite este código no tablet para vinculá-lo:</p>
            <div className="mt-3 flex items-center gap-3">
              <code className="rounded bg-surface px-4 py-3 font-mono text-2xl tracking-widest">
                {pairing.code}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copiar código"
                onClick={() => void navigator.clipboard.writeText(pairing.code)}
              >
                <Copy className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <p className="mt-3">
              Vale até {new Date(pairing.expiresAt).toLocaleTimeString("pt-BR")} e serve uma única
              vez. Depois disso, gere outro.
            </p>
            <Button type="button" variant="ghost" className="mt-2" onClick={() => setPairing(null)}>
              Entendi
            </Button>
          </Alert>
        </div>
      )}

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

            {registers && registers.length > 0 && (
              <form
                className="mt-5 border-t border-border pt-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  createDevice.mutate({
                    cashRegisterId: String(form.get("cashRegisterId")),
                    name: String(form.get("name")),
                  });
                  event.currentTarget.reset();
                }}
              >
                <h3 className="font-medium text-text-primary">Cadastrar tablet</h3>

                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="cashRegisterId"
                      className="text-sm font-medium text-text-secondary"
                    >
                      Caixa
                    </label>
                    <select
                      id="cashRegisterId"
                      name="cashRegisterId"
                      required
                      className="min-h-[48px] rounded-md border border-border bg-surface px-4"
                    >
                      {registers.map((register) => (
                        <option key={register.id} value={register.id}>
                          {register.stationCode} — {register.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Field label="Nome do tablet" name="name" required placeholder="Tablet 01" />

                  <Button type="submit" disabled={createDevice.isPending}>
                    {createDevice.isPending ? "Cadastrando..." : "Cadastrar e gerar código"}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
