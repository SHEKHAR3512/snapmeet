import type { KV } from '../shared/storage';
import { PACK_MAX_BYTES } from './schema';
import type { CatalogStore } from './store';

/**
 * Optional remote collection refresh (V1.1). Fetches a static JSON pack over HTTPS at
 * most once a day (or on explicit refresh), validates size, content type, optional
 * SHA-256 and schema, then installs it through CatalogStore — which keeps the previous
 * version for rollback and never touches the installed collection on failure.
 * Packs are data only and can reference bundled templates/assets only.
 */
export const REMOTE_KEY = 'snapmeet.remoteCatalog';
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RemoteConfig {
  url: string;
  sha256?: string;
  lastCheckedAt?: string;
  lastResult?: string;
}

export function validateRemoteUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'Not a valid URL';
  }
  if (u.protocol !== 'https:') return 'Only https:// URLs are allowed';
  if (u.username || u.password) return 'Credentials in URLs are not allowed';
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchPackText(url: string, expectedSha256?: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const bad = validateRemoteUrl(url);
  if (bad) return { ok: false, error: bad };
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', cache: 'no-cache', redirect: 'error' });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const type = res.headers.get('content-type') ?? '';
  if (!/^application\/(json|[a-z.+-]*\+json)\b/i.test(type) && !/^text\/plain\b/i.test(type)) {
    return { ok: false, error: `Unexpected content type ${type || '(none)'}` };
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > PACK_MAX_BYTES) return { ok: false, error: 'Pack is too large' };
  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > PACK_MAX_BYTES) return { ok: false, error: 'Pack is too large' };
  if (expectedSha256 && (await sha256Hex(text)) !== expectedSha256.toLowerCase()) {
    return { ok: false, error: 'SHA-256 does not match the pinned value' };
  }
  return { ok: true, text };
}

/** Refreshes the configured remote pack if due (or forced). Returns a short status line. */
export async function refreshRemote(kv: KV, catalog: CatalogStore, opts: { force?: boolean; now?: Date } = {}): Promise<string | null> {
  const cfg = await kv.get<RemoteConfig>(REMOTE_KEY);
  if (!cfg?.url) return null;
  const now = opts.now ?? new Date();
  if (!opts.force && cfg.lastCheckedAt && now.getTime() - Date.parse(cfg.lastCheckedAt) < REFRESH_INTERVAL_MS) return null;
  const fetched = await fetchPackText(cfg.url, cfg.sha256);
  let result: string;
  if (!fetched.ok) {
    result = `Kept current collection: ${fetched.error}`;
  } else {
    const r = await catalog.importText(fetched.text, 'remote');
    result = r.ok ? `Updated to ${r.pack.title} ${r.pack.packVersion}${r.warnings.length ? ` (${r.warnings.join('; ')})` : ''}` : `Kept current collection: ${r.errors[0]}`;
  }
  await kv.set(REMOTE_KEY, { ...cfg, lastCheckedAt: now.toISOString(), lastResult: result });
  return result;
}
