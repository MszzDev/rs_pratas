import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "./auth-context";

export function LoginPage() {
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await loginWithPassword(identifier.trim(), password);
      navigate("/");
    } catch (caught) {
      if (caught instanceof ApiError) {
        // Conta recém-criada precisa passar pelo primeiro acesso antes de entrar.
        if (caught.code === "FIRST_ACCESS_REQUIRED") {
          navigate("/primeiro-acesso", { state: { identifier } });
          return;
        }
        setError(caught.message);
      } else {
        setError("Não foi possível entrar agora. Verifique sua conexão e tente novamente.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-secondary px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-sm">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-rose-primary">RS Pratas</h1>
          <p className="mt-2 text-text-secondary">Entre com sua matrícula ou e-mail</p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field
            label="Matrícula ou e-mail"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
            hint="Sua matrícula começa com RS"
          />

          <Field
            label="Senha"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Entrando..." : "Entrar"}
          </Button>

          <Button type="button" variant="ghost" onClick={() => navigate("/pin")}>
            Entrar com PIN no tablet
          </Button>
        </form>
      </div>
    </main>
  );
}
