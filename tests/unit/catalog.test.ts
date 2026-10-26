import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_EFFECTS, BUILTIN_PACK } from '../../src/catalog/builtin';
import { effectBadge, filterEffects } from '../../src/catalog/labels';
import { EffectDefinitionSchema, PACK_MAX_BYTES, parseDefinitions, validatePack, validatePackText } from '../../src/catalog/schema';
import { CatalogStore } from '../../src/catalog/store';
import type { KV } from '../../src/shared/storage';

const VERSION = '0.1.0';
const example = readFileSync(join(__dirname, '..', '..', 'docs', 'examples', 'example-pack.json'), 'utf8');

function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => structuredClone(m.get(k)) as T | undefined,
    set: async (k, v) => void m.set(k, structuredClone(v)),
    onChange: () => () => {},
  };
}

describe('catalog schema', () => {
  it('accepts every bundled definition and the built-in pack', () => {
    for (const d of BUILTIN_EFFECTS) expect(EffectDefinitionSchema.safeParse(d).success, d.id).toBe(true);
    expect(validatePack(BUILTIN_PACK, VERSION).ok).toBe(true);
    expect(BUILTIN_EFFECTS.filter((d) => ['dust-away', 'absolute-cinema'].includes(d.id))).toHaveLength(2);
    expect(new Set(BUILTIN_EFFECTS.map((d) => d.template)).size).toBe(8);
  });

  it('accepts the documented example pack', () => {
    const r = validatePackText(example, VERSION);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('rejects unknown templates, unknown parameters and out-of-range values', () => {
    const base = structuredClone(BUILTIN_EFFECTS.find((d) => d.id === 'absolute-cinema')!) as Record<string, unknown>;
    expect(EffectDefinitionSchema.safeParse({ ...base, template: 'remote-shader' }).success).toBe(false);
    expect(EffectDefinitionSchema.safeParse({ ...base, parameters: { title: 'X', shader: 'void main(){}' } }).success).toBe(false);
    expect(EffectDefinitionSchema.safeParse({ ...base, parameters: { barSize: 5 } }).success).toBe(false);
    expect(EffectDefinitionSchema.safeParse({ ...base, onload: 'alert(1)' }).success).toBe(false);
  });

  it('rejects markup in captions and non-https sources', () => {
    const base = structuredClone(BUILTIN_EFFECTS.find((d) => d.id === 'emotional-damage')!) as Record<string, unknown>;
    expect(EffectDefinitionSchema.safeParse({ ...base, parameters: { caption: '<img src=x>' } }).success).toBe(false);
    expect(EffectDefinitionSchema.safeParse({ ...base, sources: [{ url: 'http://example.com', checkedAt: '2026-10-01' }] }).success).toBe(false);
    expect(EffectDefinitionSchema.safeParse({ ...base, sources: [{ url: 'javascript:alert(1)', checkedAt: '2026-10-01' }] }).success).toBe(false);
  });

  it('requires dust-away definitions to declare mask and background requirements', () => {
    const base = structuredClone(BUILTIN_EFFECTS.find((d) => d.id === 'dust-away')!) as Record<string, unknown>;
    expect(EffectDefinitionSchema.safeParse({ ...base, requires: ['person-mask'] }).success).toBe(false);
  });

  it('rejects oversized, malformed and too-new packs with readable errors', () => {
    expect(validatePackText('x'.repeat(PACK_MAX_BYTES + 1), VERSION)).toMatchObject({ ok: false });
    expect(validatePackText('{not json', VERSION)).toMatchObject({ ok: false });
    const pack = JSON.parse(example);
    pack.minExtensionVersion = '9.0.0';
    const r = validatePack(pack, VERSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/requires SnapMeet 9\.0\.0/);
  });

  it('rejects duplicate ids and dangling attributions', () => {
    const pack = JSON.parse(example);
    pack.effects.push(pack.effects[0]);
    expect(validatePack(pack, VERSION).ok).toBe(false);
    const pack2 = JSON.parse(example);
    pack2.effects[0].attributionIds = ['nobody'];
    expect(validatePack(pack2, VERSION).ok).toBe(false);
  });

  it('parseDefinitions drops invalid entries instead of throwing', () => {
    expect(parseDefinitions('nope', VERSION)).toEqual([]);
    expect(parseDefinitions([BUILTIN_EFFECTS[0], { id: 'bad' }], VERSION)).toHaveLength(1);
  });
});

describe('labels and filters', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  it('labels recent effects New and only shows Trending with recent sources', () => {
    const d = { ...BUILTIN_EFFECTS[1]!, addedAt: '2026-01-01' };
    expect(effectBadge(d, now)).toBeNull();
    expect(effectBadge({ ...d, addedAt: '2026-10-20' }, now)).toBe('new');
    expect(effectBadge({ ...d, badge: 'trending' }, now)).toBeNull();
    expect(effectBadge({ ...d, badge: 'trending', sources: [{ url: 'https://example.com', checkedAt: '2026-10-15' }] }, now)).toBe('trending');
    expect(effectBadge({ ...d, badge: 'trending', sources: [{ url: 'https://example.com', checkedAt: '2026-08-01' }] }, now)).toBeNull();
  });

  it('filters by region, favorites and search', () => {
    expect(filterEffects(BUILTIN_EFFECTS, 'IN', '', [], now).every((d) => d.regions.includes('IN'))).toBe(true);
    expect(filterEffects(BUILTIN_EFFECTS, 'FAVORITES', '', ['aayein'], now).map((d) => d.id)).toEqual(['aayein']);
    expect(filterEffects(BUILTIN_EFFECTS, 'ALL', 'cinema', [], now).map((d) => d.id)).toContain('absolute-cinema');
    expect(filterEffects(BUILTIN_EFFECTS, 'ALL', 'zzzz', [], now)).toEqual([]);
  });
});

describe('CatalogStore', () => {
  it('imports, lists, rolls back, disables and removes packs', async () => {
    const store = new CatalogStore(memoryKV(), VERSION);
    const r = await store.importText(example);
    expect(r.ok).toBe(true);
    const ids = (await store.definitions()).map((d) => d.id);
    expect(ids.slice(0, BUILTIN_EFFECTS.length)).toEqual(BUILTIN_EFFECTS.map((d) => d.id));
    expect(ids.length).toBeGreaterThan(BUILTIN_EFFECTS.length);

    const v2 = JSON.parse(example);
    v2.packVersion = '1.1.0';
    v2.effects[0].title = 'Updated title';
    expect((await store.importText(JSON.stringify(v2))).ok).toBe(true);
    let [p] = await store.list();
    expect(p!.pack.packVersion).toBe('1.1.0');
    expect(p!.previous?.packVersion).toBe('1.0.0');
    expect(await store.rollback(p!.pack.packId)).toBe(true);
    [p] = await store.list();
    expect(p!.pack.packVersion).toBe('1.0.0');

    await store.setEnabled(p!.pack.packId, false);
    expect((await store.definitions()).length).toBe(BUILTIN_EFFECTS.length);
    await store.remove(p!.pack.packId);
    expect(await store.list()).toEqual([]);
  });

  it('a failed import leaves the installed collection untouched', async () => {
    const store = new CatalogStore(memoryKV(), VERSION);
    await store.importText(example);
    const before = await store.list();
    expect((await store.importText('{"packId": 1}')).ok).toBe(false);
    expect(await store.list()).toEqual(before);
  });

  it('refuses packs that reuse built-in effect ids', async () => {
    const store = new CatalogStore(memoryKV(), VERSION);
    const bad = JSON.parse(example);
    bad.effects[0].id = 'dust-away';
    const r = await store.importText(JSON.stringify(bad));
    expect(r.ok).toBe(false);
  });

  it('drops corrupted stored entries on read', async () => {
    const kv = memoryKV();
    await kv.set('snapmeet.packs', [{ pack: { packId: 'x' } }, 'garbage']);
    expect(await new CatalogStore(kv, VERSION).list()).toEqual([]);
  });
});
