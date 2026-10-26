import { describe, expect, it } from 'vitest';
import { CALIBRATION_ATTEMPTS, SnapCalibration, recommend } from '../../src/gestures/calibration';
import { LM, type HandObservation, type Landmark } from '../../src/gestures/landmarks';
import { PalmsDetector } from '../../src/gestures/palms-detector';
import { SnapDetector, type SnapEvent } from '../../src/gestures/snap-detector';

/**
 * Synthetic landmark poses. Coordinates are normalized image coords on a square frame
 * (aspect 1). The palm (wrist → middle MCP) is 0.15 long, pointing up.
 */
type Pose = 'open' | 'primed' | 'snapped' | 'pinch-open';

function hand(pose: Pose, opts: { x?: number; y?: number; label?: 'Left' | 'Right'; score?: number } = {}): HandObservation {
  const ox = opts.x ?? 0.5;
  const oy = opts.y ?? 0.7;
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: ox, y: oy - 0.1 }));
  const set = (i: number, dx: number, dy: number) => (lm[i] = { x: ox + dx, y: oy + dy });
  set(LM.WRIST, 0, 0);
  set(LM.MIDDLE_MCP, 0, -0.15);
  set(LM.INDEX_MCP, -0.03, -0.14);
  set(LM.PINKY_MCP, 0.05, -0.12);
  set(LM.INDEX_TIP, -0.04, -0.29);
  set(LM.RING_TIP, 0.03, -0.27);
  set(LM.PINKY_TIP, 0.06, -0.23);
  switch (pose) {
    case 'open':
      set(LM.THUMB_TIP, -0.12, -0.1);
      set(LM.MIDDLE_TIP, 0, -0.3); // curl = 2.0 palms
      break;
    case 'primed':
      set(LM.MIDDLE_TIP, -0.06, -0.21); // curl ≈ 1.46
      set(LM.THUMB_TIP, -0.07, -0.2); // d ≈ 0.09 palms
      break;
    case 'snapped':
      set(LM.MIDDLE_TIP, -0.02, -0.1); // folded into the palm: curl ≈ 0.68
      set(LM.THUMB_TIP, -0.08, -0.24); // d ≈ 0.96
      break;
    case 'pinch-open':
      set(LM.MIDDLE_TIP, 0, -0.3); // finger extends instead of curling
      set(LM.THUMB_TIP, -0.12, -0.17); // d ≈ 0.9
      break;
  }
  return { landmarks: lm, handedness: opts.label ?? 'Right', score: opts.score ?? 0.95 };
}

function run(det: SnapDetector, frames: Array<[number, HandObservation[]]>): SnapEvent[] {
  return frames.flatMap(([t, hands]) => det.push({ t, hands }));
}

const newDetector = (sensitivity = 0.5) => new SnapDetector({ sensitivity, aspect: 1, cooldownMs: 2000 });

