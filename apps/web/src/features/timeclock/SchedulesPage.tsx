import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { Weekday } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";

interface Schedule {
  id: string;
  userId: string;
  storeId: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
  toleranceMinutes: number;
}

interface UserRow {
  id: string;
  name: string;
  employeeCode: string;
  storeIds: string[];
}

interface StoreRow {
  id: string;
  name: string;
  code: string;
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MONDAY: "Segunda",
  TUESDAY: "Terça",
  WEDNESDAY: "Quarta",
  THURSDAY: "Quinta",
  FRIDAY: "Sexta",
  SATURDAY: "Sábado",
  SUNDAY: "Domingo",
};

/** Segunda primeiro: é como a escala da loja é lida, não como o enum é ordenado. */
const WEEK_ORDER: Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export function SchedulesPage() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [form, setForm] = useState({
    storeId: "",
    weekday: "MONDAY" as Weekday,
    startTime: "09:00",
    endTime: "18:00",
    breakStartTime: "12:00",
    breakEndTime: "13:00",
    toleranceMinutes: 10,
  });

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserRow[]>("/api/v1/users"),
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<StoreRow[]>("/api/v1/stores"),
  });

  const schedules = useQuery({
    queryKey: ["schedules", selectedUserId],
    queryFn: () =>
      apiFetch<Schedule[]>(
        selectedUserId
          ? `/api/v1/timeclock/schedules?userId=${selectedUserId}`
          : "/api/v1/timeclock/schedules",
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["schedules"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/timeclock/schedules", {
        method: "POST",
        body: {
          userId: selectedUserId,
          storeId: form.storeId,
          weekday: form.weekday,
          startTime: form.startTime,
          endTime: form.endTime,
          // Campo vazio significa "sem intervalo", não string vazia.
          ...(form.breakStartTime ? { breakStartTime: form.breakStartTime } : {}),
          ...(form.breakEndTime ? { breakEndTime: form.breakEndTime } : {}),
          toleranceMinutes: form.toleranceMinutes,
        },
      }),
    onSuccess: () => {
      setError(null);
      setAdding(false);
      invalidate();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível salvar."),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/timeclock/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível encerrar."),
  });

  const selectedUser = users.data?.find((user) => user.id === selectedUserId);
  const byWeekday = new Map((schedules.data ?? []).map((row) => [row.weekday, row]));

  return (
    <PageShell
      title="Jornadas de trabalho"
      description="O horário previsto de cada funcionário. É contra ele que o atraso é calculado."
      actions={
        selectedUserId && !adding ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="h-5 w-5" aria-hidden />
            Definir horário
          </Button>
        ) : null
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-6 max-w-sm">
        <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="funcionario">
          Funcionário
        </label>
        <select
          id="funcionario"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
        >
          <option value="">Selecione</option>
          {users.data?.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} — {user.employeeCode}
            </option>
          ))}
        </select>
      </div>

      {!selectedUserId && (
        <Alert tone="info">Escolha um funcionário para ver e definir a jornada dele.</Alert>
      )}

      {selectedUserId && adding && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <h2 className="mb-4 font-medium text-text-primary">
            Novo horário para {selectedUser?.name}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="loja">
                Loja
              </label>
              <select
                id="loja"
                required
                value={form.storeId}
                onChange={(event) => setForm({ ...form, storeId: event.target.value })}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Selecione</option>
                {stores.data?.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="dia">
                Dia da semana
              </label>
              <select
                id="dia"
                value={form.weekday}
                onChange={(event) =>
                  setForm({ ...form, weekday: event.target.value as Weekday })
                }
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                {WEEK_ORDER.map((day) => (
                  <option key={day} value={day}>
                    {WEEKDAY_LABELS[day]}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Entrada"
              type="time"
              required
              value={form.startTime}
              onChange={(event) => setForm({ ...form, startTime: event.target.value })}
            />
            <Field
              label="Saída"
              type="time"
              required
              value={form.endTime}
              onChange={(event) => setForm({ ...form, endTime: event.target.value })}
            />
            <Field
              label="Início do intervalo"
              type="time"
              value={form.breakStartTime}
              onChange={(event) => setForm({ ...form, breakStartTime: event.target.value })}
              hint="Deixe vazio se não houver."
            />
            <Field
              label="Volta do intervalo"
              type="time"
              value={form.breakEndTime}
              onChange={(event) => setForm({ ...form, breakEndTime: event.target.value })}
            />
            <Field
              label="Tolerância (minutos)"
              type="number"
              min={0}
              max={60}
              value={String(form.toleranceMinutes)}
              onChange={(event) =>
                setForm({ ...form, toleranceMinutes: Number(event.target.value) })
              }
              hint="Atraso até esse limite não conta como atraso."
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={create.isPending}>
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>

          <p className="mt-4 text-sm text-text-secondary">
            Definir um horário novo encerra o anterior deste mesmo dia. O antigo continua guardado
            para explicar as marcações já registradas.
          </p>
        </form>
      )}

      {selectedUserId && (
        <ul className="space-y-3">
          {WEEK_ORDER.map((day) => {
            const schedule = byWeekday.get(day);

            return (
              <li
                key={day}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
              >
                <div>
                  <p className="font-medium text-text-primary">{WEEKDAY_LABELS[day]}</p>
                  {schedule ? (
                    <p className="text-sm text-text-secondary">
                      {schedule.startTime} às {schedule.endTime}
                      {schedule.breakStartTime && schedule.breakEndTime
                        ? ` · intervalo ${schedule.breakStartTime}–${schedule.breakEndTime}`
                        : ""}
                      {` · tolerância de ${schedule.toleranceMinutes} min`}
                    </p>
                  ) : (
                    <p className="text-sm text-text-muted">Sem horário definido — folga.</p>
                  )}
                </div>

                {schedule && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={deactivate.isPending}
                    onClick={() => deactivate.mutate(schedule.id)}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                    Encerrar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
