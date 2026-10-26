export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
/** 0→1 over [a, b] in ms. */
export const ramp = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
/** Envelope: fade in over `inMs`, hold, fade out over the last `outMs` of `durationMs`. */
export const envelope = (t: number, durationMs: number, inMs: number, outMs: number) =>
  Math.min(ramp(t, 0, inMs), 1 - ramp(t, durationMs - outMs, durationMs));