describe('SnapDetector', () => {
  it('recognizes primed → fast curled release as one snap', () => {
    const ev = run(newDetector(), [
      [0, [hand('open')]],
      [50, [hand('primed')]],
      [100, [hand('primed')]],
      [150, [hand('snapped')]],
      [200, [hand('snapped')]],
      [250, [hand('open')]],
    ]);
    expect(ev).toEqual([{ type: 'snap', t: 150, hand: 'Right' }]);
  });

  it('works for the left hand and for horizontally mirrored coordinates', () => {
    const mirror = (h: HandObservation): HandObservation => ({ ...h, handedness: 'Left', landmarks: h.landmarks.map((p) => ({ x: 1 - p.x, y: p.y })) });
    const ev = run(newDetector(), [
      [0, [mirror(hand('primed'))]],
      [60, [mirror(hand('snapped'))]],
    ]);
    expect(ev.map((e) => e.type)).toEqual(['snap']);
    expect(ev[0]).toMatchObject({ hand: 'Left' });
  });

  it('rejects a sustained pinch that opens without the middle finger curling', () => {
    const frames: Array<[number, HandObservation[]]> = [];
    for (let t = 0; t <= 2000; t += 50) frames.push([t, [hand('primed')]]);
    frames.push([2050, [hand('pinch-open')]]);
    const ev = run(newDetector(), frames);
    expect(ev.filter((e) => e.type === 'snap')).toEqual([]);
    expect(ev).toEqual([{ type: 'near-miss', t: 2050, hand: 'Right', reason: 'no-curl' }]);
  });

  it('rejects slow releases (outside the release window)', () => {
    const det = newDetector();
    const ev = run(det, [
      [0, [hand('primed')]],
      [600, [hand('snapped')]],
    ]);
    expect(ev.filter((e) => e.type === 'snap')).toEqual([]);
  });

  it('applies the cooldown: one event per two seconds', () => {
    const det = newDetector();
    const ev = run(det, [
      [0, [hand('primed')]],
      [50, [hand('snapped')]],
      [400, [hand('primed')]],
      [450, [hand('snapped')]],
      [2100, [hand('primed')]],
      [2150, [hand('snapped')]],
    ]);
    expect(ev.filter((e) => e.type === 'snap').map((e) => e.t)).toEqual([50, 2150]);
  });

  it('resets on tracking loss longer than the allowed gap', () => {
    const ev = run(newDetector(), [
      [0, [hand('primed')]],
      [100, []],
      [400, [hand('snapped')]],
    ]);
    expect(ev).toEqual([]);
  });

  it('resets when the hand identity jumps across the frame', () => {
    const ev = run(newDetector(), [
      [0, [hand('primed', { x: 0.3 })]],
      [50, [hand('snapped', { x: 0.75 })]],
    ]);
    expect(ev).toEqual([]);
  });

  it('ignores low-confidence and out-of-frame samples', () => {
    expect(
      run(newDetector(), [
        [0, [hand('primed', { score: 0.3 })]],
        [50, [hand('snapped', { score: 0.3 })]],
      ]),
    ).toEqual([]);
    expect(
      run(newDetector(), [
        [0, [hand('primed', { y: 1.15 })]],
        [50, [hand('snapped', { y: 1.15 })]],
      ]),
    ).toEqual([]);
  });

  it('does not fire on ordinary motion (waving an open hand)', () => {
    const frames: Array<[number, HandObservation[]]> = [];
    for (let i = 0; i < 200; i++) frames.push([i * 50, [hand('open', { x: 0.4 + 0.1 * Math.sin(i / 3) })]]);
    expect(run(newDetector(), frames)).toEqual([]);
  });

  it('reports tracking feedback', () => {
    const det = newDetector();
    det.push({ t: 0, hands: [hand('primed')] });
    expect(det.lastFeedback).toMatchObject({ tracked: true, primed: true });
    det.push({ t: 50, hands: [] });
    expect(det.lastFeedback).toMatchObject({ tracked: false, primed: false, closeness: null });
  });
});

describe('SnapCalibration', () => {
  it('records five attempts without triggering and suggests a sensitivity', () => {
    const c = new SnapCalibration(0.5);
    c.start(0.5);
    for (let i = 0; i < CALIBRATION_ATTEMPTS; i++) {
      c.record(i < 2 ? { type: 'snap', t: i, hand: 'Right' } : { type: 'near-miss', t: i, hand: 'Right', reason: 'slow-release' });
    }
    expect(c.snapshot.active).toBe(false);
    expect(c.snapshot.attempts.filter((a) => a.ok)).toHaveLength(2);
    expect(c.snapshot.recommendedSensitivity).toBeGreaterThan(0.5);
  });

  it('keeps sensitivity when most attempts succeed and clamps suggestions', () => {
    expect(recommend([{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: false }], 0.5)).toBe(0.5);
    expect(recommend(Array.from({ length: 5 }, () => ({ ok: false })), 0.85)).toBe(0.9);
  });
});

describe('PalmsDetector', () => {
  const palm = (x: number): HandObservation => {
    const h = hand('open', { x, y: 0.6 });
    // all four fingertips extended well above the wrist
    h.landmarks[LM.MIDDLE_TIP] = { x, y: 0.6 - 0.3 };
    h.landmarks[LM.INDEX_TIP] = { x: x - 0.04, y: 0.6 - 0.28 };
    h.landmarks[LM.RING_TIP] = { x: x + 0.03, y: 0.6 - 0.27 };
    h.landmarks[LM.PINKY_TIP] = { x: x + 0.06, y: 0.6 - 0.24 };
    return h;
  };

  it('fires once after both open palms are held, then cools down', () => {
    const d = new PalmsDetector({ aspect: 1, holdMs: 500, cooldownMs: 3000 });
    const both = [palm(0.25), { ...palm(0.75), handedness: 'Left' as const }];
    const fired: number[] = [];
    for (let t = 0; t <= 1500; t += 100) if (d.push({ t, hands: both })) fired.push(t);
    expect(fired).toEqual([500]);
  });

  it('needs two hands', () => {
    const d = new PalmsDetector({ aspect: 1, holdMs: 200 });
    let any = false;
    for (let t = 0; t <= 1000; t += 100) any ||= d.push({ t, hands: [palm(0.5)] });
    expect(any).toBe(false);
  });
});
