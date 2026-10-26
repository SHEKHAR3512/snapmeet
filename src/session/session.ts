import type { EffectDefinition, EffectTemplate } from '../catalog/schema';

/**
 * Session-level state (camera/pipeline) is kept separate from per-effect state.
 *
 *   OFF → LOADING → LIVE ⇄ CALIBRATING
 *   LIVE + dust: DISINTEGRATING → VANISHED → REAPPEARING → (LIVE)
 *   any → CAMERA_OFF when the outgoing camera stops
 *   hidden phases + failure / camera restart → RECOVERY_REQUIRED (neutral frame until explicit return)
 */
export type SessionPhase = 'OFF' | 'LOADING' | 'LIVE' | 'CALIBRATING' | 'CAMERA_OFF' | 'RECOVERY_REQUIRED';
export type EffectPhase = 'IDLE' | 'PLAYING' | 'DISINTEGRATING' | 'VANISHED' | 'REAPPEARING';

export interface ActiveEffect {
  runId: number;
  effectId: string;
  template: EffectTemplate;
  definition: EffectDefinition;
  startedAt: number;
  seed: number;
}

export interface SessionSnapshot {
  phase: SessionPhase;
  effectPhase: EffectPhase;
  effect: ActiveEffect | null;
  /** Monotonic timestamp (ms) when effectPhase was entered. */
  effectPhaseStartedAt: number;
  /** Duration of the current timed effect phase, or null for untimed (VANISHED with stay). */
  effectPhaseDurationMs: number | null;
  recoveryReason: string | null;
}

export type TriggerFailure =
  | 'disabled'
  | 'not-live'
  | 'busy'
  | 'hidden'
  | 'calibrating'
  | 'recovery-required'
  | 'missing-requirement';

export type TriggerResult = { ok: true; runId: number } | { ok: false; reason: TriggerFailure; detail?: string };

export const DUST_PARTICLE_TAIL_MS = 1400;
export const REAPPEAR_MS = 1300;

export function isHiddenPhase(p: EffectPhase): boolean {
  return p === 'DISINTEGRATING' || p === 'VANISHED' || p === 'REAPPEARING';
}

export interface SessionOptions {
  /** 0 = stay vanished until explicit reappear. */
  reappearAfterMs: number;
  random?: () => number;
}

export class SessionMachine {
  private s: SessionSnapshot = {
    phase: 'OFF',
    effectPhase: 'IDLE',
    effect: null,
    effectPhaseStartedAt: 0,
    effectPhaseDurationMs: null,
    recoveryReason: null,
  };
  private nextRunId = 1;
  private hiddenWhenCameraStopped = false;
  private enabled = true;
  private listeners = new Set<(s: SessionSnapshot) => void>();

  constructor(private opts: SessionOptions) {}

  get snapshot(): Readonly<SessionSnapshot> {
    return this.s;
  }

