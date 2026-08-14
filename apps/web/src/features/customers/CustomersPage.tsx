import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

interface Customer {
  id: string;
  name: string;
  phone: string;
  cpf: string | null;
  email: string | null;
  ringSize: string | null;
  notes: string | null;
}

interface CustomerDetail extends Customer {
  sales: Array<{
    id: string;
    code: string;
    totalAmount: string | null;
    completedAt: string | null;
    items: Array<{ productName: string; quantity: number }>;
  }>;
  reservations: Array<{
    id: string;
    code: string;
    quantity: number;
    expiresAt: string;
  }>;
}

/** Telefone guardado só com dígitos; a exibição volta a formatar. */
const formatPhone = (digits: string) =>
  digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : digits.length === 10
      ? `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
      : digits;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", phone: "", cpf: "", ringSize: "", notes: "" });

  const customers = useQuery({
    queryKey: ["customers", search],
    queryFn: () =>
      apiFetch<Customer[]>(
        search ? `/api/v1/customers?search=${encodeURIComponent(search)}` : "/api/v1/customers",
      ),
  });

  const detail = useQuery({
    queryKey: ["customer", openId],
    queryFn: () => apiFetch<CustomerDetail>(`/api/v1/customers/${openId}`),
    enabled: openId !== null,
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/customers", {
        method: "POST",
        body: {
          name: form.name.trim(),
          phone: form.phone,
          ...(form.cpf ? { cpf: form.cpf } : {}),
          ...(form.ringSize ? { ringSize: form.ringSize } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setAdding(false);
      setForm({ name: "", phone: "", cpf: "", ringSize: "", notes: "" });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível cadastrar."),
  });

  return (
    <PageShell
      title="Clientes"
      description="O telefone é a chave: é o que o cliente sabe de cabeça e o que evita cadastro duplicado."
      actions={
        adding ? null : (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="h-5 w-5" aria-hidden />
            Novo cliente
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {adding && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Field
              label="Telefone"
              required
              inputMode="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              hint="Com DDD."
            />
            <Field
              label="CPF (opcional)"
              value={form.cpf}
              onChange={(event) => setForm({ ...form, cpf: event.target.value })}
              hint="Só se o cliente quiser nota no CPF."
            />
            <Field
              label="Tamanho de anel"
              value={form.ringSize}
              onChange={(event) => setForm({ ...form, ringSize: event.target.value })}
              hint="Pergunte uma vez, use nas próximas."
            />
            <div className="sm:col-span-2">
              <Field
                label="Observações"
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                hint="Ex.: prefere prata escurecida, aniversário da esposa em março."
              />
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={create.isPending}>
              Cadastrar
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div className="mb-5 max-w-md">
        <Field
          label="Buscar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nome, telefone ou CPF"
        />
      </div>

      <ul className="space-y-3">
        {customers.data?.map((customer) => (
          <li key={customer.id} className="rounded-lg border border-border bg-surface p-5">
            <button
              type="button"
              onClick={() => setOpenId(openId === customer.id ? null : customer.id)}
              className="flex w-full items-start gap-3 text-left"
            >
              <UserRound className="mt-1 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
              <div>
                <p className="font-medium text-text-primary">{customer.name}</p>
                <p className="text-sm text-text-secondary">
                  {formatPhone(customer.phone)}
                  {customer.ringSize ? ` · anel ${customer.ringSize}` : ""}
                </p>
              </div>
            </button>

            {openId === customer.id && detail.data && (
              <div className="mt-4 border-t border-border pt-4">
                {detail.data.reservations.length > 0 && (
                  <div className="mb-4">
                    <h3 className="mb-1 text-sm font-medium text-text-primary">
                      Reservas aguardando
                    </h3>
                    <ul className="text-sm text-text-secondary">
                      {detail.data.reservations.map((reservation) => (
                        <li key={reservation.id}>
                          {reservation.code} · {reservation.quantity} peça(s) · até{" "}
                          {formatDate(reservation.expiresAt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <h3 className="mb-1 text-sm font-medium text-text-primary">Últimas compras</h3>
                {detail.data.sales.length === 0 ? (
                  <p className="text-sm text-text-muted">Ainda não comprou nada.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {detail.data.sales.map((sale) => (
                      <li key={sale.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {formatDate(sale.completedAt)} ·{" "}
                          {sale.items.map((item) => `${item.quantity}× ${item.productName}`).join(", ")}
                        </span>
                        <span className="font-medium text-text-primary">
                          {formatMoney(sale.totalAmount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {customers.data?.length === 0 && (
        <Alert tone="info">Nenhum cliente encontrado.</Alert>
      )}
    </PageShell>
  );
}
