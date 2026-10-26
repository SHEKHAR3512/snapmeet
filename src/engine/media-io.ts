/**
 * Frame input/output adapters.
 *
 * Preferred path (Chrome "breakout box"): MediaStreamTrackProcessor reads camera frames
 * and MediaStreamTrackGenerator emits processed frames. The loop is driven by camera
 * frames rather than requestAnimationFrame, which is expected to keep running in hidden
 * tabs (to be measured — see docs/FEASIBILITY.md).
 * Fallback: <video> + requestVideoFrameCallback in, canvas.captureStream() out.
 */
interface ProcessorCtor {
  new (init: { track: MediaStreamTrack; maxBufferSize?: number }): { readable: ReadableStream<VideoFrame> };
}
interface GeneratorCtor {
  new (init: { kind: 'video' }): MediaStreamTrack & { writable: WritableStream<VideoFrame> };
}
const g = globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorCtor; MediaStreamTrackGenerator?: GeneratorCtor };

export const hasProcessor = () => typeof g.MediaStreamTrackProcessor === 'function';
export const hasGenerator = () => typeof g.MediaStreamTrackGenerator === 'function';

export type FrameCallback = (frame: VideoFrame | HTMLVideoElement, width: number, height: number, timestampUs: number) => void;

export interface FrameSource {
  readonly kind: 'track-processor' | 'video-element';
  start(onFrame: FrameCallback, onEnded: () => void): void;
  stop(): void;
}

export function createFrameSource(track: MediaStreamTrack, forceFallback = false): FrameSource {
  return hasProcessor() && !forceFallback ? new ProcessorSource(track) : new VideoElementSource(track);
}

class ProcessorSource implements FrameSource {
  readonly kind = 'track-processor' as const;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private running = false;

  constructor(private track: MediaStreamTrack) {}

  start(onFrame: FrameCallback, onEnded: () => void): void {
    const proc = new g.MediaStreamTrackProcessor!({ track: this.track, maxBufferSize: 2 });
    this.reader = proc.readable.getReader();
    this.running = true;
    void (async () => {
      try {
        while (this.running) {
          const r = await this.reader!.read();
          if (r.done) break;
          const frame = r.value;
          try {
            if (this.running) onFrame(frame, frame.displayWidth, frame.displayHeight, frame.timestamp);
          } finally {
            frame.close();
          }
        }
      } catch {
        // reader cancelled or track ended
      }
      if (this.running) {
        this.running = false;
        onEnded();
      }
    })();
  }

  stop(): void {
    this.running = false;
    this.reader?.cancel().catch(() => {});
    this.reader = null;
  }
}

class VideoElementSource implements FrameSource {
  readonly kind = 'video-element' as const;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private track: MediaStreamTrack) {}

  start(onFrame: FrameCallback, onEnded: () => void): void {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([this.track]);
    this.video = video;
    this.running = true;
    const step = () => {
      if (!this.running) return;
      if (this.track.readyState === 'ended') {
        this.running = false;
        onEnded();
        return;
      }
      if (video.readyState >= 2 && video.videoWidth > 0) {
        onFrame(video, video.videoWidth, video.videoHeight, Math.round(performance.now() * 1000));
      }
      schedule();
    };
    const schedule = () => {
      // rVFC pauses in hidden tabs; fall back to (throttled) timers there.
      if (document.visibilityState === 'visible' && 'requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(() => step());
      } else {
        this.timer = setTimeout(step, 33);
      }
    };
    video.play().then(schedule, () => schedule());
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
  }
}

export interface OutputSink {
  readonly kind: 'track-generator' | 'canvas-capture';
  readonly track: MediaStreamTrack;
  dropped: number;
  resize(width: number, height: number): void;
  /** Emits the current contents of a rendered canvas. */
  writeCanvas(canvas: OffscreenCanvas, timestampUs: number): void;
  /** Paints with Canvas 2D (safe frame / passthrough fallback) and emits it. */
  write2D(paint: (ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => void, timestampUs: number): void;
  close(): void;
}

export function createOutputSink(width: number, height: number, forceFallback = false): OutputSink {
  return hasGenerator() && !forceFallback ? new GeneratorSink(width, height) : new CanvasSink(width, height);
}

class GeneratorSink implements OutputSink {
  readonly kind = 'track-generator' as const;
  readonly track: MediaStreamTrack;
  dropped = 0;
  private writer: WritableStreamDefaultWriter<VideoFrame>;
  private scratch: OffscreenCanvas;
  private ctx2d: OffscreenCanvasRenderingContext2D;
  private lastTs = -1;
  private closed = false;

  constructor(width: number, height: number) {
    const gen = new g.MediaStreamTrackGenerator!({ kind: 'video' });
    this.track = gen;
    this.writer = gen.writable.getWriter();
    this.scratch = new OffscreenCanvas(width, height);
    const ctx = this.scratch.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx2d = ctx;
  }

  resize(width: number, height: number): void {
    this.scratch.width = width;
    this.scratch.height = height;
  }

  writeCanvas(canvas: OffscreenCanvas, timestampUs: number): void {
    if (this.closed) return;
    // Bounded: never queue more than one pending frame.
    if (this.writer.desiredSize !== null && this.writer.desiredSize <= 0) {
      this.dropped++;
      return;
    }
    const ts = Math.max(timestampUs, this.lastTs + 1);
    this.lastTs = ts;
    const frame = new VideoFrame(canvas, { timestamp: ts });
    this.writer.write(frame).catch(() => {
      // Writing to a stopped generator: the frame is closed by the stream.
    });
  }

  write2D(paint: (ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => void, timestampUs: number): void {
    paint(this.ctx2d, this.scratch.width, this.scratch.height);
    this.writeCanvas(this.scratch, timestampUs);
  }

  close(): void {
    this.closed = true;
    this.writer.close().catch(() => {});
  }
}

class CanvasSink implements OutputSink {
  readonly kind = 'canvas-capture' as const;
  readonly track: MediaStreamTrack;
  dropped = 0;
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx2d = ctx;
    const track = this.canvas.captureStream().getVideoTracks()[0];
    if (!track) throw new Error('captureStream produced no track');
    this.track = track;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  writeCanvas(canvas: OffscreenCanvas): void {
    this.ctx2d.drawImage(canvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  write2D(paint: (ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => void): void {
    paint(this.ctx2d as unknown as OffscreenCanvasRenderingContext2D, this.canvas.width, this.canvas.height);
  }

  close(): void {}
}
