import { useCallback, useRef, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError, requestStepUpToken } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";
import { useAuth } from "../auth/auth-context";

/**
 * Saída do modo quiosque.
 *
 * Cinco toques na logo abrem a porta — não há botão visível, de propósito: um
 * botão "sair" na tela de um caixa é um convite. O gesto é discreto o
 * suficiente para não ser descoberto por acaso e simples o bastante para quem
 * sabe dele.
 *
 * O gesto NÃO é segurança. Ele apenas revela o pedido; quem autoriza é o
 * servidor, com permissão, reautenticação e motivo — tudo auditado. Se alguém
 * descobrir os cinco toques, encontra uma tela de senha.
 */

interface KioskPlugin {
  status(): Promise<{ deviceOwner: boolean; confinado: boolean }>;
  sair(): Promise<{ saiu: boolean; motivo?: string }>;
}

const Kiosk = registerPlugin<KioskPlugin>("Kiosk");

/** Toques necessários e a janela em que eles precisam acontecer. */
const TOQUES = 5;
const JANELA_MS = 3000;

export function useKioskExitGesture() {
  const [aberto, setAberto] = useState(false);
  const contagem = useRef(0);
  const primeiro = useRef(0);

  const registrarToque = useCallback(() => {
    const agora = Date.now();

    // Passou da janela: a contagem recomeça. Sem isso, cinco toques ao longo
    // do dia abririam a saída — e toque na logo acontece sem intenção.
    if (agora - primeiro.current > JANELA_MS) {
      contagem.current = 0;
      primeiro.current = agora;
    }

    contagem.current += 1;

    if (contagem.current >= TOQUES) {
      contagem.current = 0;
      setAberto(true);
    }
  }, []);

  return { aberto, fechar: () => setAberto(false), registrarToque };
}

export function KioskExitDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();

  const [senha, setSenha] = useState("");
  const [totp, setTotp] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [liberado, setLiberado] = useState(false);

  // O dono tem 2FA obrigatório, então reconfirma com o código do aplicativo
  // autenticador, não com a senha.
  const usaTotp = user?.role === "DONO";

  const sair = async () => {
    setEnviando(true);
    setErro(null);

    try {
      const deviceId = await readDeviceId();

      if (!deviceId) {
        throw new Error("Este aparelho não está vinculado a uma loja.");
      }

      // Reautenticação de uso único, presa a esta ação.
      const stepUpToken = await requestStepUpToken({
        purpose: "EXIT_KIOSK",
        ...(usaTotp ? { totpCode: totp.trim() } : { password: senha }),
      });

      // O servidor autoriza e AUDITA antes de o aparelho destravar. A ordem
      // importa: se o destrave viesse primeiro, bastaria derrubar a rede para
      // escapar — sem servidor, sem negativa.
      await apiFetch(`/api/v1/devices/${deviceId}/kiosk-exit`, {
        method: "POST",
        body: { reason: motivo.trim() },
        stepUpToken,
      });

      if (Capacitor.isNativePlatform()) {
        await Kiosk.sair();
      }

      setLiberado(true);
    } catch (caught) {
      setErro(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Não foi possível sair do modo quiosque.",
      );
    } finally {
      setEnviando(false);
    }
  };

  const podeEnviar =
    motivo.trim().length >= 5 && (usaTotp ? totp.trim().length >= 6 : senha.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lifted">
        <div className="mb-4 flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-rose-soft text-rose-primary"
            aria-hidden
          >
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-medium text-text-primary">Sair do modo quiosque</h2>
            <p className="text-sm text-text-secondary">
              O tablet volta a permitir sair do sistema. A saída fica registrada com seu nome e o
              motivo.
            </p>
          </div>
        </div>

        {liberado ? (
          <>
            <Alert tone="success" title="Tablet liberado">
              Você tem alguns minutos antes de o modo quiosque voltar sozinho. Feche o aplicativo
              para usar o aparelho.
            </Alert>
            <Button type="button" className="mt-4 w-full" onClick={onClose}>
              Fechar
            </Button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sair();
            }}
          >
            {erro && (
              <div className="mb-4">
                <Alert tone="error">{erro}</Alert>
              </div>
            )}

            <div className="mb-4">
              {usaTotp ? (
                <Field
                  label="Código do aplicativo autenticador"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                  hint="Os 6 dígitos que mudam a cada 30 segundos."
                />
              ) : (
                <Field
                  label="Sua senha"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  hint="Confirmamos de novo para garantir que é você, e não um tablet deixado aberto."
                />
              )}
            </div>

            <div className="mb-4">
              <Field
                label="Por que está saindo?"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder="Atualizar o sistema, trocar a rede, manutenção..."
                hint="Fica na auditoria. Escreva o que ajudaria alguém a entender daqui a três meses."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!podeEnviar || enviando}>
                {enviando ? "Verificando..." : "Sair do quiosque"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
