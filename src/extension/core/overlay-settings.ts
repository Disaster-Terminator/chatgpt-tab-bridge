import { DEFAULT_OVERLAY_SETTINGS } from "./constants.js";
import type { OverlaySettings, OverlayPosition } from "../shared/types.js";

export function normalizeOverlaySettings(input: unknown): OverlaySettings {
  const position = normalizePosition((input as OverlaySettings | undefined)?.position);

  return {
    enabled: (input as OverlaySettings | undefined)?.enabled ?? DEFAULT_OVERLAY_SETTINGS.enabled,
    collapsed: (input as OverlaySettings | undefined)?.collapsed ?? DEFAULT_OVERLAY_SETTINGS.collapsed,
    position
  };
}

export function mergeOverlaySettings(
  current: unknown,
  patch: unknown
): OverlaySettings {
  return normalizeOverlaySettings({
    ...normalizeOverlaySettings(current),
    ...(patch as Partial<OverlaySettings>)
  });
}

export function normalizePosition(position: unknown): OverlayPosition | null {
  const pos = position as OverlayPosition | undefined;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    return null;
  }

  return {
    x: Math.max(0, Math.round(pos.x)),
    y: Math.max(0, Math.round(pos.y))
  };
}
