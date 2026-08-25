import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { LogoMark } from "@/components/ui/logo";
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
      <div className="w-full max-w-md rounded-lg border border-border bg-brand p-8 shadow-sm">
        <header className="mb-8 flex flex-col items-center text-center">
          {/*
            Só a logo. Ela já traz o nome desenhado — repetir "RS Pratas" em
            outra tipografia logo abaixo competiria com a própria marca.
          */}
          <LogoMark className="h-36 w-36" />
          <h1 className="mt-4 text-lg text-text-secondary">Entre com sua matrícula</h1>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field
            label="Matrícula"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
            hint="Começa com RS, como RS482103."
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
