import type { MaskSnapshot } from '../engine/renderer';

/**
 * Converts raw person-confidence masks into a smoothed 8-bit mask plus cheap geometry.
 * Temporal smoothing is a modest exponential moving average: it reduces flicker without
 * adding much latency. Spatial feathering happens in the shaders (linear upsampling of
 * the small mask + smoothstep).
 */
export class MaskProcessor {
  private acc: Float32Array | null = null;
  private w = 0;
  private h = 0;
  private version = 0;
  private last: MaskSnapshot | null = null;

  constructor(private alpha = 0.65) {}

  get snapshot(): MaskSnapshot | null {
    return this.last;
  }

  reset(): void {
    this.acc = null;
    this.last = null;
  }

  update(conf: Float32Array, w: number, h: number, now: number): MaskSnapshot {
    if (!this.acc || this.w !== w || this.h !== h) {
      this.acc = new Float32Array(conf);
      this.w = w;
      this.h = h;
    } else {
      const a = this.alpha;
      const acc = this.acc;
      for (let i = 0; i < acc.length; i++) acc[i] = acc[i]! * (1 - a) + conf[i]! * a;
    }
    const acc = this.acc;
    const data = new Uint8Array(acc.length);
    let count = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = acc[i]!;
        data[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
        if (v > 0.5) {
          count++;
          sx += x;
          sy += y;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const coverage = count / (w * h);
    const hasPerson = count > 0;
    const bbox: [number, number, number, number] = hasPerson
      ? [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h]
      : [0.25, 0.15, 0.75, 1];
    const centroid: [number, number] = hasPerson ? [sx / count / w, sy / count / h] : [0.5, 0.5];
    const head: [number, number] = hasPerson ? [headX(acc, w, y0, y1, centroid[0]), bbox[1] + (bbox[3] - bbox[1]) * 0.14] : [0.5, 0.35];
    this.last = {
      data,
      width: w,
      height: h,
      version: ++this.version,
      at: now,
      info: { coverage, bbox, centroid, head },
    };
    return this.last;
  }
}

/** Mean x of person pixels in the top 15% of the person's vertical extent. */
function headX(acc: Float32Array, w: number, y0: number, y1: number, fallback: number): number {
  const limit = y0 + Math.max(1, Math.round((y1 - y0) * 0.15));
  let n = 0;
  let sx = 0;
  for (let y = y0; y <= limit; y++) {
    for (let x = 0; x < w; x++) {
      if (acc[y * w + x]! > 0.5) {
        n++;
        sx += x;
      }
    }
  }
  return n ? sx / n / w : fallback;
}

/** Fraction of pixels classified as person (used to warn when capturing the "empty" room). */
export function personFraction(conf: Float32Array): number {
  let n = 0;
  for (let i = 0; i < conf.length; i++) if (conf[i]! > 0.5) n++;
  return conf.length ? n / conf.length : 0;
}
