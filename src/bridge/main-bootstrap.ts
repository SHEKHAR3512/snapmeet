/**
 * MAIN-world entry, injected at document_start on https://meet.google.com/*.
 * Installs the camera wrapper before Meet's scripts run and waits for the isolated
 * controller to hand over a private MessagePort.
 */
import { Engine } from '../engine/engine';
import { createMeetWorkerRuntime } from '../vision/meet-loader';
import { VISION_FACTORY_KEY, VISION_REGISTERED_EVENT, type VisionFactory, type VisionRuntime } from '../vision/types';
import { installGetUserMediaWrapper } from './gum-wrapper';
import { CUSTOM_BACKGROUND, MAIN_READY, PROTOCOL, isHello, parseCommand, type EngineEvent } from './protocol';

const BOOTSTRAPPED = Symbol.for('snapmeet.bootstrapped');
const DEBUG_KEY = Symbol.for('snapmeet.debug');
const VISION_TIMEOUT_MS = 20_000;

type Globals = Record<symbol, unknown>;

function main(): void {
  const g = globalThis as unknown as Globals;
  if (g[BOOTSTRAPPED]) return;
  g[BOOTSTRAPPED] = true;

  let port: MessagePort | null = null;
  let assetBase: string | null = null;

  const emit = (ev: EngineEvent, transfer?: Transferable[]) => {
    if (port) port.postMessage(ev, transfer ?? []);
    else if (ev.type === 'background-preview') ev.bitmap.close();
  };

  const engine = new Engine({ emit, loadVision: () => loadVisionInMeet() });
  installGetUserMediaWrapper(engine);
  // Read-only counters for automated tests. Contains no frames, devices or meeting data.
  Object.defineProperty(g, DEBUG_KEY, { value: Object.freeze({ counters: () => engine.debugCounters() }) });

  window.addEventListener('message', onHello, true);
  window.postMessage({ kind: MAIN_READY, protocol: PROTOCOL }, location.origin);

  function onHello(e: MessageEvent): void {
    if (e.source !== window || e.origin !== location.origin || !isHello(e.data)) return;
    e.stopImmediatePropagation();
    const p = e.ports[0];
    if (!p || port) return;
    port = p;
    port.onmessage = onPortMessage;
    port.postMessage({ type: 'ack', id: 0, ok: true } satisfies EngineEvent);
    engine.markDirty();
  }

  function onPortMessage(e: MessageEvent): void {
    const data = e.data as { type?: unknown; id?: unknown; bitmap?: unknown } | null;
    const id = typeof data?.id === 'number' ? data.id : -1;
    if (data?.type === CUSTOM_BACKGROUND) {
      const r = engine.setCustomBackground(data.bitmap);
      port?.postMessage({ type: 'ack', id, ...r } satisfies EngineEvent);
      return;
    }
    const cmd = parseCommand(data);
    if (!cmd) {
      port?.postMessage({ type: 'ack', id, ok: false, error: 'invalid command' } satisfies EngineEvent);
      return;
    }
    if (cmd.type === 'config') assetBase = cmd.assetBase;
    const r = engine.handleCommand(cmd);
    port?.postMessage({ type: 'ack', id: cmd.id, ...r } satisfies EngineEvent);
  }

  /** Vision worker inside the page first; main-thread runtime (injected by the extension) as fallback. */
  async function loadVisionInMeet(): Promise<VisionRuntime> {
    const base = assetBase;
    if (!base) throw new Error('SnapMeet is not configured yet');
    const opts = {
      wasmBinaryUrl: `${base}wasm/vision_wasm_internal.wasm`,
      segmenterModelUrl: `${base}models/selfie_segmenter_landscape.tflite`,
      handModelUrl: `${base}models/hand_landmarker.task`,
    };
    try {
      return await createMeetWorkerRuntime(base, opts);
    } catch (e) {
      console.info('[SnapMeet] vision worker unavailable; falling back to the page thread:', (e as Error).message);
    }
    const factory = await waitForVisionFactory();
    return factory(opts);
  }

  function waitForVisionFactory(): Promise<VisionFactory> {
    const existing = g[VISION_FACTORY_KEY] as VisionFactory | undefined;
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener(VISION_REGISTERED_EVENT, onRegistered);
        reject(new Error('vision runtime injection timed out'));
      }, VISION_TIMEOUT_MS);
      function onRegistered(): void {
        const f = g[VISION_FACTORY_KEY] as VisionFactory | undefined;
        if (!f) return;
        clearTimeout(timer);
        window.removeEventListener(VISION_REGISTERED_EVENT, onRegistered);
        resolve(f);
      }
      window.addEventListener(VISION_REGISTERED_EVENT, onRegistered);
      emit({ type: 'need-vision' });
    });
  }
}

main();
