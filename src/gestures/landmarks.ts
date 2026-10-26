/** Normalized image coordinates as produced by MediaPipe Hand Landmarker (0..1, unmirrored). */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export interface HandObservation {
  /** 21 landmarks in MediaPipe order. */
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
  score: number;
}

export interface HandsSample {
  /** Monotonic timestamp in ms. */
  t: number;
  hands: HandObservation[];
}

export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

/** Distance in aspect-corrected units (x scaled by width/height). */
export function dist(a: Landmark, b: Landmark, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Palm size: wrist → middle-finger MCP. Used to normalize for camera distance. */
export function palmSize(lm: Landmark[], aspect: number): number {
  return dist(lm[LM.WRIST]!, lm[LM.MIDDLE_MCP]!, aspect);
}

export function inFrame(lm: Landmark[], indices: readonly number[], margin = 0.02): boolean {
  return indices.every((i) => {
    const p = lm[i];
    return !!p && p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin;
  });
}
