import { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiFetch } from "@/lib/api-client";
import { saveDeviceId } from "@/lib/secure-storage";

/**
 * O tablet se apresenta ao sistema e espera o dono vinculá-lo a uma loja.
 *
 * Roda só no aplicativo nativo. No navegador não há aparelho a vincular — é o
 * computador do dono, e ele entra por matrícula e senha como sempre.
 */

interface KioskPlugin {
  identidade(): Promise<{ hardwareId: string; model: string; osVersion: string }>;
}

const Kiosk = registerPlugin<KioskPlugin>("Kiosk");

interface Registro {
  vinculado: boolean;
  deviceId: string | null;
  storeName: string | null;
  deviceName: string | null;
}

export type EstadoDoTablet =
  | { estado: "verificando" }
  /** Navegador: não há aparelho a vincular. */
  | { estado: "nao-se-aplica" }
  | { estado: "aguardando"; apelido: string }
  | { estado: "vinculado"; storeName: string; deviceName: string };

/**
 * Enquanto não estiver vinculado, o tablet volta a perguntar de tempos em
 * tempos. Dez segundos: o dono está do outro lado do balcão vinculando agora,
 * e esperar um minuto pareceria que não funcionou.
 */
const INTERVALO_MS = 10_000;

export function useDeviceRegistration(): EstadoDoTablet {
  const [estado, setEstado] = useState<EstadoDoTablet>({ estado: "verificando" });

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setEstado({ estado: "nao-se-aplica" });
      return;
    }

    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const anunciar = async () => {
      try {
        const identidade = await Kiosk.identidade();

        const registro = await apiFetch<Registro>("/api/v1/devices/announce", {
          method: "POST",
          body: {
            hardwareId: identidade.hardwareId,
            model: identidade.model,
            osVersion: identidade.osVersion,
          },
          skipAuthRetry: true,
        });

        if (!vivo) return;

        if (registro.vinculado && registro.deviceId) {
          // Guarda o identificador para o login por PIN e para o ponto: a
          // partir daqui o tablet sabe quem ele é sem perguntar de novo.
          await saveDeviceId(registro.deviceId);

          setEstado({
            estado: "vinculado",
            storeName: registro.storeName ?? "",
            deviceName: registro.deviceName ?? "",
          });
          return;
        }

        setEstado({
          estado: "aguardando",
          apelido: `${identidade.model} ····${identidade.hardwareId.slice(-4)}`,
        });

        timer = setTimeout(() => void anunciar(), INTERVALO_MS);
      } catch {
        if (!vivo) return;

        // Sem rede ou API fora: continua tentando. Um tablet ligado no balcão
        // sem internet vai ter internet em algum momento, e ninguém deveria
        // precisar reabrir o aplicativo para isso acontecer.
        setEstado({ estado: "aguardando", apelido: "" });
        timer = setTimeout(() => void anunciar(), INTERVALO_MS);
      }
    };

    void anunciar();

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return estado;
}
