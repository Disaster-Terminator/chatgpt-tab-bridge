import type { UiLocale } from "../copy/bridge-copy.ts";
import { DEFAULT_UI_LOCALE } from "../copy/bridge-copy.ts";

export const UI_LOCALE_STORAGE_KEY = "chatgptBridgeUiLocale";

export function readUiLocale(): UiLocale {
  try {
    const raw = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (raw === "zh-CN" || raw === "en") {
      return raw;
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_UI_LOCALE;
}

export function writeUiLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable
  }
}

export function observeUiLocale(callback: (locale: UiLocale) => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === UI_LOCALE_STORAGE_KEY && event.newValue) {
      const value = event.newValue;
      if (value === "zh-CN" || value === "en") {
        callback(value);
      }
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
