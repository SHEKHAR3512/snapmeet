import { LM, dist, inFrame, palmSize, type HandObservation, type HandsSample } from './landmarks';

/**
 * Experimental "two raised open palms" rule (used to trigger Absolute Cinema).
 * Both hands must be open (all four fingertips far from the wrist), upright, apart,
 * and held for a minimum duration. One event per hold, followed by a cooldown.
 */
export interface PalmsConfig {
  aspect: number;
  holdMs?: number;
  cooldownMs?: number;
}

const FINGER_TIPS = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP] as const;
const REQUIRED = [LM.WRIST, LM.MIDDLE_MCP, ...FINGER_TIPS] as const;

export function isOpenUprightPalm(hand: HandObservation, aspect: number): boolean {
  const lm = hand.landmarks;
  if (hand.score < 0.6 || lm.length < 21 || !inFrame(lm, REQUIRED)) return false;
  const palm = palmSize(lm, aspect);
  if (palm < 0.04) return false;
  const wrist = lm[LM.WRIST]!;
  return FINGER_TIPS.every((i) => {
    const tip = lm[i]!;
    return dist(tip, wrist, aspect) / palm > 1.5 && tip.y < wrist.y;
  });
}

export class PalmsDetector {
  private heldSince: number | null = null;
  private fired = false;
  private cooldownUntil = -Infinity;

  constructor(private cfg: PalmsConfig) {}

  configure(patch: Partial<PalmsConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  reset(): void {
    this.heldSince = null;
    this.fired = false;
  }

  push(sample: HandsSample): boolean {
    const open = sample.hands.filter((h) => isOpenUprightPalm(h, this.cfg.aspect));
    const apart =
      open.length >= 2 && Math.abs(open[0]!.landmarks[LM.WRIST]!.x - open[1]!.landmarks[LM.WRIST]!.x) > 0.22;
    if (!apart) {
      this.reset();
      return false;
    }
    this.heldSince ??= sample.t;
    if (this.fired || sample.t < this.cooldownUntil) return false;
    if (sample.t - this.heldSince >= (this.cfg.holdMs ?? 500)) {
      this.fired = true;
      this.cooldownUntil = sample.t + (this.cfg.cooldownMs ?? 3000);
      return true;
    }
    return false;
  }
}
