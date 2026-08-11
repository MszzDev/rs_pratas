import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ApiError } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";
import { useAuth } from "./auth-context";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const;

/**
 * Login rápido do tablet. Teclado numérico próprio em vez do teclado do sistema:
 * o aparelho opera em modo quiosque, e o teclado nativo é uma via de escape.
 */
export function PinLoginPage() {
  const { loginWithPin } = useAuth();
  const navigate = useNavigate();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void readDeviceId().then(setDeviceId);
  }, []);

  async function submit(currentPin: string) {
    if (!deviceId) {
      setError("Este aparelho ainda não foi vinculado a uma loja.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await loginWithPin(deviceId, employeeCode.trim(), currentPin);
      navigate("/ponto");
    } catch (caught) {
      setPin("");
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Não foi possível entrar agora. Verifique a conexão.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function press(key: string) {
    if (key === "backspace") {
      setPin((current) => current.slice(0, -1));
      return;
    }

    const next = `${pin}${key}`.slice(0, 6);
    setPin(next);

    // 4 e 6 dígitos são os tamanhos aceitos; envia sozinho ao completar 6.
    if (next.length === 6) {
      void submit(next);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background-secondary px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-7 shadow-sm">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-rose-primary">RS Pratas</h1>
          <p className="mt-1 text-text-secondary">Entrada rápida no tablet</p>
        </header>

        {!deviceId && (
          <div className="mb-5">
            <Alert tone="info" title="Tablet não vinculado">
              Peça ao gerente para vincular este aparelho a uma loja.
            </Alert>
          </div>
        )}

        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <div className="mb-5">
          <Field
            label="Matrícula"
            value={employeeCode}
            onChange={(event) => setEmployeeCode(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            placeholder="RS000000"
          />
        </div>

        <div
          className="mb-6 flex justify-center gap-3"
          role="status"
          aria-label={`PIN com ${pin.length} de 6 números digitados`}
        >
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className={`h-4 w-4 rounded-full border-2 ${
                index < pin.length ? "border-rose-primary bg-rose-primary" : "border-border"
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key, index) =>
            key === "" ? (
              <span key={`empty-${index}`} />
            ) : (
              <Button
                key={key}
                type="button"
                variant={key === "backspace" ? "ghost" : "outline"}
                size="lg"
                disabled={submitting}
                onClick={() => press(key)}
                aria-label={key === "backspace" ? "Apagar último número" : `Número ${key}`}
              >
                {key === "backspace" ? <Delete className="h-5 w-5" aria-hidden /> : key}
              </Button>
            ),
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            disabled={submitting || pin.length !== 4}
            onClick={() => void submit(pin)}
          >
            Entrar com 4 números
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate("/login")}>
            Entrar com senha
          </Button>
        </div>
      </div>
    </main>
  );
}
