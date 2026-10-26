import type { HandsSample } from '../gestures/landmarks';

export interface VisionInfo {
  delegate: 'GPU' | 'CPU';
  segmenterLabels: string[];
  /** Index of the person confidence mask, resolved from labels or mask count. */
  personMaskIndex: number;
  personMaskRule: string;
  handsLoaded: boolean;
}

export interface SegmentationOutput {
  confidence: Float32Array;
  width: number;
  height: number;
}

/**
 * Local person segmentation and hand landmarks. Never uploads frames.
 * Inputs are VideoFrames whose ownership passes to the runtime (it closes them).
 * At most one request per model should be in flight; callers drop frames while busy.
 */
export interface VisionRuntime {
  readonly mode: 'worker' | 'main-thread';
  readonly info: VisionInfo;
  segment(frame: VideoFrame, timestampMs: number): Promise<SegmentationOutput | null>;
  ensureHands(): Promise<void>;
  detectHands(frame: VideoFrame, timestampMs: number): Promise<HandsSample | null>;
  close(): void;
}

export interface VisionRuntimeOptions {
  /** URL of vision_wasm_internal.wasm. */
  wasmBinaryUrl: string;
  /**
   * URL of vision_wasm_internal.js. Omit when the loader is already present as the global
   * `ModuleFactory` (Meet: Trusted Types forbid MediaPipe's own script loading).
   */
  wasmLoaderUrl?: string;
  segmenterModelUrl: string;
  handModelUrl: string;
  preferGpu?: boolean;
}

/** Inference input sizes (width; height follows the source aspect ratio). */
export const SEG_INPUT_WIDTH = 256;
export const HAND_INPUT_WIDTH = 640;

export const VISION_FACTORY_KEY = Symbol.for('snapmeet.vision.factory');
export const VISION_REGISTERED_EVENT = 'snapmeet:vision-registered';

export type VisionFactory = (opts: VisionRuntimeOptions) => Promise<VisionRuntime>;

/** Downscales a frame into a reusable canvas (fixed width, aspect kept). */
export function drawScaled(c: OffscreenCanvas, width: number, frame: VideoFrame): OffscreenCanvas {
  const srcW = frame.displayWidth || 1;
  const srcH = frame.displayHeight || 1;
  const h = Math.max(2, Math.round((width * srcH) / srcW));
  if (c.width !== width || c.height !== h) {
    c.width = width;
    c.height = h;
  }
  c.getContext('2d')?.drawImage(frame, 0, 0, width, h);
  return c;
}
