import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_KEY, fetchPackText, refreshRemote, validateRemoteUrl } from '../../src/catalog/remote';
import { CatalogStore } from '../../src/catalog/store';
import type { KV } from '../../src/shared/storage';

const example = readFileSync(join(__dirname, '..', '..', 'docs', 'examples', 'example-pack.json'), 'utf8');
function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return { get: async <T>(k: string) => structuredClone(m.get(k)) as T | undefined, set: async (k, v) => void m.set(k, structuredClone(v)), onChange: () => () => {} };
}
const respond = (body: string, type = 'application/json', status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status, headers: { 'content-type': type } }));

afterEach(() => vi.restoreAllMocks());

describe('remote catalog', () => {
  it('accepts only plain https URLs', () => {
    expect(validateRemoteUrl('http://example.com/p.json')).toMatch(/https/);
    expect(validateRemoteUrl('https://u:p@example.com/p.json')).toMatch(/Credentials/);
    expect(validateRemoteUrl('https://example.com/p.json')).toBeNull();
  });

  it('enforces content type and pinned hash', async () => {
    respond(example, 'text/html');
    expect(await fetchPackText('https://example.com/p.json')).toMatchObject({ ok: false });
    respond(example);
    expect(await fetchPackText('https://example.com/p.json', '0'.repeat(64))).toMatchObject({ ok: false, error: /SHA-256/ });
  });

  it('installs a valid pack, refreshes at most daily, and keeps the collection on failure', async () => {
    const kv = memoryKV();
    const store = new CatalogStore(kv, '0.1.0');
    await kv.set(REMOTE_KEY, { url: 'https://example.com/p.json' });
    respond(example);
    expect(await refreshRemote(kv, store, { now: new Date('2026-10-26T10:00:00Z') })).toMatch(/Updated/);
    expect(await refreshRemote(kv, store, { now: new Date('2026-10-26T20:00:00Z') })).toBeNull();
    respond('{"broken": true}');
    expect(await refreshRemote(kv, store, { now: new Date('2026-10-27T11:00:00Z') })).toMatch(/Kept current/);
    expect((await store.list())[0]?.pack.packId).toBe('example-starter-pack');
    respond('', 'application/json', 503);
    expect(await refreshRemote(kv, store, { force: true })).toMatch(/HTTP 503/);
    expect(await store.list()).toHaveLength(1);
  });
});
