import { dist, inFrame, palmSize, type HandObservation, type HandsSample } from './landmarks';

export const POSE_EFFECTS = [
  ['Thumbs up', 'mission-passed'], ['Victory / two fingers', 'aura-9999'],
  ['Point up', 'aayein'], ['Rock horns', 'main-character'],
  ['Three fingers', 'serial-drama'], ['Four fingers', 'plot-twist'],
  ['Closed fist', 'emotional-damage'], ['Open palm', 'this-is-fine'],
  ['Two open palms', 'absolute-cinema'], ['Finger snap (configurable below)', 'dust-away'],
] as const;

/** Joint extension is measured relative to the palm, independent of hand rotation. */
export function extendedFingers(hand: HandObservation, aspect: number): boolean[] | null {
  const lm = hand.landmarks;
  if (lm.length < 21 || !inFrame(lm, [0, 4, 8, 12, 16, 20], 0.06) || hand.score < 0.5 || lm.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const size = palmSize(lm, aspect);
  if (size < 0.035) return null;
  return [5, 9, 13, 17].map(base => {
    const a = lm[base]!, b = lm[base + 1]!, c = lm[base + 3]!;
    const ax = (a.x - b.x) * aspect, ay = a.y - b.y;
    const cx = (c.x - b.x) * aspect, cy = c.y - b.y;
    const cosine = (ax * cx + ay * cy) / Math.max(0.00001, Math.hypot(ax, ay) * Math.hypot(cx, cy));
    return cosine < -0.45 && dist(c, lm[0]!, aspect) > dist(b, lm[0]!, aspect) * 1.12;
  });
}

function classify(hand: HandObservation, aspect: number): string | null {
  const fingers = extendedFingers(hand, aspect);
  if (!fingers) return null;
  const [i, m, r, p] = fingers, lm = hand.landmarks;
  const size = palmSize(lm, aspect);
  // Reserve pinches for the snap detector instead of accidentally firing a static pose.
  if (dist(lm[4]!, lm[12]!, aspect) / size < 0.5 && dist(lm[12]!, lm[0]!, aspect) / size > 1.05) return null;
  if (i && m && r && p) return 'this-is-fine';
  if (i && m && !r && !p) return 'aura-9999';
  if (i && !m && !r && p) return 'main-character';
  if (i && !m && !r && !p) return 'aayein';
  if (i && m && r && !p) return 'serial-drama';
  if (!i && !m && !r && !p) {
    return lm[4]!.y < lm[3]!.y - size * 0.25 && dist(lm[4]!, lm[5]!, aspect) > size * 0.65
      ? 'mission-passed' : 'emotional-damage';
  }
  return null;
}

/** Stable hold, dropout tolerance, and release latch prevent repeats while posing. */
export class PoseDetector {
  private candidate: string | null = null;
  private since = 0;
  private lastSeen = -Infinity;
  private latched = false;
  reset(): void { this.candidate = null; this.latched = false; this.lastSeen = -Infinity; }
  push(sample: HandsSample, aspect: number): string | null {
    const hands = sample.hands.filter(h => extendedFingers(h, aspect))
      .sort((a, b) => palmSize(b.landmarks, aspect) - palmSize(a.landmarks, aspect));
    let id = hands[0] ? classify(hands[0], aspect) : null;
    if (hands.length >= 2 && hands.every(h => extendedFingers(h, aspect)?.every(Boolean))) id = 'absolute-cinema';
    // Four fingers with thumb tucked versus all five fingers.
    if (id === 'this-is-fine' && hands[0]) {
      const lm = hands[0].landmarks;
      if (dist(lm[4]!, lm[9]!, aspect) / palmSize(lm, aspect) < 0.65) id = 'plot-twist';
    }
    if (!id) {
      if (sample.t - this.lastSeen > 180) this.reset();
      return null;
    }
    if (sample.t - this.lastSeen > 250 || this.candidate !== id) {
      this.candidate = id; this.since = sample.t; this.latched = false;
    }
    this.lastSeen = sample.t;
    if (this.latched || sample.t - this.since < 280) return null;
    this.latched = true;
    return id;
  }
}
