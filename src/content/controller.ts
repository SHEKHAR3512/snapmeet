import { MEME_CUES } from '../catalog/meme-cues';
/**
 * Isolated-world content script (document_start on https://meet.google.com/*).
 * Owns extension storage, validated control messages to the MAIN-world engine, the
 * Shadow-DOM control dock and in-page keyboard shortcuts. Never touches video frames.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CUSTOM_BACKGROUND, HELLO, MAIN_READY, PROTOCOL, type EngineEvent } from '../bridge/protocol';
import { CatalogStore } from '../catalog/store';
import { decodeCustomImage } from '../shared/image';
import { createKV, SettingsStore } from '../shared/storage';
import type { Settings } from '../shared/settings';
import { Dock } from '../ui/dock/Dock';
import dockCss from '../ui/dock/dock.css?inline';
import { UiStore, type CommandInput, type ControllerApi } from '../ui/state';
import { matchShortcut, isEditableTarget, type ShortcutAction } from './shortcuts';

type Ack = { ok: boolean; error?: string };

const kv = createKV();
const settingsStore = new SettingsStore(kv);
const extensionVersion = chrome.runtime.getManifest().version;
const catalog = new CatalogStore(kv, extensionVersion);
const store = new UiStore();

let port: MessagePort | null = null;
let nextId = 1;
const pending = new Map<number, (a: Ack) => void>();

function send(cmd: CommandInput, transfer: Transferable[] = []): Promise<Ack> {
  if (!port) return Promise.resolve({ ok: false, error: 'SnapMeet engine not connected' });
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'timeout' });
    }, 5000);
    pending.set(id, (a) => {
      clearTimeout(timer);
      resolve(a);
    });
    port!.postMessage({ ...cmd, id }, transfer);
  });
}

async function sendConfig(): Promise<void> {
  const settings = store.get().settings;
  const definitions = store.get().definitions;
  await send({ type: 'config', settings, assetBase: chrome.runtime.getURL(''), extensionVersion, definitions });
}

function onEngineMessage(e: MessageEvent<EngineEvent>): void {
  const ev = e.data;
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'ack') {
    pending.get(ev.id)?.({ ok: ev.ok, error: ev.error });
    pending.delete(ev.id);
    return;
  }
  if (ev.type === 'need-audio') {
    if (!Object.hasOwn(MEME_CUES, ev.effectId)) return;
    void fetch(chrome.runtime.getURL(`audio/${ev.effectId}.mp3`)).then(async response => {
      if (!response.ok) throw new Error('Sound file unavailable');
      const bytes = await response.arrayBuffer();
      port?.postMessage({ type: 'audio-bytes', requestId: ev.requestId, bytes }, [bytes]);
    }).catch(() => port?.postMessage({ type: 'audio-bytes', requestId: ev.requestId, error: true }));
    return;
  }
  if (ev.type === 'need-vision') {
    chrome.runtime
      .sendMessage({ type: 'inject-vision' })
      .then((r: Ack | undefined) => send({ type: 'vision-injected', ok: !!r?.ok, ...(r?.error ? { error: r.error.slice(0, 300) } : {}) }))
      .catch((err: unknown) => send({ type: 'vision-injected', ok: false, error: String(err).slice(0, 300) }));
    return;
  }
  store.applyEngineEvent(ev);
  if (ev.type === 'notice' && ev.code === 'needs-setup') ensureDockMounted(true);
}

// ── handshake: hand a private port to the MAIN world ──
function sayHello(): void {
  if (port) return;
  const ch = new MessageChannel();
  ch.port1.onmessage = (e: MessageEvent) => {
    if (port || e.data?.type !== 'ack' || e.data.id !== 0) return;
    port = ch.port1;
    port.onmessage = onEngineMessage;
    store.set({ connected: true });
    void sendConfig();
  };
  window.postMessage({ kind: HELLO, protocol: PROTOCOL }, location.origin, [ch.port2]);
}

// Settings must be loaded before the engine is configured (it gates camera wrapping).
let booted = false;
window.addEventListener('message', (e) => {
  if (booted && e.source === window && e.data?.kind === MAIN_READY && e.data.protocol === PROTOCOL) sayHello();
});

// ── dock ──
let dockRoot: Root | null = null;
let dockHost: HTMLElement | null = null;

const api: ControllerApi = {
  context: 'meet',
  store,
  command: (cmd) => send(cmd),
  async updateSettings(patch: Partial<Settings>) {
    const next = await settingsStore.update(patch);
    store.set({ settings: next });
  },
  async setCustomBackground(file: File) {
    const r = await decodeCustomImage(file);
    if (!r.ok) return r;
    if (!port) {
      r.bitmap.close();
      return { ok: false, error: 'SnapMeet engine not connected' };
    }
    const id = nextId++;
    const ack = await new Promise<Ack>((resolve) => {
      pending.set(id, resolve);
      port!.postMessage({ type: CUSTOM_BACKGROUND, id, bitmap: r.bitmap }, [r.bitmap]);
    });
    if (ack.ok) await api.updateSettings({ backgroundMode: 'custom' });
    return ack;
  },
};

function ensureDockMounted(force = false): void {
  const s = store.get().settings;
  const want = force || (s.enabled && s.showDock);
  if (!want) {
    dockRoot?.unmount();
    dockHost?.remove();
    dockRoot = null;
    dockHost = null;
    return;
  }
  if (!document.body) return;
  if (dockHost?.isConnected) return;
  // Meet is a single-page app; re-attach if our host was removed during navigation.
  dockRoot?.unmount();
  dockHost = document.createElement('snapmeet-dock');
  const shadow = dockHost.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(dockCss);
  shadow.adoptedStyleSheets = [sheet];
  const mount = document.createElement('div');
  shadow.appendChild(mount);
  document.documentElement.appendChild(dockHost);
  dockRoot = createRoot(mount);
  dockRoot.render(createElement(Dock, { api }));
}

// ── shortcuts (in-page + chrome.commands), de-duplicated ──
let lastAction: { action: ShortcutAction; at: number } | null = null;
function runShortcut(action: ShortcutAction): void {
  const now = Date.now();
  if (lastAction && lastAction.action === action && now - lastAction.at < 400) return;
  lastAction = { action, at: now };
  const s = store.get();
  switch (action) {
    case 'trigger-selected':
      void send({ type: 'trigger', effectId: s.settings.selectedEffectId });
      break;
    case 'reappear':
      void send({ type: 'reappear' });
      break;
    case 'reset-effects':
      void send({ type: 'reset' });
      break;
    case 'toggle-dock':
      if (!s.settings.showDock) void api.updateSettings({ showDock: true, dockCollapsed: false });
      else void api.updateSettings({ dockCollapsed: !s.settings.dockCollapsed });
      break;
  }
}

window.addEventListener(
  'keydown',
  (e) => {
    if (!store.get().settings.enabled || isEditableTarget(e)) return;
    const action = matchShortcut(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    runShortcut(action);
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: { type?: string; command?: ShortcutAction }, _sender, reply) => {
  if (msg?.type === 'command' && msg.command) {
    runShortcut(msg.command);
    reply({ ok: true });
  } else if (msg?.type === 'get-tab-status') {
    reply({ connected: store.get().connected, status: store.get().status, diagnostics: store.get().diagnostics });
    if (port) void send({ type: 'get-diagnostics' });
  } else if (msg?.type === 'open-dock') {
    void api.updateSettings({ showDock: true, dockCollapsed: false });
    ensureDockMounted(true);
    reply({ ok: true });
  }
  return false;
});

// ── boot ──
async function refreshCatalog(): Promise<void> {
  store.set({ definitions: await catalog.definitions() });
}

async function boot(): Promise<void> {
  const settings = await settingsStore.load();
  store.set({ settings });
  await refreshCatalog();
  booted = true;
  sayHello();
  settingsStore.subscribe((s) => {
    store.set({ settings: s });
    void sendConfig();
    ensureDockMounted();
  });
  kv.onChange('snapmeet.packs', () => void refreshCatalog().then(sendConfig));
  const mountWhenReady = () => ensureDockMounted();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountWhenReady, { once: true });
  else mountWhenReady();
  // Keep the dock attached across Meet's in-app navigation without stacking observers.
  setInterval(() => {
    if (dockHost && !dockHost.isConnected) ensureDockMounted();
  }, 2000);
}

void boot();
