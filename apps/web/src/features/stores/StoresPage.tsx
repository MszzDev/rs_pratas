import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
  cnpj: string | null;
  phone: string | null;
  timezone: string;
  isActive: boolean;
}

export function StoresPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.role === "DONO";

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/api/v1/stores"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Store>("/api/v1/stores", {
        method: "POST",
        body: { code: code.toUpperCase(), name, ...(phone ? { phone } : {}) },
      }),
    onSuccess: () => {
      setShowForm(false);
      setCode("");
      setName("");
      setPhone("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível cadastrar agora."),
  });

  return (
    <PageShell
      title="Lojas"
      description="Cada loja tem estoque, funcionários, caixas e tablets próprios."
      actions={
        isOwner && (
          <Button onClick={() => setShowForm((current) => !current)}>
            <Plus className="h-5 w-5" aria-hidden />
            Nova loja
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {showForm && isOwner && (
        <form
          className="mb-6 grid gap-5 rounded-lg border border-border bg-surface p-6 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field
            label="Código"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            hint="Curto e único, como MTZ ou SA01."
            maxLength={20}
            required
          />
          <Field
            label="Nome"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Field
            label="Telefone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />

          <div className="flex items-end gap-3">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Salvando..." : "Cadastrar loja"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {stores.data?.length === 0 && (
        <Alert tone="info" title="Nenhuma loja cadastrada">
          Cadastre a primeira loja para depois montar as estações, os caixas e os tablets.
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {stores.data?.map((store) => (
          <article key={store.id} className="rounded-lg border border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-text-primary">{store.name}</h2>
                <p className="font-mono text-sm text-text-muted">{store.code}</p>
              </div>
              {!store.isActive && <span className="text-sm text-danger">Desativada</span>}
            </div>

            {store.phone && <p className="mt-3 text-sm text-text-secondary">{store.phone}</p>}
          </article>
        ))}
      </div>
    </PageShell>
  );
}