  subscribe(fn: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setReappearAfter(ms: number): void {
    this.opts.reappearAfterMs = ms;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** A camera pipeline was created; waiting for its first rendered frame. */
  cameraStarting(): void {
    if (this.s.phase === 'OFF' || this.s.phase === 'CAMERA_OFF') this.update({ phase: 'LOADING' });
  }

  /** First frame rendered on a live pipeline. */
  cameraLive(now: number): void {
    if (this.s.phase === 'RECOVERY_REQUIRED' || this.s.phase === 'LIVE' || this.s.phase === 'CALIBRATING') return;
    if (this.hiddenWhenCameraStopped) {
      this.hiddenWhenCameraStopped = false;
      this.update({ phase: 'RECOVERY_REQUIRED', recoveryReason: 'camera-restarted-while-vanished' });
      return;
    }
    this.update({ phase: 'LIVE' });
    void now;
  }

  /** All outgoing camera pipelines stopped (camera off, call ended, device lost). */
  cameraStopped(now: number): void {
    if (isHiddenPhase(this.s.effectPhase) || this.s.phase === 'RECOVERY_REQUIRED') this.hiddenWhenCameraStopped = true;
    this.update({
      phase: 'CAMERA_OFF',
      recoveryReason: null,
      ...this.idleEffect(now),
    });
  }

  trigger(def: EffectDefinition, now: number, missingRequirement: () => string | null): TriggerResult {
    if (!this.enabled) return { ok: false, reason: 'disabled' };
    const { phase, effectPhase } = this.s;
    if (phase === 'CALIBRATING') return { ok: false, reason: 'calibrating' };
    if (phase === 'RECOVERY_REQUIRED') return { ok: false, reason: 'recovery-required' };
    if (phase !== 'LIVE') return { ok: false, reason: 'not-live' };
    if (isHiddenPhase(effectPhase)) {
      return { ok: false, reason: effectPhase === 'DISINTEGRATING' && this.s.effect?.effectId === def.id ? 'busy' : 'hidden' };
    }
    if (effectPhase === 'PLAYING' && this.s.effect?.effectId === def.id) return { ok: false, reason: 'busy' };
    const missing = missingRequirement();
    if (missing) return { ok: false, reason: 'missing-requirement', detail: missing };

    const runId = this.nextRunId++;
    const effect: ActiveEffect = {
      runId,
      effectId: def.id,
      template: def.template,
      definition: def,
      startedAt: now,
      seed: Math.floor((this.opts.random ?? Math.random)() * 1_000_000),
    };
    if (def.template === 'dust-away') {
      const dissolve = def.parameters.dissolveMs ?? 1600;
      this.update({
        effect,
        effectPhase: 'DISINTEGRATING',
        effectPhaseStartedAt: now,
        effectPhaseDurationMs: dissolve + DUST_PARTICLE_TAIL_MS,
      });
    } else {
      this.update({ effect, effectPhase: 'PLAYING', effectPhaseStartedAt: now, effectPhaseDurationMs: def.durationMs });
    }
    return { ok: true, runId };
  }

  /** Explicit "Reappear": from VANISHED (or late DISINTEGRATING) start the reappear transition; from recovery, return to live. */
  reappear(now: number): boolean {
    if (this.s.phase === 'RECOVERY_REQUIRED') {
      this.update({ phase: 'LIVE', recoveryReason: null, ...this.idleEffect(now) });
      return true;
    }
    if (this.s.effectPhase === 'VANISHED' || this.s.effectPhase === 'DISINTEGRATING') {
      this.update({ effectPhase: 'REAPPEARING', effectPhaseStartedAt: now, effectPhaseDurationMs: REAPPEAR_MS });
      return true;
    }
    return false;
  }

  /** Reset Effects: deterministic return to the normal view. Always allowed. */
  reset(now: number): void {
    this.hiddenWhenCameraStopped = false;
    const phase: SessionPhase =
      this.s.phase === 'RECOVERY_REQUIRED' || this.s.phase === 'CALIBRATING' ? 'LIVE' : this.s.phase;
    this.update({ phase, recoveryReason: null, ...this.idleEffect(now) });
  }

  /** Renderer or inference failure. Never reveals the camera if the user was hidden. */
  fail(now: number, reason: string): void {
    if (isHiddenPhase(this.s.effectPhase)) {
      this.update({ phase: 'RECOVERY_REQUIRED', recoveryReason: reason, ...this.idleEffect(now) });
    } else if (this.s.effectPhase === 'PLAYING') {
      this.update(this.idleEffect(now));
    }
  }

  startCalibration(): boolean {
    if (this.s.phase !== 'LIVE' || this.s.effectPhase !== 'IDLE') return false;
    this.update({ phase: 'CALIBRATING' });
    return true;
  }

  stopCalibration(): void {
    if (this.s.phase === 'CALIBRATING') this.update({ phase: 'LIVE' });
  }

  /** Advances timed phases. Call once per rendered frame. */
  tick(now: number): void {
    const { effectPhase, effectPhaseStartedAt, effectPhaseDurationMs } = this.s;
    if (effectPhase === 'IDLE' || effectPhaseDurationMs === null) return;
    if (now - effectPhaseStartedAt < effectPhaseDurationMs) return;
    switch (effectPhase) {
      case 'PLAYING':
      case 'REAPPEARING':
        this.update(this.idleEffect(now));
        break;
      case 'DISINTEGRATING': {
        const stay = this.opts.reappearAfterMs <= 0;
        this.update({
          effectPhase: 'VANISHED',
          effectPhaseStartedAt: now,
          effectPhaseDurationMs: stay ? null : this.opts.reappearAfterMs,
        });
        break;
      }
      case 'VANISHED':
        this.update({ effectPhase: 'REAPPEARING', effectPhaseStartedAt: now, effectPhaseDurationMs: REAPPEAR_MS });
        break;
    }
  }

  private idleEffect(now: number): Pick<SessionSnapshot, 'effect' | 'effectPhase' | 'effectPhaseStartedAt' | 'effectPhaseDurationMs'> {
    return { effect: null, effectPhase: 'IDLE', effectPhaseStartedAt: now, effectPhaseDurationMs: null };
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.s = { ...this.s, ...patch };
    for (const fn of this.listeners) fn(this.s);
  }
}
