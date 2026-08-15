import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";

type Step = "credentials" | "password" | "pin" | "done";

const STEP_LABELS: Record<Step, string> = {
  credentials: "Confirme sua identidade",
  password: "Crie sua senha",
  pin: "Crie seu PIN",
  done: "Tudo pronto",
};

const STEP_ORDER: Step[] = ["credentials", "password", "pin", "done"];

export function FirstAccessPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { identifier?: string } };

  const [step, setStep] = useState<Step>("credentials");
  const [onboardingToken, setOnboardingToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [identifier, setIdentifier] = useState(location.state?.identifier ?? "");
  const [tempPassword, setTempPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  async function run(action: () => Promise<void>) {
    setError(null);
    setSubmitting(true);
    try {
      await action();
    } catch (caught) {
      /**
       * O token do primeiro acesso vale 15 minutos. Quem parou no meio para
       * procurar o papel com a senha volta e esbarra nele — e "sessão
       * expirada" no passo 2 não diz o que fazer. Devolve ao começo com a
       * matrícula preenchida, que é o único caminho possível daqui.
       */
      const expirou = caught instanceof ApiError && caught.status === 401;

      if (expirou) {
        setStep("credentials");
        setOnboardingToken("");
        setTempPassword("");
        setError(
          "O prazo desta tela venceu. Digite a senha temporária de novo para continuar.",
        );
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Não foi possível concluir agora. Tente novamente.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-secondary px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-rose-primary">Primeiro acesso</h1>
          <p className="mt-1 text-text-secondary">{STEP_LABELS[step]}</p>

          <ol className="mt-5 flex gap-2" aria-label="Progresso do primeiro acesso">
            {STEP_ORDER.map((current, index) => (
              <li
                key={current}
                aria-current={current === step ? "step" : undefined}
                className={`h-1.5 flex-1 rounded-full ${
                  index <= stepIndex ? "bg-rose-primary" : "bg-border"
                }`}
              />
            ))}
          </ol>
        </header>

        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {step === "credentials" && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await apiFetch<{ onboardingToken: string }>(
                  "/api/v1/auth/first-access/start",
                  {
                    method: "POST",
                    body: { identifier: identifier.trim(), tempPassword },
                    skipAuthRetry: true,
                  },
                );
                setOnboardingToken(result.onboardingToken);
                setStep("password");
              });
            }}
          >
            <Field
              label="Matrícula"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoCapitalize="none"
              required
            />
            <Field
              label="Senha temporária"
              type="password"
              value={tempPassword}
              onChange={(event) => setTempPassword(event.target.value)}
              hint="A que o dono entregou para você."
              required
            />
            <Button type="submit" size="lg" disabled={submitting}>
              Continuar
            </Button>
          </form>
        )}

        {step === "password" && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await apiFetch("/api/v1/auth/first-access/set-password", {
                  method: "POST",
                  body: { onboardingToken, newPassword, confirmPassword },
                  skipAuthRetry: true,
                });
                setStep("pin");
              });
            }}
          >
            <Field
              label="Nova senha"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              hint={
                newPassword.length > 0 && newPassword.length < 12
                  ? `Faltam ${12 - newPassword.length} caractere(s).`
                  : "Ao menos 12 caracteres. Precisa ser diferente da temporária."
              }
              autoComplete="new-password"
              required
            />
            <Field
              label="Confirme a nova senha"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              // Confere antes de enviar: descobrir que as senhas não batem
              // depois de um ida e volta ao servidor é irritante à toa.
              error={
                confirmPassword.length > 0 && confirmPassword !== newPassword
                  ? "As senhas não conferem."
                  : undefined
              }
              autoComplete="new-password"
              required
            />
            <Button
              type="submit"
              size="lg"
              disabled={
                submitting || newPassword.length < 12 || newPassword !== confirmPassword
              }
            >
              Continuar
            </Button>
          </form>
        )}

        {step === "pin" && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await apiFetch("/api/v1/auth/first-access/set-pin", {
                  method: "POST",
                  body: { onboardingToken, pin, confirmPin },
                  skipAuthRetry: true,
                });
                await apiFetch("/api/v1/auth/first-access/complete", {
                  method: "POST",
                  body: { onboardingToken },
                  skipAuthRetry: true,
                });
                setStep("done");
              });
            }}
          >
            <Field
              label="PIN"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              hint="4 ou 6 números. Evite repetidos ou em sequência."
              required
            />
            <Field
              label="Confirme o PIN"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ""))}
              required
            />
            <Button type="submit" size="lg" disabled={submitting}>
              Concluir
            </Button>
          </form>
        )}

        {step === "done" && (
          <div className="flex flex-col gap-5">
            <Alert tone="success" title="Cadastro concluído">
              Agora você já pode entrar com sua senha, e usar o PIN no tablet da loja.
            </Alert>
            <Button size="lg" onClick={() => navigate("/login")}>
              Ir para o login
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
