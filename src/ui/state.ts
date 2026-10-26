import { useSyncExternalStore } from 'react';
import type { Command, Diagnostics, EngineEvent, EngineStatus } from '../bridge/protocol';
import type { EffectDefinition } from '../catalog/schema';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
}

export interface UiState {
  connected: boolean;
  settings: Settings;
  definitions: EffectDefinition[];
  status: EngineStatus | null;
  diagnostics: Diagnostics | null;
  notices: Notice[];
  bgPreview: { bitmap: ImageBitmap; personVisible: boolean } | null;
  lastGesture: { gesture: string; detail?: string; at: number } | null;
  /** UI-only: which dock tab to show (e.g. jump to Setup on "needs-setup"). */
  requestedTab: string | null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<Command, 'id'>;

/** What the UI can do. Implemented by the Meet content controller and the playground. */
export interface ControllerApi {
  readonly context: 'meet' | 'playground';
  store: UiStore;
  command(cmd: CommandInput): Promise<{ ok: boolean; error?: string }>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  setCustomBackground(file: File): Promise<{ ok: boolean; error?: string }>;
}

export class UiStore {
  private state: UiState = {
    connected: false,
    settings: { ...DEFAULT_SETTINGS },
    definitions: [],
    status: null,
    diagnostics: null,
    notices: [],
    bgPreview: null,
    lastGesture: null,
    requestedTab: null,
  };
  private listeners = new Set<() => void>();
  private nextNotice = 1;

  get = (): UiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  pushNotice(n: Omit<Notice, 'id'>): void {
    // Replace a notice with the same code instead of stacking duplicates.
    const notices = [...this.state.notices.filter((x) => x.code !== n.code), { ...n, id: this.nextNotice++ }].slice(-3);
    this.set({ notices, requestedTab: n.code === 'needs-setup' ? 'setup' : this.state.requestedTab });
  }

  dismissNotice(id: number): void {
    this.set({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  /** Applies an engine event. Returns false for events the caller must handle itself. */
  applyEngineEvent(ev: EngineEvent): boolean {
    switch (ev.type) {
      case 'status':
        this.set({ status: ev.status });
        return true;
      case 'diagnostics':
        this.set({ diagnostics: ev.diagnostics });
        return true;
      case 'notice':
        this.pushNotice({ level: ev.level, code: ev.code, message: ev.message });
        return true;
      case 'gesture':
        this.set({ lastGesture: { gesture: ev.gesture, detail: ev.detail, at: Date.now() } });
        return true;
      case 'background-preview':
        this.state.bgPreview?.bitmap.close();
        this.set({ bgPreview: { bitmap: ev.bitmap, personVisible: ev.personVisible } });
        return true;
      default:
        return false;
    }
  }
}

export function useUi(store: UiStore): UiState {
  return useSyncExternalStore(store.subscribe, store.get);
}
