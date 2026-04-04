import type {
  ContentBridgeGlobal,
  RuntimeMessage
} from "./types";

declare global {
  const chrome: ChromeNamespace;

  interface Window {
    ChatGptBridgeContent?: ContentBridgeGlobal;
  }

  interface GlobalThis {
    ChatGptBridgeContent?: ContentBridgeGlobal;
  }
}

interface ChromeNamespace {
  action: {
    openPopup?: () => Promise<void>;
  };
  runtime: ChromeRuntime;
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
  };
  tabs: ChromeTabsApi;
}

interface ChromeRuntime {
  id: string;
  onInstalled: ChromeEvent<() => void>;
  onStartup: ChromeEvent<() => void>;
  onConnect: ChromeEvent<(port: ChromePort) => void>;
  onMessage: ChromeEvent<ChromeRuntimeMessageListener>;
  connect(connectInfo?: { name?: string }): ChromePort;
  sendMessage<T = unknown>(message: RuntimeMessage): Promise<T>;
}

type ChromeRuntimeMessageListener = (
  message: RuntimeMessage,
  sender: ChromeMessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void;

interface ChromePort {
  name: string;
  onDisconnect: ChromeEvent<() => void>;
  onMessage: ChromeEvent<(message: unknown) => void>;
  postMessage(message: unknown): void;
}

interface ChromeMessageSender {
  tab?: ChromeTab;
}

interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface ChromeTabsApi {
  onRemoved: ChromeEvent<(tabId: number) => void>;
  onUpdated: ChromeEvent<(tabId: number, changeInfo: { url?: string }) => void>;
  get(tabId: number): Promise<ChromeTab>;
  query(queryInfo: { active?: boolean; currentWindow?: boolean; url?: string[] }): Promise<ChromeTab[]>;
  sendMessage<T = unknown>(tabId: number, message: RuntimeMessage): Promise<T>;
}

interface ChromeTab {
  id?: number;
  title?: string;
  url?: string;
}

interface ChromeEvent<TListener extends (...args: any[]) => any> {
  addListener(listener: TListener): void;
}

export {};
