import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/bridge/protocol';
import { matchShortcut } from '../../src/content/shortcuts';
import { particleGrid, PARTICLE_BUDGET } from '../../src/effects/built-in/dust-away';
import { backgroundDrift, lumaThumb, THUMB_H, THUMB_W } from '../../src/engine/background';
import { AdaptiveQuality, outputSize } from '../../src/engine/quality';
import { DEFAULT_SETTINGS, applySettingsPatch, migrateSettings } from '../../src/shared/settings';
import { compareSemver } from '../../src/shared/semver';
import { MaskProcessor, personFraction } from '../../src/vision/mask';

describe('settings', () => {
  it('defaults to disabled (explicit opt-in)', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
  });

  it('migrates field by field, keeping valid values and dropping corrupt ones', () => {
    const s = migrateSettings({ enabled: true, quality: 'ultra', snapSensitivity: 0.8, favorites: 'nope', extra: 1 });
    expect(s.enabled).toBe(true);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.snapSensitivity).toBe(0.8);
    expect(s.favorites).toEqual(DEFAULT_SETTINGS.favorites);
    expect('extra' in s).toBe(false);
  });

  it('rejects unknown keys and invalid values in UI patches', () => {
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { evil: true })).toThrow();
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { reappearAfterMs: -1 })).toThrow();
    expect(applySettingsPatch(DEFAULT_SETTINGS, { reducedMotion: true }).reducedMotion).toBe(true);
  });
});

describe('bridge protocol', () => {
  it('accepts the finite command set only', () => {
    expect(parseCommand({ type: 'trigger', id: 1, effectId: 'dust-away' })).toMatchObject({ type: 'trigger' });
    expect(parseCommand({ type: 'reset', id: 2 })).toMatchObject({ type: 'reset' });
    expect(parseCommand({ type: 'fetch', id: 3, url: 'https://x' })).toBeNull();
    expect(parseCommand({ type: 'trigger', id: 1, effectId: '../../etc' })).toBeNull();
    expect(parseCommand({ type: 'reset', id: 2, extra: true })).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });

  it('validates config asset base as an extension origin', () => {
    const base = { type: 'config', id: 1, settings: DEFAULT_SETTINGS, extensionVersion: '0.1.0', definitions: [] };
    expect(parseCommand({ ...base, assetBase: `chrome-extension://${'a'.repeat(32)}/` })).not.toBeNull();
    expect(parseCommand({ ...base, assetBase: 'https://evil.example/' })).toBeNull();
  });

  it('enforces the payload size limit', () => {
    const big = { type: 'config', id: 1, settings: DEFAULT_SETTINGS, assetBase: `chrome-extension://${'a'.repeat(32)}/`, extensionVersion: '0.1.0', definitions: Array.from({ length: 150 }, () => ({ pad: 'x'.repeat(2000) })) };
    expect(parseCommand(big)).toBeNull();
  });
});

describe('shortcuts', () => {
  const k = (code: string, extra: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    code,
    ...extra,
  });
  it('maps Alt+Shift combos by physical key', () => {
    expect(matchShortcut(k('KeyX'))).toBe('reset-effects');
    expect(matchShortcut(k('KeyS'))).toBe('trigger-selected');
    expect(matchShortcut(k('KeyX', { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(k('KeyX', { shiftKey: false }))).toBeNull();
    expect(matchShortcut(k('KeyX', { repeat: true }))).toBeNull();
    expect(matchShortcut(k('KeyQ'))).toBeNull();
  });
});

describe('quality', () => {
  it('fits output size to the preset keeping aspect and even dimensions', () => {
    expect(outputSize(1920, 1080, 'medium')).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1280, 720, 'low')).toEqual({ width: 854, height: 480 });
    expect(outputSize(640, 480, 'high')).toEqual({ width: 640, height: 480 });
  });

  it('steps down after sustained overload and up only after long headroom (hysteresis)', () => {
    const q = new AdaptiveQuality('high');
    expect(q.observe(50, 30, 0, false)).toBeNull();
    expect(q.observe(50, 30, 3000, false)).toBeNull();
    expect(q.observe(50, 30, 4500, false)).toBe('medium');
    // brief recovery does not bounce back up
    expect(q.observe(10, 30, 5000, false)).toBeNull();
    expect(q.observe(10, 30, 15000, false)).toBeNull();
    expect(q.observe(10, 30, 25500, false)).toBe('high');
    // never above the ceiling
    expect(q.observe(1, 30, 60000, false)).toBeNull();
    expect(q.current).toBe('high');
  });

  it('defers changes while an effect transition is active', () => {
    const q = new AdaptiveQuality('medium');
    q.observe(99, 30, 0, true);
    expect(q.observe(99, 30, 10_000, true)).toBeNull();
    expect(q.observe(99, 30, 10_001, false)).toBe('low');
  });
});

describe('mask processing', () => {
  it('computes coverage, bbox and head point and smooths over time', () => {
    const w = 16;
    const h = 9;
    const conf = new Float32Array(w * h);
    for (let y = 2; y < 9; y++) for (let x = 6; x < 10; x++) conf[y * w + x] = 1;
    const mp = new MaskProcessor(0.5);
    const a = mp.update(conf, w, h, 0);
    expect(a.info.coverage).toBeCloseTo(28 / 144, 5);
    expect(a.info.bbox).toEqual([6 / 16, 2 / 9, 10 / 16, 1]);
    expect(a.info.head[0]).toBeCloseTo(7.5 / 16, 5);
    expect(a.data[2 * w + 6]).toBe(255);
    // Person leaves: EMA halves the value instead of snapping to zero (no flicker).
    const b = mp.update(new Float32Array(w * h), w, h, 70);
    expect(b.data[2 * w + 6]).toBe(128);
    expect(b.version).toBe(a.version + 1);
    expect(personFraction(conf)).toBeCloseTo(28 / 144, 5);
  });
});

describe('background drift', () => {
  it('detects a changed room only on background pixels', () => {
    const n = THUMB_W * THUMB_H;
    const rgba = new Uint8ClampedArray(n * 4).fill(100);
    const thumb = lumaThumb(rgba);
    expect(backgroundDrift(rgba, thumb, null)).toBeCloseTo(0, 5);
    const brighter = new Uint8ClampedArray(n * 4).fill(160);
    expect(backgroundDrift(brighter, thumb, null)!).toBeGreaterThan(0.2);
    // If the person mask covers everything, there is nothing to compare.
    const mask = { data: new Uint8Array(4).fill(255), width: 2, height: 2 };
    expect(backgroundDrift(brighter, thumb, mask)).toBeNull();
  });
});

describe('dust particles', () => {
  it('scales the seeding grid by person coverage within the budget', () => {
    const g = particleGrid(PARTICLE_BUDGET.medium, 0.3, 16 / 9);
    expect(g.cols * g.rows * 0.3).toBeGreaterThan(PARTICLE_BUDGET.medium * 0.95);
    expect(g.cols * g.rows * 0.3).toBeLessThan(PARTICLE_BUDGET.medium * 1.1);
    const tiny = particleGrid(PARTICLE_BUDGET.high, 0.0001, 16 / 9);
    expect(tiny.cols * tiny.rows).toBeLessThanOrEqual(150_000 + tiny.cols);
  });
});

describe('semver', () => {
  it('compares versions numerically', () => {
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(() => compareSemver('1.0', '1.0.0')).toThrow();
  });
});
