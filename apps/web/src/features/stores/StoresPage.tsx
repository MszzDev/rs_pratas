import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { horarioVazio, resumirHorario, type StoreHours } from "@rs-pratas/shared";
import { OpeningHoursEditor } from "./OpeningHoursEditor";

interface StoreAddress {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

interface Store {
  id: string;
  code: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  addressJson: StoreAddress | null;
  openingHours: StoreHours | null;
  isActive: boolean;
  isOpen: boolean;
}

const EMPTY = {
  code: "",
  name: "",
  cnpj: "",
  phone: "",
  email: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

/** Alguma linha preenchida? Horário todo nulo é "não configurado", não "fechada". */
const temAlgumHorario = (horas: StoreHours): boolean =>
  Object.values(horas).some((intervalo) => intervalo?.abre && intervalo.fecha);

const linhaDoEndereco = (address: StoreAddress | null): string | null => {
  if (!address) return null;

  const rua = [address.logradouro, address.numero].filter(Boolean).join(", ");
  const cidade = [address.cidade, address.uf].filter(Boolean).join("/");

  return [rua, address.bairro, cidade, address.cep].filter(Boolean).join(" · ") || null;
};

/**
 * Lojas.
 *
 * Os dados completos ficam aqui porque é o que sai impresso: o comprovante
 * mostra endereço, CNPJ e telefone da loja onde a venda aconteceu, não os da
 * empresa. Sem isso o cliente não sabe onde voltar para trocar a peça.
 */
export function StoresPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [horario, setHorario] = useState<StoreHours>(horarioVazio());
  const [aviso, setAviso] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/api/v1/stores"),
  });

  const handleError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : "Não foi possível salvar.");

  const corpo = () => ({
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    ...(form.cnpj ? { cnpj: form.cnpj } : {}),
    ...(form.phone ? { phone: form.phone } : {}),
    ...(form.email ? { email: form.email } : {}),
    address: {
      ...(form.cep ? { cep: form.cep } : {}),
      ...(form.logradouro ? { logradouro: form.logradouro } : {}),
      ...(form.numero ? { numero: form.numero } : {}),
      ...(form.complemento ? { complemento: form.complemento } : {}),
      ...(form.bairro ? { bairro: form.bairro } : {}),
      ...(form.cidade ? { cidade: form.cidade } : {}),
      ...(form.uf ? { uf: form.uf.toUpperCase() } : {}),
    },
    // Só vai se algum dia tiver horário: mandar oito dias nulos gravaria
    // "fechada a semana toda" em quem só não preencheu.
    ...(temAlgumHorario(horario) ? { openingHours: horario } : {}),
  });

  const fechar = () => {
    setCreating(false);
    setEditingId(null);
    setForm({ ...EMPTY });
    setHorario(horarioVazio());
  };

  const salvar = useMutation({
    mutationFn: () =>
      editingId
        ? apiFetch(`/api/v1/stores/${editingId}`, { method: "PATCH", body: corpo() })
        : apiFetch("/api/v1/stores", { method: "POST", body: corpo() }),
    onSuccess: () => {
      setError(null);
      fechar();
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: handleError,
  });

  const remover = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch<{ removido: string; mensagem: string }>(`/api/v1/stores/${params.id}`, {
        method: "DELETE",
        body: { reason: params.reason },
      }),
    onSuccess: (resultado) => {
      setError(null);
      setAviso(resultado.mensagem);
      void queryClient.invalidateQueries({ queryKey: ["stores"] });
    },
    onError: handleError,
  });

  function editar(store: Store) {
    const address = store.addressJson ?? {};
    setEditingId(store.id);
    setCreating(false);
    setHorario(store.openingHours ?? horarioVazio());
    setForm({
      code: store.code,
      name: store.name,
      cnpj: store.cnpj ?? "",
      phone: store.phone ?? "",
      email: store.email ?? "",
      cep: address.cep ?? "",
      logradouro: address.logradouro ?? "",
      numero: address.numero ?? "",
      complemento: address.complemento ?? "",
      bairro: address.bairro ?? "",
      cidade: address.cidade ?? "",
      uf: address.uf ?? "",
    });
  }

  const aberto = creating || editingId !== null;

  return (
    <PageShell
      eyebrow="Cadastro"
      title="Lojas"
      description="Os dados daqui saem impressos no comprovante da venda feita nesta loja."
      actions={
        aberto ? null : (
          <Button
            type="button"
            onClick={() => {
              setCreating(true);
              setForm({ ...EMPTY });
              setHorario(horarioVazio());
            }}
          >
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

      {aviso && (
        <div className="mb-5">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {aberto && (
        <Card className="mb-6">
          <CardHeader
            title={editingId ? "Editar loja" : "Nova loja"}
            description="Só o nome e o código são obrigatórios — o resto pode ser preenchido depois."
          />
          <CardBody>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                salvar.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Código"
                  required
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  hint="Curto, para uso interno. Ex.: MTZ, SH01."
                />
                <Field
                  label="Nome"
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <Field
                  label="CNPJ"
                  value={form.cnpj}
                  onChange={(event) => setForm({ ...form, cnpj: event.target.value })}
                  hint="Aparece no comprovante."
                />
                <Field
                  label="Telefone"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
                <div className="sm:col-span-2">
                  <Field
                    label="E-mail da loja"
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                  />
                </div>
              </div>

              <fieldset className="mt-6">
                <legend className="mb-3 text-sm font-medium text-text-primary">Endereço</legend>

                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="sm:col-span-2">
                    <Field
                      label="CEP"
                      inputMode="numeric"
                      value={form.cep}
                      onChange={(event) => setForm({ ...form, cep: event.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Field
                      label="Rua"
                      value={form.logradouro}
                      onChange={(event) => setForm({ ...form, logradouro: event.target.value })}
                    />
                  </div>
                  <Field
                    label="Número"
                    value={form.numero}
                    onChange={(event) => setForm({ ...form, numero: event.target.value })}
                  />

                  <div className="sm:col-span-2">
                    <Field
                      label="Complemento"
                      value={form.complemento}
                      onChange={(event) => setForm({ ...form, complemento: event.target.value })}
                      hint="Ex.: Loja 214, Piso 2."
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Field
                      label="Bairro"
                      value={form.bairro}
                      onChange={(event) => setForm({ ...form, bairro: event.target.value })}
                    />
                  </div>
                  <Field
                    label="Cidade"
                    value={form.cidade}
                    onChange={(event) => setForm({ ...form, cidade: event.target.value })}
                  />
                  <Field
                    label="UF"
                    maxLength={2}
                    value={form.uf}
                    onChange={(event) => setForm({ ...form, uf: event.target.value })}
                  />
                </div>
              </fieldset>

              <div className="mt-6">
                <OpeningHoursEditor valor={horario} aoMudar={setHorario} />
              </div>

              <div className="mt-6 flex gap-3">
                <Button type="submit" disabled={salvar.isPending}>
                  {editingId ? "Salvar alterações" : "Cadastrar loja"}
                </Button>
                <Button type="button" variant="outline" onClick={fechar}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <ul className="space-y-3">
        {stores.data?.map((store) => (
          <li
            key={store.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border/70 bg-surface p-5 shadow-soft"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text-primary">{store.name}</span>
                  <Badge tone={store.isOpen ? "success" : "neutral"}>
                    {store.isOpen ? "Aberta" : "Fechada"}
                  </Badge>
                  {!store.isActive && <Badge tone="danger">Desativada</Badge>}
                </div>

                <p className="mt-0.5 text-sm text-text-secondary">
                  {store.code}
                  {store.cnpj ? ` · CNPJ ${store.cnpj}` : ""}
                  {store.phone ? ` · ${store.phone}` : ""}
                </p>

                {linhaDoEndereco(store.addressJson) && (
                  <p className="mt-1 text-sm text-text-muted">
                    {linhaDoEndereco(store.addressJson)}
                  </p>
                )}

                {resumirHorario(store.openingHours) && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
                    <Clock className="h-4 w-4 shrink-0" aria-hidden />
                    {resumirHorario(store.openingHours)}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => editar(store)}>
                <Pencil className="h-5 w-5" aria-hidden />
                Editar
              </Button>

              {/*
                Loja que já vendeu é DESATIVADA, não apagada — o servidor
                decide isso, não a tela. Apagar levaria junto o faturamento, o
                espelho de ponto de quem trabalhou ali e a garantia de quem
                comprou.
              */}
              <Button
                type="button"
                variant="ghost"
                disabled={remover.isPending}
                onClick={() => {
                  const motivo = window.prompt(
                    `Remover "${store.name}". Por quê?\n\nSe a loja já vendeu, ela sai da operação mas o histórico permanece.`,
                  );
                  if (!motivo || motivo.trim().length < 3) return;
                  remover.mutate({ id: store.id, reason: motivo.trim() });
                }}
              >
                <Trash2 className="h-5 w-5" aria-hidden />
                Remover
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {stores.data?.length === 0 && (
        <Alert tone="info">Nenhuma loja cadastrada. Comece pela matriz.</Alert>
      )}
    </PageShell>
  );
}
