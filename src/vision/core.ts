import { HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { HandObservation, HandsSample } from '../gestures/landmarks';
import type { SegmentationOutput, VisionInfo, VisionRuntimeOptions } from './types';

/** Synchronous MediaPipe tasks. Runs on whichever thread created it (worker or page). */
export interface VisionCore {
  readonly info: VisionInfo;
  segment(input: OffscreenCanvas, timestampMs: number): SegmentationOutput | null;
  ensureHands(): Promise<void>;
  detectHands(input: OffscreenCanvas, timestampMs: number): HandsSample | null;
  close(): void;
}

type ModuleFactoryHost = { ModuleFactory?: unknown };

/**
 * MediaPipe Tasks Vision wrapper.
 *
 * Loader note: MediaPipe normally loads `vision_wasm_internal.js` itself (a <script>
 * element on a page, importScripts in a worker), which Google Meet's Trusted Types policy
 * rejects. In Meet the loader is provided up front — concatenated into the worker blob,
 * or injected as an extension script for the main-thread fallback — and an empty loader
 * path makes MediaPipe use the existing global `ModuleFactory`. MediaPipe clears that
 * global after each task is created, so it is restored before every create.
 */
export async function createVisionCore(opts: VisionRuntimeOptions): Promise<VisionCore> {
  const host = globalThis as unknown as ModuleFactoryHost;
  const preloadedFactory = opts.wasmLoaderUrl ? undefined : host.ModuleFactory;
  if (!opts.wasmLoaderUrl && typeof preloadedFactory !== 'function') {
    throw new Error('MediaPipe loader not present (ModuleFactory missing)');
  }
  const fileset = { wasmLoaderPath: opts.wasmLoaderUrl ?? '', wasmBinaryPath: opts.wasmBinaryUrl };
  const prepare = () => {
    if (preloadedFactory) host.ModuleFactory = preloadedFactory;
  };

  // Tasks are created sequentially: they share the loader globals.
  let delegate: 'GPU' | 'CPU' = opts.preferGpu === false ? 'CPU' : 'GPU';
  const createSegmenter = (d: 'GPU' | 'CPU') => {
    prepare();
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.segmenterModelUrl, delegate: d },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  };
  let segmenter: ImageSegmenter;
  try {
    segmenter = await createSegmenter(delegate);
  } catch (e) {
    if (delegate === 'CPU') throw e;
    delegate = 'CPU';
    segmenter = await createSegmenter(delegate);
  }

  const labels = safeLabels(segmenter);
  let hands: HandLandmarker | null = null;
  let handsLoading: Promise<void> | null = null;
  let lastSegTs = -1;
  let lastHandTs = -1;
  const info: VisionInfo = {
    delegate,
    segmenterLabels: labels,
    personMaskIndex: -1,
    personMaskRule: 'unresolved',
    handsLoaded: false,
  };

  const resolvePersonIndex = (count: number) => {
    const byLabel = labels.findIndex((l) => /person|selfie|human|foreground/i.test(l));
    if (byLabel >= 0 && byLabel < count) {
      info.personMaskIndex = byLabel;
      info.personMaskRule = `label "${labels[byLabel]}"`;
    } else if (count === 1) {
      info.personMaskIndex = 0;
      info.personMaskRule = 'single confidence mask';
    } else {
      // Two-class selfie models order classes as [background, person].
      info.personMaskIndex = Math.min(1, count - 1);
      info.personMaskRule = `assumed [background, person] of ${count}`;
    }
  };

  return {
    info,
    segment(input, timestampMs): SegmentationOutput | null {
      const ts = Math.max(timestampMs, lastSegTs + 0.01);
      lastSegTs = ts;
      const result = segmenter.segmentForVideo(input, ts);
      try {
        const masks = result.confidenceMasks;
        if (!masks?.length) return null;
        if (info.personMaskIndex < 0) resolvePersonIndex(masks.length);
        const mask = masks[info.personMaskIndex];
        if (!mask) return null;
        return { confidence: new Float32Array(mask.getAsFloat32Array()), width: mask.width, height: mask.height };
      } finally {
        result.close();
      }
    },
    ensureHands(): Promise<void> {
      handsLoading ??= (async () => {
        prepare();
        hands = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: opts.handModelUrl, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        info.handsLoaded = true;
      })();
      return handsLoading;
    },
    detectHands(input, timestampMs): HandsSample | null {
      if (!hands) return null;
      const ts = Math.max(timestampMs, lastHandTs + 0.01);
      lastHandTs = ts;
      const r = hands.detectForVideo(input, ts);
      const out: HandObservation[] = [];
      r.landmarks.forEach((lm, i) => {
        const cat = r.handedness[i]?.[0];
        if (!cat) return;
        out.push({
          landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          handedness: cat.categoryName === 'Left' ? 'Left' : 'Right',
          score: cat.score,
        });
      });
      return { t: timestampMs, hands: out };
    },
    close(): void {
      segmenter.close();
      (hands as HandLandmarker | null)?.close();
      hands = null;
    },
  };
}

function safeLabels(s: ImageSegmenter): string[] {
  try {
    return s.getLabels().slice(0, 16);
  } catch {
    return [];
  }
}
