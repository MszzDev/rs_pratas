import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { LogoMark } from "@/components/ui/logo";
import { StatusStrip } from "@/components/ui/status-strip";
import { apiFetch, ApiError } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";
import { useAuth } from "./auth-context";
import { PinKeypad } from "./PinKeypad";

/**
 * A entrada do tablet: matrícula e seis números.
 *
 * É a única forma de entrar no aparelho de loja — senha longa digitada num
 * teclado de tela, com fila no balcão, ninguém faz. O que sustenta um PIN
 * curto é o tablet: ele só funciona vinculado a uma loja, e sem tablet
 * conhecido matrícula e PIN não valem nada.
 */
export function PinLoginPage() {
  const { loginWithPin } = useAuth();
  const navigate = useNavigate();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [pedindoPin, setPedindoPin] = useState(false);
  const [avisoPedido, setAvisoPedido] = useState<string | null>(null);

  useEffect(() => {
    void readDeviceId().then(setDeviceId);
  }, []);

  async function submit(currentPin: string) {
    if (!deviceId) {
      setError("Este aparelho ainda não foi vinculado a uma loja.");
      return;
    }

    if (employeeCode.trim().length < 3) {
      setPin("");
      setError("Digite sua matrícula antes do PIN.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await loginWithPin(deviceId, employeeCode.trim(), currentPin);
      navigate("/");
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

  /**
   * Pedido de PIN temporário.
   *
   * Quem esqueceu não tem sessão para pedir com ela — por isso o pedido sai
   * daqui, sem estar logado. Pedir não libera nada: quem libera é o dono ou o
   * gerente, com o nome deles no registro.
   */
  async function pedirPinTemporario() {
    if (employeeCode.trim().length < 3) {
      setError("Digite sua matrícula para o responsável saber quem está pedindo.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const resposta = await apiFetch<{ mensagem: string }>("/api/v1/auth/pin/reset-request", {
        method: "POST",
        body: {
          employeeCode: employeeCode.trim(),
          ...(deviceId ? { deviceId } : {}),
        },
        skipAuthRetry: true,
      });

      setAvisoPedido(resposta.mensagem);
      setPedindoPin(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível enviar o pedido agora.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background-secondary px-4 py-8">
      {/* A tela de entrada é onde o tablet passa a maior parte do dia — hora,
          bateria e brilho precisam estar à mão antes do login, não depois. */}
      <div className="absolute right-4 top-4">
        <StatusStrip />
      </div>

      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-7 shadow-soft">
        <header className="mb-6 flex flex-col items-center text-center">
          <LogoMark className="h-24 w-24" />
          <p className="mt-3 text-text-secondary">Matrícula e PIN de 6 números</p>
        </header>

        {!deviceId && (
          <div className="mb-5">
            <Alert tone="info" title="Tablet não vinculado">
              Peça a quem administra o sistema para vincular este aparelho a uma loja.
            </Alert>
          </div>
        )}

        {avisoPedido && (
          <div className="mb-5">
            <Alert tone="success" title="Pedido enviado">
              {avisoPedido}
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
            autoComplete="username"
            placeholder="RS000000"
          />
        </div>

        {pedindoPin ? (
          <div className="rounded-md border border-border bg-background-secondary p-4">
            <p className="text-sm text-text-secondary">
              O responsável da loja libera um PIN temporário para você. Ele serve para uma entrada
              — logo depois o sistema pede que você escolha o seu.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <Button type="button" disabled={submitting} onClick={() => void pedirPinTemporario()}>
                {submitting ? "Enviando..." : "Pedir PIN temporário"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPedindoPin(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <PinKeypad
              valor={pin}
              aoMudar={setPin}
              desabilitado={submitting || !deviceId}
              aoCompletar={(completo) => void submit(completo)}
            />

            <div className="mt-5 flex flex-col gap-2">
              <Button type="button" variant="ghost" onClick={() => setPedindoPin(true)}>
                Esqueci meu PIN
              </Button>

              {/*
                No navegador esta tela é exceção — quem entra do computador usa
                senha. No tablet não existe senha para oferecer.
              */}
              {!Capacitor.isNativePlatform() && (
                <Button type="button" variant="ghost" onClick={() => navigate("/login")}>
                  Entrar com senha
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
