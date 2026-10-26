import type { Quality } from '../shared/settings';
import { createFrameSource, createOutputSink, type FrameSource, type OutputSink } from './media-io';
import { outputSize } from './quality';
import { FrameRenderer, type RenderState } from './renderer';
import { drawSafeFrame } from './safe-frame';

export type FramePlan =
  | { kind: 'render'; state: RenderState; quality: Quality; lockSize: boolean }
  | { kind: 'safe'; quality: Quality }
  | { kind: 'paused' };

export interface PipelineHost {
  /** Per-frame decision (runs inference on the primary pipeline, advances the session). */
  prepare(p: VideoPipeline, frame: VideoFrame | HTMLVideoElement, width: number, height: number, now: number): FramePlan;
  onRendered(p: VideoPipeline, costMs: number, now: number): void;
  /** Returns what to transmit for this frame after a renderer failure. */
  onRenderFailure(p: VideoPipeline, error: unknown, now: number): 'safe' | 'passthrough';
  onFirstFrame(p: VideoPipeline): void;
  onStopped(p: VideoPipeline, reason: string): void;
}

let nextId = 1;

function paintBlack(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
}

/**
 * One physical camera track → processed output track. Owns the frame source, the GL
 * renderer and the output sink. Released (camera stopped) when every consumer track —
 * the returned track and its clones — has been stopped.
 */
export class VideoPipeline {
  readonly id = nextId++;
  readonly output: OutputSink;
  readonly frameSource: FrameSource;
  readonly consumers = new Set<MediaStreamTrack>();
  state: 'starting' | 'live' | 'stopped' = 'starting';
  stopReason: string | null = null;
  sourceWidth = 0;
  sourceHeight = 0;
  outWidth: number;
  outHeight: number;
  webgl: 'ok' | 'unsupported' | 'lost' = 'ok';
  lastError: string | null = null;
  private renderer: FrameRenderer | null = null;
  private rendererRetryAt = 0;
  private rendererFailures = 0;

  constructor(
    readonly source: MediaStreamTrack,
    private host: PipelineHost,
    quality: Quality,
    opts: { forceFallbackIO?: boolean } = {},
  ) {
    const s = source.getSettings();
    const size = outputSize(s.width ?? 640, s.height ?? 480, quality);
    this.outWidth = size.width;
    this.outHeight = size.height;
    this.output = createOutputSink(size.width, size.height, opts.forceFallbackIO);
    this.frameSource = createFrameSource(source, opts.forceFallbackIO);
  }

  get deviceId(): string | undefined {
    return this.source.getSettings().deviceId;
  }

  start(): void {
    this.frameSource.start(this.onFrame, () => this.stop('source-ended'));
  }

  /** True when every consumer is disabled (Meet may toggle `enabled` instead of stopping). */
  get allConsumersDisabled(): boolean {
    if (this.consumers.size === 0) return false;
    for (const t of this.consumers) if (t.enabled) return false;
    return true;
  }

  private onFrame = (frame: VideoFrame | HTMLVideoElement, width: number, height: number, ts: number): void => {
    if (this.state === 'stopped') return;
    const now = performance.now();
    this.sourceWidth = width;
    this.sourceHeight = height;
    const plan = this.host.prepare(this, frame, width, height, now);
    if (plan.kind === 'paused') {
      // Keep frames flowing (black) like a disabled native camera; a generator that stops
      // writing would leave receivers frozen on the last real frame.
      this.output.write2D(paintBlack, ts);
      return;
    }
    if (plan.kind === 'render' && !plan.lockSize) this.applySize(width, height, plan.quality);
    else if (plan.kind === 'safe') this.applySize(width, height, plan.quality);

    if (plan.kind === 'safe') {
      this.output.write2D(drawSafeFrame, ts);
    } else {
      const r = this.ensureRenderer(now);
      let ok = false;
      if (r) {
        try {
          r.render(frame, plan.state);
          this.output.writeCanvas(r.canvas, ts);
          ok = true;
        } catch (e) {
          this.dropRenderer(e, now);
        }
      }
      if (!ok) {
        const fallback = this.host.onRenderFailure(this, this.lastError ?? 'renderer unavailable', now);
        if (fallback === 'safe') this.output.write2D(drawSafeFrame, ts);
        else this.writePassthrough2D(frame, ts, plan.state.proof);
      }
    }
    if (this.state === 'starting') {
      this.state = 'live';
      this.host.onFirstFrame(this);
    }
    this.host.onRendered(this, performance.now() - now, now);
  };

  private applySize(srcW: number, srcH: number, q: Quality): void {
    const { width, height } = outputSize(srcW, srcH, q);
    if (width === this.outWidth && height === this.outHeight) return;
    this.outWidth = width;
    this.outHeight = height;
    this.output.resize(width, height);
    this.renderer?.resize(width, height);
  }

  private ensureRenderer(now: number): FrameRenderer | null {
    if (this.renderer && !this.renderer.isLost) return this.renderer;
    if (this.renderer?.isLost) this.dropRenderer(new Error('WebGL context lost'), now);
    if (now < this.rendererRetryAt) return null;
    try {
      this.renderer = new FrameRenderer(this.outWidth, this.outHeight);
      this.webgl = 'ok';
      return this.renderer;
    } catch (e) {
      this.lastError = String((e as Error)?.message ?? e);
      this.rendererFailures++;
      this.webgl = this.rendererFailures === 1 && /unavailable/i.test(this.lastError) ? 'unsupported' : 'lost';
      this.rendererRetryAt = now + Math.min(30_000, 2000 * this.rendererFailures);
      return null;
    }
  }

  private dropRenderer(e: unknown, now: number): void {
    this.lastError = String((e as Error)?.message ?? e);
    this.webgl = 'lost';
    this.rendererFailures++;
    this.rendererRetryAt = now + Math.min(30_000, 1000 * this.rendererFailures);
    try {
      this.renderer?.dispose();
    } catch {
      // already lost
    }
    this.renderer = null;
  }

  private writePassthrough2D(frame: VideoFrame | HTMLVideoElement, ts: number, gray: boolean): void {
    this.output.write2D((ctx, w, h) => {
      ctx.filter = gray ? 'grayscale(1)' : 'none';
      ctx.drawImage(frame, 0, 0, w, h);
      ctx.filter = 'none';
    }, ts);
  }

  /** Stops capture: frame source, renderer, output and the physical camera track. */
  stop(reason: string): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    this.stopReason = reason;
    this.frameSource.stop();
    this.output.close();
    try {
      this.renderer?.dispose();
    } catch {
      // ignore
    }
    this.renderer = null;
    this.source.stop();
    this.host.onStopped(this, reason);
  }
}
