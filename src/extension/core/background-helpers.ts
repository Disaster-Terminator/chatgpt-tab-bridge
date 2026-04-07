import type { ChatGptUrlInfo, RuntimeBinding, RuntimeState } from "../shared/types.js";

interface BindingWithUrlInfo {
  urlInfo: ChatGptUrlInfo | null;
}

export function shouldKeepBindingForUrlChange(
  binding: BindingWithUrlInfo | null,
  nextUrlInfo: ChatGptUrlInfo | null
): boolean {
  if (!binding?.urlInfo?.supported) {
    return true;
  }

  if (!nextUrlInfo?.supported) {
    return false;
  }

  return binding.urlInfo.normalizedUrl === nextUrlInfo.normalizedUrl;
}

export function collectOverlaySyncTabIds(
  previousState: Pick<RuntimeState, "bindings"> | null,
  nextState: Pick<RuntimeState, "bindings"> | null
): number[] {
  const tabIds = new Set<number>();

  for (const state of [previousState, nextState]) {
    if (!state?.bindings) {
      continue;
    }

    for (const role of ["A", "B"] as const) {
      const tabId = state.bindings[role]?.tabId;
      if (tabId !== undefined && tabId !== null) {
        tabIds.add(tabId);
      }
    }
  }

  return Array.from(tabIds);
}
