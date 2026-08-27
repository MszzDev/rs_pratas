import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { LogoMark } from "@/components/ui/logo";
import { apiFetch, ApiError } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";
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

  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [avisoPedido, setAvisoPedido] = useState<string | null>(null);

  /**
   * Pedir uma senha nova.
   *
   * Não existia caminho nenhum: quem esquecia dependia de lembrar de pedir ao
   * dono por fora do sistema, e o dono de lembrar de gerar. O pedido entra na
   * MESMA fila do PIN, que o responsável já acompanha em Funcionários.
   *
   * Não vai por e-mail de propósito. Quem confirma que o pedido é da própria
   * pessoa é gente, olhando para ela — e não uma caixa de entrada que pode ter
   * sido invadida junto com a senha.
   */
  async function pedirSenha() {
    setError(null);
    setSubmitting(true);

    try {
      const resposta = await apiFetch<{ mensagem: string }>("/api/v1/auth/pin/reset-request", {
        method: "POST",
        body: { employeeCode: identifier.trim(), type: "SENHA" },
        skipAuthRetry: true,
      });

      setAvisoPedido(resposta.mensagem);
      setPedindoSenha(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível registrar o pedido.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  /** Este aparelho é um tablet vinculado a uma loja? */
  const [temAparelho, setTemAparelho] = useState(false);

  useEffect(() => {
    void readDeviceId().then((id) => setTemAparelho(id !== null));
  }, []);

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

              {avisoPedido && (
                <Alert tone="success" title="Pedido enviado">
                  {avisoPedido}
                </Alert>
              )}

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

              {/*
                Esqueci minha senha.
                Não manda e-mail: quem confirma que o pedido é da própria
                pessoa é gente, olhando para ela. Uma caixa de entrada pode ter
                sido invadida junto com a senha — e, no caso desta loja, o
                responsável está a três metros de distância.
              */}
              {pedindoSenha ? (
                <div className="rounded-md border border-border bg-background-secondary p-4">
                  <p className="text-sm text-text-secondary">
                    O responsável da loja vai liberar uma senha temporária e entregá-la a você. Ela
                    serve para uma entrada — na primeira, o sistema pede que você escolha a sua.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={submitting || identifier.trim().length < 3}
                      onClick={() => void pedirSenha()}
                    >
                      {submitting ? "Enviando..." : "Pedir senha nova"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setPedindoSenha(false)}>
                      Cancelar
                    </Button>
                  </div>

                  {identifier.trim().length < 3 && (
                    <p className="mt-2 text-sm text-text-muted">
                      Escreva sua matrícula no campo acima antes de pedir.
                    </p>
                  )}
                </div>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setPedindoSenha(true)}>
                  Esqueci minha senha
                </Button>
              )}

              {/*
                A entrada por PIN só existe onde há um tablet vinculado.
                Ela não é "uma senha mais curta": o que a torna segura é o
                aparelho. O PIN sozinho tem quatro ou seis dígitos e é digitado
                à vista de todo mundo no balcão — o que o protege é ele só
                valer NAQUELE tablet, que é da loja e fica na loja.
                No celular não há aparelho vinculado, então o botão levava a
                uma tela que só sabia dizer "tablet não vinculado". Oferecer um
                caminho que não vai a lugar nenhum é pior que não oferecer.
              */}
              {temAparelho && (
                <Button type="button" variant="ghost" onClick={() => navigate("/pin")}>
                  Entrar com PIN no tablet
                </Button>
              )}
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
