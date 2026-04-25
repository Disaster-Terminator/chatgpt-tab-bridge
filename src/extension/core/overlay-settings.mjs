import { DEFAULT_OVERLAY_SETTINGS } from "./constants.mjs";

export function normalizeOverlaySettings(input) {
  const position = normalizePosition(input?.position);

  return {
    enabled: input?.enabled ?? DEFAULT_OVERLAY_SETTINGS.enabled,
    ambientEnabled: input?.ambientEnabled ?? DEFAULT_OVERLAY_SETTINGS.ambientEnabled,
    collapsed: input?.collapsed ?? DEFAULT_OVERLAY_SETTINGS.collapsed,
    position
  };
}

export function mergeOverlaySettings(current, patch) {
  return normalizeOverlaySettings({
    ...normalizeOverlaySettings(current),
    ...patch
  });
}

export function normalizePosition(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null;
  }

  return {
    x: Math.max(0, Math.round(position.x)),
    y: Math.max(0, Math.round(position.y))
  };
}
