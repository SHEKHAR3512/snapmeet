// Copies the MediaPipe WASM runtime from node_modules into public/wasm so that it is
// bundled into the extension (never loaded from a CDN). Only the SIMD build is shipped;
// every Chrome version that supports MV3 supports WASM SIMD.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'wasm');
if (!existsSync(src)) {
  console.warn('[copy-wasm] @mediapipe/tasks-vision not installed yet; skipping');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log('[copy-wasm] copied MediaPipe vision WASM runtime to public/wasm');
