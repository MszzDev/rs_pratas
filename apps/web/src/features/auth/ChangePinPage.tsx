import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LogoMark } from "@/components/ui/logo";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "./auth-context";
import { PinKeypad } from "./PinKeypad";

type Etapa = "atual" | "novo" | "confirmar" | "pronto";

const TITULOS: Record<Etapa, string> = {
  atual: "Digite seu PIN atual",
  novo: "Escolha o novo PIN",
  confirmar: "Digite o novo PIN de novo",
  pronto: "PIN trocado",
};

/**
 * A troca do PIN, feita pelo próprio funcionário.
 *
 * Um PIN que só o dono troca vira ligação às nove da manhã com a loja cheia.
 * Aqui a pessoa resolve sozinha, no mesmo tablet onde bate o ponto.
 *
 * Três passos em vez de três campos na mesma tela: no tablet, três caixas de
 * seis bolinhas lado a lado confundem qual é qual — e errar significa começar
 * tudo de novo.
 */
export function ChangePinPage() {
  const navigate = useNavigate();
  const { user, loading, markPinChanged } = useAuth();

  const [etapa, setEtapa] = useState<Etapa>("atual");
  const [atual, setAtual] = useState("");
  const [novo, setNovo] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const vencido = user?.pinExpired ?? false;

  function voltarAoInicio(mensagem: string) {
    setErro(mensagem);
    setAtual("");
    setNovo("");
    setConfirmacao("");
    setEtapa("atual");
  }

  async function enviar(confirmado: string) {
    if (confirmado !== novo) {
      setConfirmacao("");
      setErro("Os dois PINs não são iguais. Comece de novo pelo PIN novo.");
      setNovo("");
      setEtapa("novo");
      return;
    }

    setErro(null);
    setEnviando(true);

    try {
      await apiFetch("/api/v1/auth/pin/change", {
        method: "POST",
        body: { currentPin: atual, newPin: novo },
      });

      markPinChanged();
      setEtapa("pronto");
    } catch (caught) {
      if (caught instanceof ApiError) {
        // PIN atual errado manda de volta ao primeiro passo; PIN novo recusado
        // (fraco ou repetido) só desfaz o passo que causou o problema.
        if (caught.code === "WRONG_PIN") {
          voltarAoInicio(caught.message);
        } else {
          setErro(caught.message);
          setNovo("");
          setConfirmacao("");
          setEtapa("novo");
        }
      } else {
        setErro("Não foi possível trocar agora. Verifique a conexão.");
        setConfirmacao("");
        setEtapa("confirmar");
      }
    } finally {
      setEnviando(false);
    }
  }

  const valores: Record<Exclude<Etapa, "pronto">, string> = {
    atual,
    novo,
    confirmar: confirmacao,
  };

  // A rota fica fora do guarda de sessão (é o destino de quem tem o PIN
  // vencido), então a checagem de "está logado?" acontece aqui.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-secondary">
        Carregando...
      </div>
    );
  }

  if (!user) {
    return <Navigate to={Capacitor.isNativePlatform() ? "/pin" : "/login"} replace />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background-secondary px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-7 shadow-soft">
        <header className="mb-6 flex flex-col items-center text-center">
          <LogoMark className="h-16 w-16" />
          <h1 className="mt-4 text-xl font-semibold text-text-primary">{TITULOS[etapa]}</h1>
        </header>

        {vencido && etapa !== "pronto" && (
          <div className="mb-5">
            <Alert tone="info" title="Seu PIN venceu">
              Ele vale 30 dias. Escolha um novo para continuar usando o sistema.
            </Alert>
          </div>
        )}

        {erro && (
          <div className="mb-5">
            <Alert tone="error">{erro}</Alert>
          </div>
        )}

        {etapa === "pronto" ? (
          <div className="text-center">
            <ShieldCheck className="mx-auto h-12 w-12 text-success" aria-hidden />
            <p className="mt-3 text-text-secondary">
              Pronto. Este PIN vale pelos próximos 30 dias — o sistema avisa cinco dias antes de
              vencer.
            </p>
            <Button type="button" size="lg" className="mt-5 w-full" onClick={() => navigate("/")}>
              Continuar
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-5 text-center text-sm text-text-secondary">
              {etapa === "novo"
                ? "Seis números. Evite sequências e datas de aniversário."
                : "Seis números."}
            </p>

            <PinKeypad
              valor={valores[etapa]}
              desabilitado={enviando}
              aoMudar={(proximo) => {
                if (etapa === "atual") setAtual(proximo);
                else if (etapa === "novo") setNovo(proximo);
                else setConfirmacao(proximo);
              }}
              aoCompletar={(completo) => {
                if (etapa === "atual") {
                  setErro(null);
                  setEtapa("novo");
                } else if (etapa === "novo") {
                  setErro(null);
                  setEtapa("confirmar");
                } else {
                  void enviar(completo);
                }
              }}
            />

            <div className="mt-5 flex flex-col gap-2">
              {etapa !== "atual" && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={enviando}
                  onClick={() => voltarAoInicio("")}
                >
                  Recomeçar
                </Button>
              )}

              {/* Quem já venceu não sai daqui: o sistema pediria a troca de novo
                  na próxima tela, e o botão só daria a volta. */}
              {!vencido && (
                <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                  Agora não
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
