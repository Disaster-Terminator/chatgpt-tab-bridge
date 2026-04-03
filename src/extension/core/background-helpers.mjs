export function shouldKeepBindingForUrlChange(binding, nextUrlInfo) {
  if (!binding?.urlInfo?.supported || !nextUrlInfo?.supported) {
    return false;
  }

  return binding.urlInfo.normalizedUrl === nextUrlInfo.normalizedUrl;
}

export function collectOverlaySyncTabIds(previousState, nextState) {
  const tabIds = new Set();

  for (const state of [previousState, nextState]) {
    if (!state?.bindings) {
      continue;
    }

    for (const role of ["A", "B"]) {
      const tabId = state.bindings[role]?.tabId;
      if (tabId) {
        tabIds.add(tabId);
      }
    }
  }

  return Array.from(tabIds);
}
