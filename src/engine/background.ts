import { findVirtualBackground } from '../shared/backgrounds';
import type { BackgroundMode } from '../shared/settings';
import type { BackgroundSnapshot } from './renderer';

export const THUMB_W = 64;
export const THUMB_H = 36;

export interface CapturedBackground {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  deviceId: string | undefined;
  version: number;
  personFraction: number | null;
  /** Luma thumbnail (THUMB_W×THUMB_H, 0..1) for drift detection. */
  thumb: Float32Array;
}

export interface PipelineView {
  deviceId: string | undefined;
  sourceWidth: number;
  sourceHeight: number;
  outWidth: number;
  outHeight: number;
}

/**
 * Disappearance backgrounds. Captures stay in memory for the session only (never
 * persisted, never uploaded). A capture is stale when the device or aspect ratio changes.
 */
export class BackgroundStore {
  captured: CapturedBackground | null = null;
  custom: { bitmap: ImageBitmap; version: number } | null = null;
  drift = false;
  private version = 0;
  private cache = new Map<string, OffscreenCanvas>();

  setCaptured(c: Omit<CapturedBackground, 'version'>): void {
    this.captured?.bitmap.close();
    this.captured = { ...c, version: ++this.version };
    this.drift = false;
  }

  setCustom(bitmap: ImageBitmap): void {
    this.custom?.bitmap.close();
    this.custom = { bitmap, version: ++this.version };
    this.dropCache('custom:');
  }

  clearCaptured(): void {
    this.captured?.bitmap.close();
    this.captured = null;
    this.drift = false;
  }

  isStale(p: PipelineView | null): boolean {
    const c = this.captured;
    if (!c || !p || !p.sourceWidth) return false;
    if (c.deviceId && p.deviceId && c.deviceId !== p.deviceId) return true;
    return Math.abs(c.width / c.height - p.sourceWidth / p.sourceHeight) > 0.02;
  }

  available(mode: BackgroundMode, p: PipelineView | null): boolean {
    if (mode === 'virtual') return true;
    if (mode === 'custom') return this.custom !== null;
    return this.captured !== null && !this.isStale(p);
  }

  snapshotFor(mode: BackgroundMode, virtualId: string, p: PipelineView): BackgroundSnapshot | null {
    const w = p.outWidth;
    const h = p.outHeight;
    if (mode === 'captured') {
      const c = this.captured;
      if (!c || this.isStale(p)) return null;
      return { key: `captured:${c.version}`, source: c.bitmap };
    }
    if (mode === 'custom') {
      const c = this.custom;
      if (!c) return null;
      const key = `custom:${c.version}:${w}x${h}`;
      return { key, source: this.cached(key, w, h, (ctx) => drawCover(ctx, c.bitmap, w, h)) };
    }
    const bg = findVirtualBackground(virtualId);
    const key = `virtual:${bg.id}:${w}x${h}`;
    return { key, source: this.cached(key, w, h, (ctx) => bg.paint(ctx, w, h)) };
  }

  private cached(key: string, w: number, h: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): OffscreenCanvas {
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size >= 3) this.cache.clear();
      c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      if (ctx) paint(ctx);
      this.cache.set(key, c);
    }
    return c;
  }

  private dropCache(prefix: string): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  dispose(): void {
    this.clearCaptured();
    this.custom?.bitmap.close();
    this.custom = null;
    this.cache.clear();
  }
}

export function drawCover(ctx: OffscreenCanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number): void {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Mean absolute luma difference over pixels that are background in the current mask. */
export function backgroundDrift(
  live: Uint8ClampedArray,
  thumb: Float32Array,
  mask: { data: Uint8Array; width: number; height: number } | null,
): number | null {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < THUMB_H; y++) {
    for (let x = 0; x < THUMB_W; x++) {
      if (mask) {
        const mx = Math.min(mask.width - 1, Math.floor((x / THUMB_W) * mask.width));
        const my = Math.min(mask.height - 1, Math.floor((y / THUMB_H) * mask.height));
        if (mask.data[my * mask.width + mx]! > 64) continue;
      }
      const i = (y * THUMB_W + x) * 4;
      const l = (0.2126 * live[i]! + 0.7152 * live[i + 1]! + 0.0722 * live[i + 2]!) / 255;
      sum += Math.abs(l - thumb[y * THUMB_W + x]!);
      n++;
    }
  }
  return n >= THUMB_W * THUMB_H * 0.2 ? sum / n : null;
}

export function lumaThumb(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(THUMB_W * THUMB_H);
  for (let i = 0; i < out.length; i++) {
    out[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
  }
  return out;
}
