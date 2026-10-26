import { createVisionCore } from './core';
import { HAND_INPUT_WIDTH, SEG_INPUT_WIDTH, drawScaled, type VisionRuntime, type VisionRuntimeOptions } from './types';

/** Fallback runtime: MediaPipe on the calling (page) thread. Inference blocks that thread. */
export async function createMainThreadRuntime(opts: VisionRuntimeOptions): Promise<VisionRuntime> {
  const core = await createVisionCore(opts);
  const segCanvas = new OffscreenCanvas(SEG_INPUT_WIDTH, 144);
  const handCanvas = new OffscreenCanvas(HAND_INPUT_WIDTH, 360);
  return {
    mode: 'main-thread',
    info: core.info,
    async segment(frame, ts) {
      try {
        return core.segment(drawScaled(segCanvas, SEG_INPUT_WIDTH, frame), ts);
      } finally {
        frame.close();
      }
    },
    ensureHands: () => core.ensureHands(),
    async detectHands(frame, ts) {
      try {
        return core.detectHands(drawScaled(handCanvas, HAND_INPUT_WIDTH, frame), ts);
      } finally {
        frame.close();
      }
    },
    close: () => core.close(),
  };
}
