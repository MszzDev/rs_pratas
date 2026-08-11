import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { Copy, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "./auth-context";

type Step = "scan" | "confirm" | "recovery";

interface SetupResponse {
  otpauthUrl: string;
  secret: string;
}

/**
 * Configuração do segundo fator do Dono.
 *
 * Enquanto ele não confirmar, o backend recusa todas as outras rotas — então
 * esta tela é a única saída, e por isso não tem botão de "pular".
 */
export function TwoFactorSetupPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [step, setStep] = useState<Step>("scan");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Espera a sessão ser restaurada antes de chamar a API. Sem isso, a tela
  // dispara a requisição no mesmo instante em que monta — antes de o access
  // token existir — e o usuário vê "sessão expirada" logo após ter entrado.
  useEffect(() => {
    if (loading || !user) return;

    void (async () => {
      try {
        const result = await apiFetch<SetupResponse>("/api/v1/auth/2fa/setup", {
          method: "POST",
        });
        setSetup(result);
        // O QR é desenhado no próprio navegador: o segredo não passa por
        // nenhum serviço externo de geração de imagem.
        setQrDataUrl(await QRCode.toDataURL(result.otpauthUrl, { width: 240, margin: 1 }));
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Não foi possível iniciar a configuração. Recarregue a página.",
        );
      }
    })();
  }, [loading, user]);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await apiFetch<{ recoveryCodes: string[] }>("/api/v1/auth/2fa/confirm", {
        method: "POST",
        body: { code },
      });
      setRecoveryCodes(result.recoveryCodes);
      setStep("recovery");
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível confirmar agora.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-secondary px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-8 shadow-sm">
        <header className="mb-6 flex items-start gap-3">
          <ShieldCheck className="mt-1 h-7 w-7 shrink-0 text-rose-primary" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">
              Verificação em duas etapas
            </h1>
            <p className="mt-1 text-text-secondary">
              Obrigatória para o perfil Dono — sua conta acessa custo, lucro e as credenciais
              de integração.
            </p>
          </div>
        </header>

        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {step === "scan" && (
          <div className="flex flex-col gap-5">
            <ol className="list-decimal space-y-1 pl-5 text-text-secondary">
              <li>Abra o Microsoft Authenticator no celular.</li>
              <li>Toque em adicionar conta, e escolha &ldquo;Outra conta&rdquo;.</li>
              <li>Aponte a câmera para o código abaixo.</li>
            </ol>

            <div className="flex justify-center rounded-md border border-border bg-background-secondary p-6">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Código QR para configurar a verificação em duas etapas"
                  className="h-60 w-60"
                />
              ) : (
                <div className="flex h-60 w-60 items-center justify-center text-text-muted">
                  Gerando código...
                </div>
              )}
            </div>

            {setup && (
              <details className="rounded-md border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium text-text-secondary">
                  Não consigo escanear
                </summary>
                <p className="mt-3 text-sm text-text-secondary">
                  Digite esta chave manualmente no aplicativo:
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-background-secondary p-3 font-mono text-sm">
                    {setup.secret}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copiar chave"
                    onClick={() => void navigator.clipboard.writeText(setup.secret)}
                  >
                    <Copy className="h-5 w-5" aria-hidden />
                  </Button>
                </div>
              </details>
            )}

            <Button size="lg" disabled={!setup} onClick={() => setStep("confirm")}>
              Já escaneei, continuar
            </Button>
          </div>
        )}

        {step === "confirm" && (
          <form className="flex flex-col gap-5" onSubmit={confirm}>
            <Field
              label="Código do aplicativo"
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              hint="Os 6 números que aparecem no Microsoft Authenticator. Eles mudam a cada 30 segundos."
              autoFocus
              required
            />

            <div className="flex gap-3">
              <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
                {busy ? "Confirmando..." : "Confirmar"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep("scan")}>
                Voltar ao código
              </Button>
            </div>
          </form>
        )}

        {step === "recovery" && (
          <div className="flex flex-col gap-5">
            <Alert tone="success" title="Verificação ativada">
              Sua conta está protegida. A partir de agora, ações sensíveis vão pedir o código
              do aplicativo.
            </Alert>

            <div>
              <h2 className="font-semibold text-text-primary">Códigos de recuperação</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Guarde estes códigos em lugar seguro, fora do celular. Cada um serve uma única
                vez, e são a sua saída se perder o aparelho.{" "}
                <strong>Esta é a única vez que eles aparecem.</strong>
              </p>

              <ul className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-border bg-background-secondary p-4 font-mono text-sm">
                {recoveryCodes.map((recoveryCode) => (
                  <li key={recoveryCode}>{recoveryCode}</li>
                ))}
              </ul>

              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}
              >
                <Copy className="h-5 w-5" aria-hidden />
                Copiar todos
              </Button>
            </div>

            <label className="flex items-start gap-3 text-text-secondary">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-rose-primary"
                checked={savedConfirmed}
                onChange={(event) => setSavedConfirmed(event.target.checked)}
              />
              <span>Guardei os códigos em lugar seguro.</span>
            </label>

            <Button size="lg" disabled={!savedConfirmed} onClick={() => navigate("/")}>
              Continuar para o sistema
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
