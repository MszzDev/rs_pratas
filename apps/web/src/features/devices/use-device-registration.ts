import { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiFetch } from "@/lib/api-client";
import {
  limparIdentidadeDoAparelho,
  readDeviceLabel,
  saveDeviceId,
  saveDeviceLabel,
} from "@/lib/secure-storage";

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

/**
 * Já vinculado, ele continua conferindo — mais devagar.
 *
 * Um tablet desvinculado pelo dono continuava mostrando a tela de entrada da
 * loja antiga até alguém reiniciar o aplicativo: a vendedora digitava o PIN e
 * só então ouvia que o aparelho não está ativo. Trinta segundos é o intervalo
 * de quem tira um tablet de circulação e espera que ele obedeça enquanto ainda
 * está com ele na mão.
 */
const INTERVALO_VINCULADO_MS = 30_000;

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
          await saveDeviceLabel(registro.storeName ?? "", registro.deviceName ?? "");

          setEstado({
            estado: "vinculado",
            storeName: registro.storeName ?? "",
            deviceName: registro.deviceName ?? "",
          });

          // Continua conferindo, mais devagar: o dono pode desvincular este
          // aparelho a qualquer momento, e o tablet precisa obedecer sem
          // depender de alguém reiniciar o aplicativo.
          timer = setTimeout(() => void anunciar(), INTERVALO_VINCULADO_MS);
          return;
        }

        // Chegou aqui sem vínculo. Se havia um guardado, ele acabou de deixar
        // de valer — o aparelho foi desvinculado, bloqueado ou removido.
        await limparIdentidadeDoAparelho();

        setEstado({
          estado: "aguardando",
          apelido: `${identidade.model} ····${identidade.hardwareId.slice(-4)}`,
        });

        timer = setTimeout(() => void anunciar(), INTERVALO_MS);
      } catch {
        if (!vivo) return;

        /**
         * Sem rede ou API fora.
         *
         * Um tablet JÁ VINCULADO não pode cair na tela de espera por causa
         * disso: a internet da loja oscila, e mandar a vendedora para "este
         * tablet ainda não tem loja" no meio de uma venda seria trocar um
         * problema de rede por um susto. Ele fica onde está e tenta de novo.
         *
         * Quem nunca foi vinculado continua esperando — é o estado correto
         * dele, com ou sem internet.
         */
        const guardado = await readDeviceLabel();

        if (guardado) {
          setEstado({
            estado: "vinculado",
            storeName: guardado.loja,
            deviceName: guardado.aparelho,
          });
        } else {
          setEstado({ estado: "aguardando", apelido: "" });
        }

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
