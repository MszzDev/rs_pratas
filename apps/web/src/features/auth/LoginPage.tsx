import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { LogoMark } from "@/components/ui/logo";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "./auth-context";

/**
 * A entrada pelo computador: matrícula e senha.
 *
 * Veste as cores da marca — o vinho da logo à esquerda, o rosa claro do fundo
 * dela em volta — porque esta é a primeira tela que qualquer pessoa vê do
 * sistema, todo dia. Uma caixa branca no meio do cinza funciona; não parece
 * de ninguém.
 */
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
    <main className="flex min-h-screen bg-brand">
      {/*
        A marca ocupa a lateral em tela grande e some no celular, onde ela
        empurraria o formulário para fora da dobra.
      */}
      <section className="hidden w-2/5 flex-col justify-between bg-rose-primary p-10 text-rose-contraste lg:flex">
        <LogoMark className="h-28 w-28 rounded-full bg-brand p-3" />

        <div>
          <p className="text-3xl font-light leading-snug">
            Prata que se vende
            <br />
            com a conta certa.
          </p>
          <p className="mt-4 max-w-sm text-white/70">
            Venda, caixa, estoque e ponto no mesmo lugar — e cada movimento com hora e nome.
          </p>
        </div>

        <p className="text-sm text-white/60">
          Sua senha é só sua. Ninguém da empresa vai pedir ela por mensagem ou telefone.
        </p>
      </section>

      <section className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          <header className="mb-6 flex flex-col items-center text-center lg:hidden">
            <LogoMark className="h-24 w-24" />
          </header>

          <div className="rounded-lg border border-border bg-surface p-8 shadow-soft">
            <h1 className="text-xl font-semibold text-text-primary">Entrar</h1>
            <p className="mb-6 mt-1 text-sm text-text-secondary">
              Use a matrícula que você recebeu da loja.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
              {error && <Alert tone="error">{error}</Alert>}

              <Field
                label="Matrícula"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value.toUpperCase())}
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

          <p className="mt-4 text-center text-sm text-text-muted">
            Esqueceu o PIN do tablet? Peça um temporário na própria tela de entrada dele.
          </p>
        </div>
      </section>
    </main>
  );
}
