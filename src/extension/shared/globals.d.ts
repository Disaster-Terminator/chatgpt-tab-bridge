import type {
  ContentBridgeGlobal,
  RuntimeMessage
} from "./types";

export {};

declare global {
  const chrome: ChromeNamespace;

  interface Window {
    ChatGptBridgeContent?: ContentBridgeGlobal;
  }

  interface GlobalThis {
    ChatGptBridgeContent?: ContentBridgeGlobal;
  }

  interface Element {
    focus(options?: FocusOptions): void;
  }

  interface ParentNode {
    getElementById(id: string): Element | null;
  }

  interface HTMLElement {
    innerText: string;
  }
}

export interface ChromeNamespace {
  action: {
    openPopup?: () => Promise<void>;
    setBadgeBackgroundColor?: (details: { color: string }) => Promise<void>;
    setBadgeText?: (details: { text: string }) => Promise<void>;
    setTitle?: (details: { title: string }) => Promise<void>;
  };
  runtime: ChromeRuntime;
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
  };
  tabs: ChromeTabsApi;
}

export interface ChromeRuntime {
  id: string;
  onInstalled: ChromeEvent<() => void>;
  onStartup: ChromeEvent<() => void>;
  onConnect: ChromeEvent<(port: ChromePort) => void>;
  onMessage: ChromeEvent<ChromeRuntimeMessageListener>;
  connect(connectInfo?: { name?: string }): ChromePort;
  sendMessage<T = unknown>(message: RuntimeMessage): Promise<T>;
}

export type ChromeRuntimeMessageListener = (
  message: RuntimeMessage,
  sender: ChromeMessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

export interface ChromePort {
  name: string;
  sender?: ChromeMessageSender;
  onDisconnect: ChromeEvent<() => void>;
  onMessage: ChromeEvent<(message: unknown) => void>;
  postMessage(message: unknown): void;
}

export interface ChromeMessageSender {
  tab?: ChromeTab;
}

export interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ChromeTabsApi {
  onRemoved: ChromeEvent<(tabId: number) => void>;
  onUpdated: ChromeEvent<(tabId: number, changeInfo: { url?: string }) => void>;
  get(tabId: number): Promise<ChromeTab>;
  query(queryInfo: { active?: boolean; currentWindow?: boolean; url?: string[] }): Promise<ChromeTab[]>;
  sendMessage<T = unknown>(tabId: number, message: RuntimeMessage): Promise<T>;
}

export interface ChromeTab {
  id?: number;
  title?: string;
  url?: string;
}

export interface ChromeEvent<TListener extends (...args: any[]) => any> {
  addListener(listener: TListener): void;
}
