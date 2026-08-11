import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError, requestStepUpToken } from "@/lib/api-client";

const PERMISSION_CODE = "AUTH_LOGIN_OFF_DEVICE";

interface Props {
  user: { id: string; name: string; employeeCode: string };
  /** Já está liberado? Então o diálogo revoga em vez de conceder. */
  currentlyAllowed: boolean;
  onClose: () => void;
}

/**
 * Libera (ou corta) o acesso de uma matrícula fora dos tablets da loja.
 *
 * Pede o código do autenticador porque o backend exige reautenticação para
 * mudar permissão — e a tela pede o motivo porque ele vai para a auditoria,
 * não porque o formulário precisa dele.
 */
export function OffDeviceAccessDialog({ user, currentlyAllowed, onClose }: Props) {
  const queryClient = useQueryClient();

  const [totpCode, setTotpCode] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const stepUpToken = await requestStepUpToken({
        purpose: "CHANGE_PERMISSIONS",
        totpCode,
      });

      if (currentlyAllowed) {
        return apiFetch(`/api/v1/users/${user.id}/permissions/${PERMISSION_CODE}`, {
          method: "DELETE",
          body: { reason },
          stepUpToken,
        });
      }

      return apiFetch(`/api/v1/users/${user.id}/permissions`, {
        method: "POST",
        body: {
          code: PERMISSION_CODE,
          reason,
          // O input date entrega só a data; considera o fim daquele dia.
          ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
        },
        stepUpToken,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível concluir agora.",
      );
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="off-device-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-text-primary/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-7 shadow-lg">
        <header className="mb-5 flex items-start gap-3">
          <Smartphone className="mt-1 h-6 w-6 shrink-0 text-rose-primary" aria-hidden />
          <div>
            <h2 id="off-device-title" className="text-xl font-semibold text-text-primary">
              {currentlyAllowed ? "Cortar acesso fora da loja" : "Liberar acesso fora da loja"}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {user.name} — matrícula {user.employeeCode}
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <Alert tone="info">
          {currentlyAllowed
            ? "Ao cortar, a sessão aberta fora da loja cai na hora. Quem estiver usando o tablet da loja não é afetado."
            : "Por padrão o funcionário só entra pelos tablets da loja. Esta liberação vale apenas para esta matrícula."}
        </Alert>

        <form
          className="mt-5 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            submit.mutate();
          }}
        >
          <Field
            label="Motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Fica registrado na auditoria."
            required
            minLength={3}
          />

          {!currentlyAllowed && (
            <Field
              label="Válido até (opcional)"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              hint="Deixe em branco para liberação sem prazo."
            />
          )}

          <Field
            label="Código do seu autenticador"
            inputMode="numeric"
            pattern="\d*"
            maxLength={6}
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))}
            hint="Os 6 números do Microsoft Authenticator."
            required
          />

          <div className="flex gap-3">
            <Button
              type="submit"
              variant={currentlyAllowed ? "danger" : "primary"}
              disabled={submit.isPending}
            >
              {submit.isPending
                ? "Confirmando..."
                : currentlyAllowed
                  ? "Cortar acesso"
                  : "Liberar acesso"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
