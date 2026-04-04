import type { ChatGptUrlInfo } from "../shared/types.js";

const REGULAR_THREAD_RE = /^https:\/\/chatgpt\.com\/c\/([^/?#]+)(?:[/?#].*)?$/;
const PROJECT_THREAD_RE = /^https:\/\/chatgpt\.com\/g\/([^/?#]+)\/c\/([^/?#]+)(?:[/?#].*)?$/;

export function parseChatGptThreadUrl(rawUrl: unknown): ChatGptUrlInfo {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return unsupported(rawUrl, "empty_url");
  }

  const projectMatch = rawUrl.match(PROJECT_THREAD_RE);
  if (projectMatch) {
    return {
      supported: true,
      kind: "project",
      projectId: projectMatch[1],
      conversationId: projectMatch[2],
      normalizedUrl: `https://chatgpt.com/g/${projectMatch[1]}/c/${projectMatch[2]}`
    };
  }

  const regularMatch = rawUrl.match(REGULAR_THREAD_RE);
  if (regularMatch) {
    return {
      supported: true,
      kind: "regular",
      projectId: null,
      conversationId: regularMatch[1],
      normalizedUrl: `https://chatgpt.com/c/${regularMatch[1]}`
    };
  }

  return unsupported(rawUrl, "unsupported_thread_url");
}

function unsupported(rawUrl: unknown, reason: string): ChatGptUrlInfo {
  return {
    supported: false,
    kind: "unsupported",
    projectId: null,
    conversationId: null,
    normalizedUrl: rawUrl ?? null,
    reason
  };
}
