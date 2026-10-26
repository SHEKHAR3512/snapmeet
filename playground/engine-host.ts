import type { Command, EngineEvent } from '../src/bridge/protocol';
import { CatalogStore } from '../src/catalog/store';
import { Engine } from '../src/engine/engine';
import { decodeCustomImage } from '../src/shared/image';
import { createKV, SettingsStore } from '../src/shared/storage';
import type { Settings } from '../src/shared/settings';
import { UiStore, type ControllerApi } from '../src/ui/state';
import { createMainThreadRuntime } from '../src/vision/main-thread';
import type { VisionRuntime } from '../src/vision/types';
import { createSplitWorkerRuntime } from '../src/vision/worker-client';

/**
 * Playground wiring: the same Engine as in Meet, driven directly (no MAIN-world bridge).
 * Assets resolve relative to the page so this works both as an extension page and on the
 * Vite dev server (which serves public/).
 */
export const version =
  typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '0.1.0';
const base = new URL('.', location.href).href;

type GestureListener = (ev: Extract<EngineEvent, { type: 'gesture' }>) => void;
const gestureListeners = new Set<GestureListener>();
export function onGesture(fn: GestureListener): () => void {
  gestureListeners.add(fn);
  return () => gestureListeners.delete(fn);
}

export const store = new UiStore();
const visionOpts = {
  wasmLoaderUrl: `${base}wasm/vision_wasm_internal.js`,
  wasmBinaryUrl: `${base}wasm/vision_wasm_internal.wasm`,
  segmenterModelUrl: `${base}models/selfie_segmenter_landscape.tflite`,
  handModelUrl: `${base}models/hand_landmarker.task`,
      faceModelUrl: `${base}models/face_landmarker.task`,
      poseModelUrl: `${base}models/pose_landmarker_lite.task`,
};

/** Worker first (the built extension ships vision-worker.js); main thread otherwise (e.g. Vite dev). */
async function loadVision(): Promise<VisionRuntime> {
  try {
    return await createSplitWorkerRuntime(() => new Worker(`${base}vision-worker.js`, { name: 'snapmeet-vision' }), visionOpts);
  } catch (e) {
    console.info('[SnapMeet] vision worker unavailable, using main thread:', (e as Error).message);
    return createMainThreadRuntime(visionOpts);
  }
}

export const engine = new Engine({
  loadVision,
  emit: (ev) => {
    if (ev.type === 'gesture') for (const fn of gestureListeners) fn(ev);
    store.applyEngineEvent(ev);
  },
});

const kv = createKV();
const settingsStore = new SettingsStore(kv);
const catalog = new CatalogStore(kv, version);
let nextId = 1;

function apply(s: Settings): void {
  store.set({ settings: s });
  // The playground always processes, independent of the Meet on/off switch.
  engine.configure({ ...s, enabled: true }, store.get().definitions, version);
}

export async function initEngineHost(): Promise<void> {
  store.set({ definitions: await catalog.definitions(), connected: true });
  apply(await settingsStore.load());
  settingsStore.subscribe(apply);
}

export const api: ControllerApi = {
  context: 'playground',
  store,
  command: async (cmd) => engine.handleCommand({ ...cmd, id: nextId++ } as Command),
  async updateSettings(patch) {
    apply(await settingsStore.update(patch));
  },
  async setCustomBackground(file) {
    const r = await decodeCustomImage(file);
    if (!r.ok) return r;
    const a = engine.setCustomBackground(r.bitmap);
    if (a.ok) await api.updateSettings({ backgroundMode: 'custom' });
    return a;
  },
};
