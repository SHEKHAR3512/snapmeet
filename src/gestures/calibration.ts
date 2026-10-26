import type { SnapEvent } from './snap-detector';

/**
 * Five practice attempts. Successful snaps and near-misses both count as attempts;
 * the result suggests a sensitivity adjustment. Calibration never triggers effects.
 */
export const CALIBRATION_ATTEMPTS = 5;

export interface CalibrationState {
  active: boolean;
  attempts: Array<{ ok: boolean; reason?: string }>;
  recommendedSensitivity: number | null;
}

export class SnapCalibration {
  private state: CalibrationState = { active: false, attempts: [], recommendedSensitivity: null };

  constructor(private currentSensitivity: number) {}

  get snapshot(): Readonly<CalibrationState> {
    return this.state;
  }

  start(currentSensitivity: number): void {
    this.currentSensitivity = currentSensitivity;
    this.state = { active: true, attempts: [], recommendedSensitivity: null };
  }

  stop(): void {
    this.state = { ...this.state, active: false };
  }

  /** Returns true when the state changed. */
  record(ev: SnapEvent): boolean {
    if (!this.state.active) return false;
    const attempts = [
      ...this.state.attempts,
      ev.type === 'snap' ? { ok: true } : { ok: false, reason: ev.reason },
    ];
    const done = attempts.length >= CALIBRATION_ATTEMPTS;
    this.state = {
      active: !done,
      attempts,
      recommendedSensitivity: done ? recommend(attempts, this.currentSensitivity) : null,
    };
    return true;
  }
}

export function recommend(attempts: Array<{ ok: boolean; reason?: string }>, current: number): number {
  const ok = attempts.filter((a) => a.ok).length;
  const clamp = (v: number) => Math.round(Math.min(0.9, Math.max(0.1, v)) * 100) / 100;
  if (ok >= 4) return clamp(current);
  // Missed attempts: be more permissive, more so the more were missed.
  return clamp(current + 0.08 * (attempts.length - ok));
}
