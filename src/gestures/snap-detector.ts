import { LM, dist, inFrame, palmSize, type HandObservation, type HandsSample } from './landmarks';

/**
 * Experimental finger-snap heuristic over MediaPipe hand landmarks.
 *
 * A snap is recognized as:
 *   1. PRIMED  — thumb tip and middle-finger tip close together (normalized by palm size);
 *   2. RELEASE — within a short window, the thumb/middle distance opens quickly AND the
 *                middle finger curls into the palm (its tip moves toward the wrist).
 *
 * A sustained pinch that simply opens does not curl the middle finger and is rejected,
 * as is a slow release. One event per sequence, then a cooldown. Each hand is tracked
 * separately; tracking loss, low confidence, out-of-frame landmarks or identity jumps
 * reset that hand's state.
 */
export interface SnapDetectorConfig {
  /** 0 = strict, 1 = permissive. */
  sensitivity: number;
  /** Frame width / height, for aspect-correct distances. */
  aspect: number;
  cooldownMs?: number;
}

export interface SnapThresholds {
  close: number;
  open: number;
  curl: number;
  curlDrop: number;
  minSpeed: number;
  releaseWindowMs: number;
  maxGapMs: number;
  minScore: number;
  maxWristJump: number;
}

export function thresholdsFor(sensitivity: number): SnapThresholds {
  const s = Math.min(1, Math.max(0, sensitivity));
  const lerp = (a: number, b: number) => a + (b - a) * s;
  return {
    close: lerp(0.3, 0.46),
    open: lerp(0.78, 0.56),
    curl: lerp(0.92, 1.12),
    curlDrop: lerp(0.32, 0.18),
    minSpeed: lerp(5.5, 2.6),
    releaseWindowMs: lerp(200, 300),
    maxGapMs: 220,
    minScore: 0.5,
    maxWristJump: 0.3,
  };
}

export type SnapEvent =
  | { type: 'snap'; t: number; hand: 'Left' | 'Right' }
  | { type: 'near-miss'; t: number; hand: 'Left' | 'Right'; reason: 'slow-release' | 'no-curl' };

export interface SnapFeedback {
  tracked: boolean;
  primed: boolean;
  coolingDown: boolean;
  /** Smallest normalized thumb–middle distance among tracked hands (for UI meters). */
  closeness: number | null;
}

interface HandTrack {
  lastT: number;
  wristX: number;
  wristY: number;
  primedAt: number | null;
  lastPrimed: { t: number; d: number; curl: number } | null;
}

const REQUIRED = [LM.WRIST, LM.THUMB_TIP, LM.MIDDLE_MCP, LM.MIDDLE_TIP] as const;

export class SnapDetector {
  private tracks = new Map<'Left' | 'Right', HandTrack>();
  private cooldownUntil = -Infinity;
  private th: SnapThresholds;
  private feedback: SnapFeedback = { tracked: false, primed: false, coolingDown: false, closeness: null };

  constructor(private cfg: SnapDetectorConfig) {
    this.th = thresholdsFor(cfg.sensitivity);
  }

  configure(patch: Partial<SnapDetectorConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    this.th = thresholdsFor(this.cfg.sensitivity);
  }

  get thresholds(): Readonly<SnapThresholds> {
    return this.th;
  }

  get lastFeedback(): Readonly<SnapFeedback> {
    return this.feedback;
  }

  reset(): void {
    this.tracks.clear();
  }

  /** Feed one landmark sample; returns any recognized events. Timestamps must be monotonic. */
  push(sample: HandsSample): SnapEvent[] {
    const events: SnapEvent[] = [];
    const seen = new Set<'Left' | 'Right'>();
    let anyPrimed = false;
    let closeness: number | null = null;

    for (const hand of sample.hands) {
      if (seen.has(hand.handedness)) continue; // ambiguous duplicate label: keep first
      const m = this.measure(hand);
      if (!m) continue;
      seen.add(hand.handedness);
      closeness = closeness === null ? m.d : Math.min(closeness, m.d);
      const ev = this.step(hand.handedness, sample.t, m);
      if (ev) events.push(ev);
      if (this.tracks.get(hand.handedness)?.lastPrimed && m.d <= this.th.close) anyPrimed = true;
    }
    // Hands not observed in this sample: drop after the allowed gap.
    for (const [label, tr] of this.tracks) {
      if (!seen.has(label) && sample.t - tr.lastT > this.th.maxGapMs) this.tracks.delete(label);
    }
    this.feedback = {
      tracked: seen.size > 0,
      primed: anyPrimed,
      coolingDown: sample.t < this.cooldownUntil,
      closeness,
    };
    return events;
  }

  private measure(hand: HandObservation): { d: number; curl: number; wristX: number; wristY: number } | null {
    const lm = hand.landmarks;
    if (hand.score < this.th.minScore || lm.length < 21 || !inFrame(lm, REQUIRED)) return null;
    const palm = palmSize(lm, this.cfg.aspect);
    if (palm < 0.035) return null; // hand too small/far to measure reliably
    return {
      d: dist(lm[LM.THUMB_TIP]!, lm[LM.MIDDLE_TIP]!, this.cfg.aspect) / palm,
      curl: dist(lm[LM.MIDDLE_TIP]!, lm[LM.WRIST]!, this.cfg.aspect) / palm,
      wristX: lm[LM.WRIST]!.x,
      wristY: lm[LM.WRIST]!.y,
    };
  }

  private step(
    label: 'Left' | 'Right',
    t: number,
    m: { d: number; curl: number; wristX: number; wristY: number },
  ): SnapEvent | null {
    let tr = this.tracks.get(label);
    const jumped =
      tr && Math.hypot((m.wristX - tr.wristX) * this.cfg.aspect, m.wristY - tr.wristY) > this.th.maxWristJump;
    if (!tr || jumped || t - tr.lastT > this.th.maxGapMs) {
      tr = { lastT: t, wristX: m.wristX, wristY: m.wristY, primedAt: null, lastPrimed: null };
      this.tracks.set(label, tr);
    }
    tr.lastT = t;
    tr.wristX = m.wristX;
    tr.wristY = m.wristY;

    if (m.d <= this.th.close) {
      tr.primedAt ??= t;
      tr.lastPrimed = { t, d: m.d, curl: m.curl };
      return null;
    }

    // Hysteresis band between close and open: neither primed nor released.
    if (m.d < this.th.open) {
      if (tr.lastPrimed && t - tr.lastPrimed.t > this.th.releaseWindowMs) tr.lastPrimed = null;
      return null;
    }

    // Opened.
    const primed = tr.lastPrimed;
    tr.lastPrimed = null;
    tr.primedAt = null;
    if (!primed) return null;
    const dt = t - primed.t;
    if (dt <= 0 || dt > this.th.releaseWindowMs) return null;

    const speed = (m.d - primed.d) / (dt / 1000);
    const curled = m.curl <= this.th.curl && primed.curl - m.curl >= this.th.curlDrop;
    if (speed < this.th.minSpeed) return { type: 'near-miss', t, hand: label, reason: 'slow-release' };
    if (!curled) return { type: 'near-miss', t, hand: label, reason: 'no-curl' };
    if (t < this.cooldownUntil) return null;
    this.cooldownUntil = t + (this.cfg.cooldownMs ?? 2000);
    return { type: 'snap', t, hand: label };
  }
}
