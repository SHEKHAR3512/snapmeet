import { createWorkerRuntime } from './worker-client';
import type { VisionRuntime, VisionRuntimeOptions } from './types';

type TTPolicy = { createScriptURL(url: string): unknown };
let policy: TTPolicy | null = null;

/**
 * Meet enforces Trusted Types, so `new Worker(url)` needs a TrustedScriptURL. This policy
 * only accepts blob URLs minted by this page for the vision worker.
 */
function trustedScriptUrl(url: string): string {
  const tt = (globalThis as unknown as { trustedTypes?: { createPolicy(name: string, rules: object): TTPolicy } }).trustedTypes;
  if (!tt) return url;
  policy ??= tt.createPolicy('snapmeet-vision', {
    createScriptURL: (u: string) => {
      if (u.startsWith(`blob:${location.origin}/`)) return u;
      throw new TypeError('SnapMeet: unexpected worker URL');
    },
  });
  return policy.createScriptURL(url) as string;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.text();
}

/**
 * Starts the vision worker inside the Meet page: the bundled MediaPipe loader and worker
 * code are fetched from the extension package (web-accessible to meet.google.com only),
 * concatenated into a same-origin blob, and started as a classic worker. No remote code.
 */
export async function createMeetWorkerRuntime(assetBase: string, opts: Omit<VisionRuntimeOptions, 'wasmLoaderUrl'>): Promise<VisionRuntime> {
  const [loader, worker] = await Promise.all([
    fetchText(`${assetBase}wasm/vision_wasm_internal.js`),
    fetchText(`${assetBase}vision-worker.js`),
  ]);
  const url = URL.createObjectURL(new Blob([loader, '\n;\n', worker], { type: 'text/javascript' }));
  try {
    const w = new Worker(trustedScriptUrl(url), { name: 'snapmeet-vision' });
    return await createWorkerRuntime(w, opts);
  } finally {
    URL.revokeObjectURL(url);
  }
}
