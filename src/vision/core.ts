import { FaceLandmarker, HandLandmarker, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
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
  let segmenter: ImageSegmenter | null = null;
  if (opts.taskMode !== 'hands') try {
    segmenter = await createSegmenter(delegate);
  } catch (e) {
    if (delegate === 'CPU') throw e;
    delegate = 'CPU';
    segmenter = await createSegmenter(delegate);
  }

  let face: FaceLandmarker | null = null;
  if (opts.faceModelUrl && opts.taskMode !== 'hands') {
    try {
      prepare();
      face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: opts.faceModelUrl, delegate },
        runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (error) {
      try {
        prepare();
        face = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: opts.faceModelUrl, delegate: 'CPU' },
          runningMode: 'VIDEO', numFaces: 1,
        });
      } catch { console.warn('[SnapMeet] Face accessories unavailable:', error); }
    }
  }
  let pose: PoseLandmarker | null = null;
  if (opts.poseModelUrl && opts.taskMode !== 'hands') {
    const createPose = (d: 'GPU' | 'CPU') => {
      prepare();
      return PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: opts.poseModelUrl!, delegate: d },
        runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
      });
    };
    try { pose = await createPose(delegate); }
    catch { try { pose = await createPose('CPU'); } catch (error) { console.warn('[SnapMeet] Shoulder tracking unavailable:', error); } }
  }
  const labels = segmenter ? safeLabels(segmenter) : [];
  let hands: HandLandmarker | null = null;
  let handsLoading: Promise<void> | null = null;
  let closed = false;
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

  const core: VisionCore = {
    info,
    segment(input, timestampMs): SegmentationOutput | null {
      if (!segmenter) return null;
      const ts = Math.max(timestampMs, lastSegTs + 0.01);
      lastSegTs = ts;
      const result = segmenter.segmentForVideo(input, ts);
      try {
        const masks = result.confidenceMasks;
        if (!masks?.length) return null;
        if (info.personMaskIndex < 0) resolvePersonIndex(masks.length);
        const mask = masks[info.personMaskIndex];
        if (!mask) return null;
        const confidence = new Float32Array(mask.getAsFloat32Array());
        let points;
        try { points = face?.detectForVideo(input, ts).faceLandmarks[0]; }
        catch (error) { console.warn('[SnapMeet] Face tracking failed:', error); face?.close(); face = null; }
        let body = null;
        if (pose) {
          try {
            const result = pose.detectForVideo(input, ts);
            const shoulders = result.landmarks[0];
            const a = shoulders?.[12], b = shoulders?.[11];
            if (a && b && (a.visibility ?? 0) > 0.6 && (b.visibility ?? 0) > 0.6) {
              body = { shoulders: [(a.x + b.x) / 2, (a.y + b.y) / 2] as [number, number],
                width: Math.hypot((b.x - a.x) * input.width / input.height, b.y - a.y),
                rotation: -Math.atan2(b.y - a.y, (b.x - a.x) * input.width / input.height) };
            }
            result.close();
          } catch (error) { console.warn('[SnapMeet] Shoulder tracking failed:', error); pose.close(); pose = null; }
        }
        const left = points?.[33], right = points?.[263], chin = points?.[152], forehead = points?.[10];
        return { body, confidence, width: mask.width, height: mask.height,
          face: left && right && chin && forehead ? {
            eyes: [(left.x + right.x) / 2, (left.y + right.y) / 2],
            chin: [chin.x, chin.y], forehead: [forehead.x, forehead.y],
            width: Math.hypot((right.x - left.x) * input.width / input.height, right.y - left.y) * 1.48,
            height: Math.hypot((chin.x - forehead.x) * input.width / input.height, chin.y - forehead.y),
            rotation: -Math.atan2(right.y - left.y, (right.x - left.x) * input.width / input.height),
          } : null,
        };
      } finally {
        result.close();
      }
    },
    ensureHands(): Promise<void> {
      handsLoading ??= (async () => {
        const create = (d: 'GPU' | 'CPU') => {
          prepare();
          return HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: opts.handModelUrl, delegate: d },
            runningMode: 'VIDEO', numHands: 2,
            minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        };
        try { hands = await create(delegate); }
        catch (error) { if (delegate === 'CPU') throw error; hands = await create('CPU'); }
        if (closed) { hands.close(); hands = null; return; }
        info.handsLoaded = true;
      })().catch(error => { handsLoading = null; throw error; });
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
      closed = true;
      face?.close();
      pose?.close();
      segmenter?.close();
      (hands as HandLandmarker | null)?.close();
      hands = null;
    },
  };
  if (opts.taskMode === 'hands') await core.ensureHands();
  return core;
}

function safeLabels(s: ImageSegmenter): string[] {
  try {
    return s.getLabels().slice(0, 16);
  } catch {
    return [];
  }
}
