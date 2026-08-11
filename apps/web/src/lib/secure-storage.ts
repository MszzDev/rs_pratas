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

export async function readDeviceId(): Promise<string | null> {
  if (isNative) {
    const { value } = await Preferences.get({ key: DEVICE_ID_KEY });
    return value;
  }
  return localStorage.getItem(DEVICE_ID_KEY);
}
