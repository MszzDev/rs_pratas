import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";

const REFRESH_TOKEN_KEY = "rs.refreshToken";
const DEVICE_ID_KEY = "rs.deviceId";

/**
 * Armazenamento do refresh token.
 *
 * No tablet (Capacitor) usa Preferences, que grava no armazenamento nativo do
 * app — isolado de outros aplicativos. Na web cai para sessionStorage em vez de
 * localStorage: o token morre ao fechar a aba, o que reduz a janela de um XSS
 * conseguir exfiltrá-lo. O access token nunca é persistido, só vive em memória.
 */
const isNative = Capacitor.isNativePlatform();

export async function saveRefreshToken(token: string): Promise<void> {
  if (isNative) {
    await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token });
    return;
  }
  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export async function readRefreshToken(): Promise<string | null> {
  if (isNative) {
    const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
    return value;
  }
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export async function clearRefreshToken(): Promise<void> {
  if (isNative) {
    await Preferences.remove({ key: REFRESH_TOKEN_KEY });
    return;
  }
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

/** O tablet guarda a qual dispositivo cadastrado ele corresponde. */
export async function saveDeviceId(deviceId: string): Promise<void> {
  if (isNative) {
    await Preferences.set({ key: DEVICE_ID_KEY, value: deviceId });
    return;
  }
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
}

const DEVICE_LABEL_KEY = "rs.deviceLabel";

/**
 * A que loja este tablet pertence, em texto.
 *
 * Guardado junto com o identificador para a tela de entrada poder dizer
 * "Quiosque Elis Maas · Balcão" antes de qualquer login. Quem chega para
 * trabalhar precisa reconhecer o aparelho como o da loja dele — e um tablet
 * que não diz onde está é um tablet que pode ser o da loja errada.
 */
export async function saveDeviceLabel(loja: string, aparelho: string): Promise<void> {
  const valor = JSON.stringify({ loja, aparelho });

  if (isNative) {
    await Preferences.set({ key: DEVICE_LABEL_KEY, value: valor });
    return;
  }
  localStorage.setItem(DEVICE_LABEL_KEY, valor);
}

export async function readDeviceLabel(): Promise<{ loja: string; aparelho: string } | null> {
  const valor = isNative
    ? (await Preferences.get({ key: DEVICE_LABEL_KEY })).value
    : localStorage.getItem(DEVICE_LABEL_KEY);

  if (!valor) return null;

  try {
    return JSON.parse(valor) as { loja: string; aparelho: string };
  } catch {
    return null;
  }
}

export async function readDeviceId(): Promise<string | null> {
  if (isNative) {
    const { value } = await Preferences.get({ key: DEVICE_ID_KEY });
    return value;
  }
  return localStorage.getItem(DEVICE_ID_KEY);
}
