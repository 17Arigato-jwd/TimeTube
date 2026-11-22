/**
 * Lightweight cross-browser WebExtension API shim for Chrome MV3 and Firefox.
 * Works without external runtime dependencies.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawApi: any = (globalThis as any).browser ?? (globalThis as any).chrome;

export interface WebExtApi {
  storage: {
    local: {
      get<T = Record<string, unknown>>(keys: string | string[]): Promise<T>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void,
      ): void;
      removeListener(
        cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void,
      ): void;
    };
  };
  alarms: {
    create(name: string, alarmInfo: { when?: number; periodInMinutes?: number }): void;
    clear(name: string): Promise<boolean>;
    onAlarm: {
      addListener(cb: (alarm: { name: string }) => void): void;
    };
  };
  action?: {
    setBadgeText(details: { text: string }): Promise<void> | void;
    setBadgeBackgroundColor(details: { color: string }): Promise<void> | void;
  };
  tabs: {
    query(queryInfo: { url?: string | string[] }): Promise<Array<{ id?: number; url?: string }>>;
    sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
    onRemoved?: {
      addListener(cb: (tabId: number) => void): void;
    };
    onUpdated?: {
      addListener(cb: (tabId: number, changeInfo: { url?: string; status?: string }) => void): void;
    };
  };
  runtime: {
    getURL(path: string): string;
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | Promise<unknown> | void,
      ): void;
    };
    onInstalled?: {
      addListener(cb: () => void): void;
    };
    onStartup?: {
      addListener(cb: () => void): void;
    };
  };
}

export const webext: WebExtApi = rawApi;
