/**
 * Main-thread fallback for Meet, used only if the vision worker cannot start. The service
 * worker injects the MediaPipe loader (`wasm/vision_wasm_internal.js`) and then this file
 * into the MAIN world; it registers the factory where the running engine can find it.
 */
import { createMainThreadRuntime } from './main-thread';
import { VISION_FACTORY_KEY, VISION_REGISTERED_EVENT, type VisionFactory } from './types';

const g = globalThis as unknown as Record<symbol, VisionFactory | undefined>;
if (!g[VISION_FACTORY_KEY]) {
  g[VISION_FACTORY_KEY] = createMainThreadRuntime;
}
window.dispatchEvent(new Event(VISION_REGISTERED_EVENT));
