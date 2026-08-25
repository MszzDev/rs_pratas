import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LogoMark } from "@/components/ui/logo";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-context";
import { PinKeypad } from "@/features/auth/PinKeypad";

/**
 * A tela que trava sozinha quando o tablet fica parado.
 *
 * O balcão fica sozinho o tempo todo: a vendedora vai buscar uma peça no
 * estoque e o tablet continua aberto na conta dela, com o caixa do dia e o
 * cadastro dos clientes à mão de quem passar. Depois de um tempo sem toque, a
 * tela trava e só o PIN de quem estava logado destrava.
 *
 * Travar NÃO é sair: a venda em andamento, o carrinho e o turno continuam
 * exatamente onde estavam. Deslogar por inatividade puniria a pessoa que foi
 * ao estoque, e ela recomeçaria a venda do zero — o que faria alguém desligar
 * o bloqueio no primeiro dia.
 */

const EVENTOS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function ScreenLock() {
  const { user } = useAuth();

  const politica = useQuery({
    queryKey: ["device-policy"],
    queryFn: () => apiFetch<{ inactivityLockSeconds: number }>("/api/v1/settings/device-policy"),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });

  const segundos = politica.data?.inactivityLockSeconds ?? 0;

  const [travado, setTravado] = useState(false);
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ultimoToque = useRef(Date.now());

  /**
   * Só no tablet.
   *
   * No computador do escritório, travar a cada dois minutos seria estorvo — o
   * aparelho já é de uma pessoa só, numa sala com porta.
   */
  const seAplica = Capacitor.isNativePlatform() && segundos > 0 && Boolean(user);

  useEffect(() => {
    if (!seAplica || travado) return;

    const registrar = () => {
      ultimoToque.current = Date.now();
    };

    for (const evento of EVENTOS) {
      window.addEventListener(evento, registrar, { passive: true });
    }

    // Verifica de tempos em tempos em vez de reiniciar um temporizador a cada
    // toque: num tablet de balcão são centenas de toques por hora, e reagendar
    // a cada um deles é trabalho jogado fora.
    const relogio = setInterval(() => {
      if (Date.now() - ultimoToque.current >= segundos * 1000) {
        setTravado(true);
        setPin("");
        setErro(null);
      }
    }, 5_000);

    return () => {
      for (const evento of EVENTOS) {
        window.removeEventListener(evento, registrar);
      }
      clearInterval(relogio);
    };
  }, [seAplica, travado, segundos]);

  const destravar = useCallback(async (digitado: string) => {
    setEnviando(true);

    try {
      await apiFetch("/api/v1/auth/pin/verify", { method: "POST", body: { pin: digitado } });

      ultimoToque.current = Date.now();
      setTravado(false);
      setPin("");
      setErro(null);
    } catch (caught) {
      setPin("");
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível conferir agora.");
    } finally {
      setEnviando(false);
    }
  }, []);

  if (!travado) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-brand px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Tela bloqueada"
    >
      <LogoMark className="h-20 w-20" />

      <div className="mt-6 w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-lifted">
        <div className="mb-4 flex items-center gap-2 text-text-secondary">
          <Lock className="h-5 w-5 shrink-0" aria-hidden />
          <p>
            Tela bloqueada — <strong className="text-text-primary">{user?.name}</strong>
          </p>
        </div>

        {erro && (
          <div className="mb-4">
            <Alert tone="error">{erro}</Alert>
          </div>
        )}

        <p className="mb-5 text-sm text-text-secondary">
          Digite seu PIN para continuar de onde parou.
        </p>

        <PinKeypad
          valor={pin}
          aoMudar={setPin}
          desabilitado={enviando}
          aoCompletar={(completo) => void destravar(completo)}
        />

        <Button
          type="button"
          variant="ghost"
          className="mt-4 w-full"
          disabled={enviando || pin.length < 4}
          onClick={() => void destravar(pin)}
        >
          Destravar
        </Button>
      </div>
    </div>
  );
}
