import { describe, expect, it } from 'vitest';
import { BUILTIN_EFFECTS } from '../../src/catalog/builtin';
import type { EffectDefinition } from '../../src/catalog/schema';
import { DUST_PARTICLE_TAIL_MS, REAPPEAR_MS, SessionMachine } from '../../src/session/session';

const def = (id: string) => BUILTIN_EFFECTS.find((d) => d.id === id) as EffectDefinition;
const dust = def('dust-away');
const cinema = def('absolute-cinema');
const ok = () => null;
const DISSOLVE = 1600;

function live(reappearAfterMs = 5000) {
  const s = new SessionMachine({ reappearAfterMs, random: () => 0.5 });
  s.cameraStarting();
  s.cameraLive(0);
  return s;
}

describe('SessionMachine', () => {
  it('starts OFF, then LOADING, then LIVE on the first frame', () => {
    const s = new SessionMachine({ reappearAfterMs: 5000 });
    expect(s.snapshot.phase).toBe('OFF');
    s.cameraStarting();
    expect(s.snapshot.phase).toBe('LOADING');
    expect(s.trigger(cinema, 0, ok)).toEqual({ ok: false, reason: 'not-live' });
    s.cameraLive(1);
    expect(s.snapshot.phase).toBe('LIVE');
  });

  it('runs Dust Away through DISINTEGRATING → VANISHED → REAPPEARING → idle on the timer', () => {
    const s = live(5000);
    expect(s.trigger(dust, 100, ok).ok).toBe(true);
    expect(s.snapshot.effectPhase).toBe('DISINTEGRATING');
    s.tick(100 + DISSOLVE + DUST_PARTICLE_TAIL_MS - 1);
    expect(s.snapshot.effectPhase).toBe('DISINTEGRATING');
    s.tick(100 + DISSOLVE + DUST_PARTICLE_TAIL_MS);
    expect(s.snapshot.effectPhase).toBe('VANISHED');
    const t = s.snapshot.effectPhaseStartedAt;
    s.tick(t + 4999);
    expect(s.snapshot.effectPhase).toBe('VANISHED');
    s.tick(t + 5000);
    expect(s.snapshot.effectPhase).toBe('REAPPEARING');
    s.tick(t + 5000 + REAPPEAR_MS);
    expect(s.snapshot).toMatchObject({ phase: 'LIVE', effectPhase: 'IDLE', effect: null });
  });

  it('"stay vanished" never reappears on its own; explicit reappear works', () => {
    const s = live(0);
    s.trigger(dust, 0, ok);
    s.tick(DISSOLVE + DUST_PARTICLE_TAIL_MS);
    s.tick(10 * 60_000);
    expect(s.snapshot.effectPhase).toBe('VANISHED');
    expect(s.reappear(10 * 60_000)).toBe(true);
    expect(s.snapshot.effectPhase).toBe('REAPPEARING');
  });

  it('ignores repeated triggers while dusting and blocks other effects while hidden', () => {
    const s = live();
    s.trigger(dust, 0, ok);
    const runId = s.snapshot.effect!.runId;
    expect(s.trigger(dust, 10, ok)).toEqual({ ok: false, reason: 'busy' });
    expect(s.trigger(cinema, 10, ok)).toEqual({ ok: false, reason: 'hidden' });
    expect(s.snapshot.effect!.runId).toBe(runId);
  });

  it('switching between visible effects replaces the run; the same effect is busy', () => {
    const s = live();
    expect(s.trigger(cinema, 0, ok).ok).toBe(true);
    expect(s.trigger(cinema, 5, ok)).toEqual({ ok: false, reason: 'busy' });
    const aura = def('aura-9999');
    const r = s.trigger(aura, 10, ok);
    expect(r.ok).toBe(true);
    expect(s.snapshot.effect?.effectId).toBe('aura-9999');
  });

  it('timed effects end after their duration', () => {
    const s = live();
    s.trigger(cinema, 0, ok);
    s.tick(cinema.durationMs - 1);
    expect(s.snapshot.effectPhase).toBe('PLAYING');
    s.tick(cinema.durationMs);
    expect(s.snapshot.effectPhase).toBe('IDLE');
  });

  it('reports missing requirements without starting', () => {
    const s = live();
    expect(s.trigger(dust, 0, () => 'background')).toEqual({ ok: false, reason: 'missing-requirement', detail: 'background' });
    expect(s.snapshot.effectPhase).toBe('IDLE');
  });

  it('reset during every transition returns to the normal view', () => {
    for (const at of [10, DISSOLVE + DUST_PARTICLE_TAIL_MS + 10, 'reappearing'] as const) {
      const s = live(0);
      s.trigger(dust, 0, ok);
      if (at === 'reappearing') {
        s.tick(DISSOLVE + DUST_PARTICLE_TAIL_MS);
        s.reappear(5000);
      } else s.tick(at);
      s.reset(9000);
      expect(s.snapshot).toMatchObject({ phase: 'LIVE', effectPhase: 'IDLE', effect: null });
    }
  });

  it('a failure while hidden requires explicit recovery (never reveals the camera)', () => {
    const s = live(0);
    s.trigger(dust, 0, ok);
    s.tick(DISSOLVE + DUST_PARTICLE_TAIL_MS);
    s.fail(5000, 'renderer-failed');
    expect(s.snapshot).toMatchObject({ phase: 'RECOVERY_REQUIRED', recoveryReason: 'renderer-failed' });
    expect(s.trigger(cinema, 5001, ok)).toEqual({ ok: false, reason: 'recovery-required' });
    s.tick(60_000);
    expect(s.snapshot.phase).toBe('RECOVERY_REQUIRED');
    expect(s.reappear(60_001)).toBe(true);
    expect(s.snapshot).toMatchObject({ phase: 'LIVE', effectPhase: 'IDLE' });
  });

  it('a failure during a visible effect just ends it', () => {
    const s = live();
    s.trigger(cinema, 0, ok);
    s.fail(10, 'x');
    expect(s.snapshot).toMatchObject({ phase: 'LIVE', effectPhase: 'IDLE' });
  });

  it('camera off while vanished → recovery required when the camera returns', () => {
    const s = live(0);
    s.trigger(dust, 0, ok);
    s.tick(DISSOLVE + DUST_PARTICLE_TAIL_MS);
    s.cameraStopped(4000);
    expect(s.snapshot).toMatchObject({ phase: 'CAMERA_OFF', effect: null });
    s.cameraStarting();
    s.cameraLive(5000);
    expect(s.snapshot).toMatchObject({ phase: 'RECOVERY_REQUIRED', recoveryReason: 'camera-restarted-while-vanished' });
  });

  it('camera off during a visible effect returns to plain LIVE when it comes back', () => {
    const s = live();
    s.trigger(cinema, 0, ok);
    s.cameraStopped(100);
    s.cameraStarting();
    s.cameraLive(200);
    expect(s.snapshot).toMatchObject({ phase: 'LIVE', effectPhase: 'IDLE' });
  });

  it('calibration blocks triggers and only starts from idle LIVE', () => {
    const s = live();
    expect(s.startCalibration()).toBe(true);
    expect(s.trigger(dust, 0, ok)).toEqual({ ok: false, reason: 'calibrating' });
    s.stopCalibration();
    s.trigger(cinema, 0, ok);
    expect(s.startCalibration()).toBe(false);
  });

  it('disabled sessions refuse triggers', () => {
    const s = live();
    s.setEnabled(false);
    expect(s.trigger(cinema, 0, ok)).toEqual({ ok: false, reason: 'disabled' });
  });
});
