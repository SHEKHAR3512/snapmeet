import type { BodyAnchor, FaceAnchor } from '../vision/types';
import type { EffectDefinition, EffectTemplate } from '../catalog/schema';
import type { FullscreenQuad, RenderTarget } from '../engine/gl';
import type { EffectPhase } from '../session/session';
import type { Quality } from '../shared/settings';

export interface MaskInfo {
  /** Fraction of mask pixels classified as person. */
  coverage: number;
  /** Person bounding box in image space [x0, y0, x1, y1]. */
  bbox: [number, number, number, number];
  centroid: [number, number];
  /** Approximate head position (top of the person bounding box). */
  head: [number, number];
  ageMs: number;
}

export interface FrameInputs {
  face?: FaceAnchor | null;
  body?: BodyAnchor | null;
  hands?: Array<{ x: number; y: number; radius: number }>;
  /** Current camera frame (image space). */
  video: WebGLTexture;
  /** Latest smoothed person mask in the R channel, or null if unavailable. */
  mask: WebGLTexture | null;
  maskInfo: MaskInfo | null;
  /** Clean-room or virtual background, or null if not set up. */
  background: WebGLTexture | null;
  width: number;
  height: number;
}

export interface EffectFrame {
  now: number;
  /** ms since the effect started. */
  elapsed: number;
  phase: EffectPhase;
  phaseElapsed: number;
  phaseDurationMs: number | null;
  inputs: FrameInputs;
  reducedMotion: boolean;
  quality: Quality;
}

export interface EffectStart {
  definition: EffectDefinition;
  seed: number;
  inputs: FrameInputs;
  quality: Quality;
  reducedMotion: boolean;
}

/** Shared per-renderer GL resources handed to effects. */
export interface EffectContext {
  gl: WebGL2RenderingContext;
  quad: FullscreenQuad;
  /** 1×1 transparent texture to bind when an optional input is missing. */
  blank: WebGLTexture;
  /** Draws `src` (image-space texture) into the currently bound target unchanged. */
  copy(src: WebGLTexture): void;
  /** Allocates an offscreen target; the effect owns and must dispose it. */
  createTarget(w: number, h: number): RenderTarget;
  /** Binds the scene target (where effects draw the transmitted frame). */
  bindScene(): void;
}

/**
 * Renderer lifecycle: load (compile, once) → start (per trigger) → render (per frame)
 * → cancel (switch/reset) → dispose (pipeline teardown). `render` must draw the complete
 * frame into the bound scene target and must not allocate per-frame GPU resources.
 */
export interface EffectRenderer {
  readonly template: EffectTemplate;
  load(): void;
  start(run: EffectStart): void;
  render(frame: EffectFrame): void;
  cancel(): void;
  dispose(): void;
}

export type EffectFactory = (ctx: EffectContext) => EffectRenderer;
