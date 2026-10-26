import type { Quality } from '../shared/settings';
import { QUALITY_LEVELS } from '../shared/settings';

export interface QualityPreset {
  /** Output height cap (the source aspect ratio is kept). */
  maxHeight: number;
  segIntervalMs: number;
  handIntervalMs: number;
}

/** Starting budgets, to be tuned from measurements (see docs/TEST_RESULTS.md). */
export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { maxHeight: 480, segIntervalMs: 100, handIntervalMs: 66 },
  medium: { maxHeight: 720, segIntervalMs: 70, handIntervalMs: 50 },
  high: { maxHeight: 1080, segIntervalMs: 60, handIntervalMs: 42 },
};

/** Fits the source into the preset, keeping aspect ratio and even dimensions. */
export function outputSize(srcW: number, srcH: number, q: Quality): { width: number; height: number } {
  const w0 = Math.max(2, srcW || 640);
  const h0 = Math.max(2, srcH || 480);
  const scale = Math.min(1, QUALITY_PRESETS[q].maxHeight / h0);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(w0 * scale), height: even(h0 * scale) };
}

/**
 * Automatic quality with hysteresis: steps down when the 95th-percentile frame cost
 * stays above budget for 4 s, steps up only after 20 s of comfortable headroom, and never
 * exceeds the user's chosen level. Changes are deferred while `locked` (active effect).
 */
export class AdaptiveQuality {
  private level: Quality;
  private overSince: number | null = null;
  private underSince: number | null = null;

  constructor(private ceiling: Quality) {
    this.level = ceiling;
  }

  get current(): Quality {
    return this.level;
  }

  setCeiling(q: Quality, auto: boolean): void {
    this.ceiling = q;
    if (!auto || rank(this.level) > rank(q)) this.level = q;
    this.overSince = this.underSince = null;
  }

  resetTimers(): void {
    this.overSince = this.underSince = null;
  }

  /** Returns the new level when it changed. */
  observe(p95FrameMs: number, budgetMs: number, now: number, locked: boolean): Quality | null {
    if (p95FrameMs > budgetMs) {
      this.underSince = null;
      this.overSince ??= now;
      if (!locked && now - this.overSince > 4000 && rank(this.level) > 0) {
        this.level = QUALITY_LEVELS[rank(this.level) - 1]!;
        this.overSince = null;
        return this.level;
      }
    } else if (p95FrameMs < budgetMs * 0.5) {
      this.overSince = null;
      this.underSince ??= now;
      if (!locked && now - this.underSince > 20_000 && rank(this.level) < rank(this.ceiling)) {
        this.level = QUALITY_LEVELS[rank(this.level) + 1]!;
        this.underSince = null;
        return this.level;
      }
    } else {
      this.overSince = this.underSince = null;
    }
    return null;
  }
}

function rank(q: Quality): number {
  return QUALITY_LEVELS.indexOf(q);
}
