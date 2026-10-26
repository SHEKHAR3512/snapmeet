import { LM, dist, inFrame, palmSize, type HandObservation, type HandsSample } from './landmarks';

/** Contact -> rapid finger retraction, normalized to the palm. Wrist continuity
 * survives handedness flips. Thumb separation OR strong middle-finger retraction
 * supplies release evidence; pure opening without retraction is rejected. */
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
    close: lerp(0.38, 0.58),
    open: lerp(0.74, 0.62),
    curl: lerp(0.92, 1.12),
    curlDrop: lerp(0.24, 0.12),
    minSpeed: lerp(3.5, 1.5),
    releaseWindowMs: lerp(260, 420),
    maxGapMs: 350,
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

interface Measurement {
  d: number;
  curl: number;
  tipToPalm: number;
  wristX: number;
  wristY: number;
}
interface HandTrack {
  lastT: number;
  wristX: number;
  wristY: number;
  primed: { t: number; d: number; curl: number; tipToPalm: number } | null;
  peakSpeed: number;
  reason: 'slow-release' | 'no-curl';
}
const REQUIRED = [LM.WRIST, LM.THUMB_TIP, LM.MIDDLE_MCP, LM.MIDDLE_TIP] as const;

export class SnapDetector {
  private tracks = new Map<'Left' | 'Right', HandTrack>();
  private cooldownUntil = -Infinity;
  private reservationUntil = -Infinity;
  private th: SnapThresholds;
  private feedback: SnapFeedback = { tracked: false, primed: false, coolingDown: false, closeness: null };
  constructor(private cfg: SnapDetectorConfig) { this.th = thresholdsFor(cfg.sensitivity); }
  configure(patch: Partial<SnapDetectorConfig>): void {
    this.cfg = { ...this.cfg, ...patch }; this.th = thresholdsFor(this.cfg.sensitivity);
  }
  get thresholds(): Readonly<SnapThresholds> { return this.th; }
  get lastFeedback(): Readonly<SnapFeedback> { return this.feedback; }
  /** Give a primed snap priority over fist/point poses, including its release tail. */
  reservesPose(t: number): boolean { return t < this.reservationUntil; }
  reset(): void {
    this.tracks.clear(); this.cooldownUntil = this.reservationUntil = -Infinity;
    this.feedback = { tracked: false, primed: false, coolingDown: false, closeness: null };
  }
  push(sample: HandsSample): SnapEvent[] {
    const events: SnapEvent[] = [];
    const seen = new Set<'Left' | 'Right'>();
    let closeness: number | null = null;
    let primed = false;
    for (const hand of sample.hands) {
      const m = this.measure(hand);
      if (!m) continue;
      // MediaPipe can flip handedness while fingers cross. Track the nearest wrist.
      const candidates = [...this.tracks].filter(([label, tr]) => !seen.has(label) && sample.t - tr.lastT <= this.th.maxGapMs)
        .map(([label, tr]) => ({ label, distance: Math.hypot((m.wristX - tr.wristX) * this.cfg.aspect, m.wristY - tr.wristY) }))
        .sort((a, b) => a.distance - b.distance);
      const nearest = candidates[0];
      const label = nearest && nearest.distance < 0.18 ? nearest.label : hand.handedness;
      if (seen.has(label)) continue;
      seen.add(label);
      closeness = Math.min(closeness ?? Infinity, m.d);
      const event = this.step(label, sample.t, m);
      if (event) events.push(event);
      primed ||= !!this.tracks.get(label)?.primed;
    }
    for (const [label, tr] of this.tracks) {
      if (!seen.has(label) && sample.t - tr.lastT > this.th.maxGapMs) this.tracks.delete(label);
    }
    this.feedback = { tracked: seen.size > 0, primed, coolingDown: sample.t < this.cooldownUntil, closeness };
    return events;
  }
  private measure(hand: HandObservation): Measurement | null {
    const lm = hand.landmarks;
    if (lm.length < 21 || hand.score < 0.45 || !inFrame(lm, REQUIRED, 0.08) || lm.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    // Palm width provides a stable fallback when the wrist is foreshortened.
    const size = Math.max(palmSize(lm, this.cfg.aspect), dist(lm[5]!, lm[17]!, this.cfg.aspect) * 0.85);
    if (size < 0.025) return null;
    return { d: dist(lm[4]!, lm[12]!, this.cfg.aspect) / size,
      curl: dist(lm[12]!, lm[0]!, this.cfg.aspect) / size,
      tipToPalm: dist(lm[12]!, lm[9]!, this.cfg.aspect) / size,
      wristX: lm[0]!.x, wristY: lm[0]!.y };
  }
  private step(label: 'Left' | 'Right', t: number, m: Measurement): SnapEvent | null {
    let tr = this.tracks.get(label);
    if (tr && t <= tr.lastT) return null;
    if (!tr || t - tr.lastT > this.th.maxGapMs || Math.hypot((m.wristX - tr.wristX) * this.cfg.aspect, m.wristY - tr.wristY) > this.th.maxWristJump) {
      tr = { lastT: t, wristX: m.wristX, wristY: m.wristY, primed: null, peakSpeed: 0, reason: 'no-curl' };
      this.tracks.set(label, tr);
    }
    tr.lastT = t; tr.wristX = m.wristX; tr.wristY = m.wristY;
    if (t < this.cooldownUntil) { tr.primed = null; return null; }
    // Do not prime on a resting closed fist whose thumb happens to touch a fingertip.
    if (m.d <= this.th.close && (m.curl > 1.05 || m.tipToPalm > 0.6)) {
      tr.primed = { t, d: m.d, curl: m.curl, tipToPalm: m.tipToPalm };
      tr.peakSpeed = 0;
      this.reservationUntil = t + this.th.releaseWindowMs + 220;
      return null;
    }
    const p = tr.primed;
    if (!p) return null;
    const dt = t - p.t;
    if (dt > this.th.releaseWindowMs) {
      tr.primed = null;
      return { type: 'near-miss', t, hand: label, reason: tr.reason };
    }
    if (dt <= 0) return null;
    const separation = m.d - p.d;
    const retract = Math.max(p.curl - m.curl, p.tipToPalm - m.tipToPalm);
    tr.peakSpeed = Math.max(tr.peakSpeed, Math.max(separation, retract) * 1000 / dt);
    // Retraction itself can be the release signal: after a real snap, thumb and middle
    // finger sometimes remain close in the 2D image even though they separated in depth.
    const released = m.d >= this.th.open || (retract >= this.th.curlDrop * 1.6 && m.tipToPalm < 0.95);
    const curled = retract >= this.th.curlDrop;
    if (!released || !curled) { tr.reason = 'no-curl'; return null; }
    if (tr.peakSpeed < this.th.minSpeed) { tr.reason = 'slow-release'; return null; }
    tr.primed = null;
    this.cooldownUntil = t + (this.cfg.cooldownMs ?? 1100);
    this.reservationUntil = this.cooldownUntil;
    return { type: 'snap', t, hand: label };
  }
}
