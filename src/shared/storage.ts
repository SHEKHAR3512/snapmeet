import { SETTINGS_STORAGE_KEY, applySettingsPatch, migrateSettings, type Settings } from './settings';

/**
 * Key/value storage: chrome.storage.local in extension contexts, localStorage when the
 * playground runs on the Vite dev server.
 */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  onChange(key: string, fn: (value: unknown) => void): () => void;
}

const hasChromeStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export function createKV(): KV {
  if (hasChromeStorage()) {
    return {
      async get<T>(key: string) {
        const r = await chrome.storage.local.get(key);
        return r[key] as T | undefined;
      },
      async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
      },
      onChange(key, fn) {
        const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
          if (area === 'local' && key in changes) fn(changes[key]!.newValue);
        };
        chrome.storage.onChanged.addListener(l);
        return () => chrome.storage.onChanged.removeListener(l);
      },
    };
  }
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  return {
    async get<T>(key: string) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? undefined : (JSON.parse(raw) as T);
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage unavailable: keep in-memory listeners informed anyway
      }
      for (const fn of listeners.get(key) ?? []) fn(value);
    },
    onChange(key, fn) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
  };
}

export class SettingsStore {
  private current: Settings | null = null;

  constructor(private kv: KV = createKV()) {}

  async load(): Promise<Settings> {
    this.current = migrateSettings(await this.kv.get(SETTINGS_STORAGE_KEY));
    return this.current;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const base = this.current ?? (await this.load());
    const next = applySettingsPatch(base, patch);
    this.current = next;
    await this.kv.set(SETTINGS_STORAGE_KEY, next);
    return next;
  }

  subscribe(fn: (s: Settings) => void): () => void {
    return this.kv.onChange(SETTINGS_STORAGE_KEY, (v) => {
      this.current = migrateSettings(v);
      fn(this.current);
    });
  }
}
