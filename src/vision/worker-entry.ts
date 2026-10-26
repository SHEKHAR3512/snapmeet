/**
 * Dedicated worker running MediaPipe off the page's main thread.
 * In Meet it is started from a blob whose first part is the MediaPipe loader (so
 * `ModuleFactory` already exists); on extension pages it is a normal worker file and
 * MediaPipe loads the loader itself. Frames arrive as transferred VideoFrames.
 */
import { createVisionCore, type VisionCore } from './core';
import { HAND_INPUT_WIDTH, SEG_INPUT_WIDTH, drawScaled } from './types';
import type { FromWorker, ToWorker } from './worker-protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(msg: FromWorker, transfer?: Transferable[]): void;
  close(): void;
};

let core: VisionCore | null = null;
const segCanvas = new OffscreenCanvas(SEG_INPUT_WIDTH, 144);
const handCanvas = new OffscreenCanvas(HAND_INPUT_WIDTH, 360);

scope.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      try {
        core = await createVisionCore(msg.opts);
        scope.postMessage({ type: 'ready', info: core.info });
      } catch (err) {
        scope.postMessage({ type: 'init-error', error: String((err as Error)?.message ?? err) });
      }
      return;
    case 'segment':
    case 'hands': {
      const { id, frame, ts } = msg;
      try {
        if (!core) throw new Error('vision not initialized');
        if (msg.type === 'segment') {
          const seg = core.segment(drawScaled(segCanvas, SEG_INPUT_WIDTH, frame), ts);
          scope.postMessage({ type: 'result', id, info: core.info, seg }, seg ? [seg.confidence.buffer] : []);
        } else {
          const hands = core.detectHands(drawScaled(handCanvas, HAND_INPUT_WIDTH, frame), ts);
          scope.postMessage({ type: 'result', id, info: core.info, hands });
        }
      } catch (err) {
        scope.postMessage({ type: 'error', id, error: String((err as Error)?.message ?? err) });
      } finally {
        frame.close();
      }
      return;
    }
    case 'ensure-hands':
      try {
        if (!core) throw new Error('vision not initialized');
        await core.ensureHands();
        scope.postMessage({ type: 'result', id: msg.id, info: core.info });
      } catch (err) {
        scope.postMessage({ type: 'error', id: msg.id, error: String((err as Error)?.message ?? err) });
      }
      return;
    case 'close':
      core?.close();
      core = null;
      scope.close();
  }
};
