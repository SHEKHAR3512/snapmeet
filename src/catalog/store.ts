import type { KV } from '../shared/storage';
import { BUILTIN_EFFECTS } from './builtin';
import { compareSemver } from '../shared/semver';
import { validatePack, validatePackText, type EffectDefinition, type EffectPack } from './schema';

/**
 * Installed data-only effect packs. Each pack keeps its previous version for rollback.
 * Packs can only reference bundled templates and assets, so nothing here executes code.
 * A failed import or refresh never touches the currently installed collection.
 */
export const PACKS_KEY = 'snapmeet.packs';

export interface InstalledPack {
  pack: EffectPack;
  installedAt: string;
  source: 'file' | 'remote';
  enabled: boolean;
  previous: EffectPack | null;
}

export type ImportResult = { ok: true; warnings: string[]; pack: EffectPack } | { ok: false; errors: string[] };

const BUILTIN_IDS = new Set(BUILTIN_EFFECTS.map((e) => e.id));

export class CatalogStore {
  constructor(
    private kv: KV,
    private extensionVersion: string,
  ) {}

  async list(): Promise<InstalledPack[]> {
    const raw = await this.kv.get<unknown>(PACKS_KEY);
    if (!Array.isArray(raw)) return [];
    // Re-validate on read: storage could be stale from an older version or corrupted.
    const out: InstalledPack[] = [];
    for (const item of raw as InstalledPack[]) {
      const v = validatePack(item?.pack, this.extensionVersion);
      if (!v.ok) continue;
      const prev = item.previous ? validatePack(item.previous, this.extensionVersion) : null;
      out.push({
        pack: v.pack,
        installedAt: String(item.installedAt ?? ''),
        source: item.source === 'remote' ? 'remote' : 'file',
        enabled: item.enabled !== false,
        previous: prev?.ok ? prev.pack : null,
      });
    }
    return out;
  }

  /** Built-in effects followed by effects from enabled packs. */
  async definitions(): Promise<EffectDefinition[]> {
    const defs = [...BUILTIN_EFFECTS];
    const seen = new Set(BUILTIN_IDS);
    for (const p of await this.list()) {
      if (!p.enabled) continue;
      for (const e of p.pack.effects) {
        if (seen.has(e.id) || compareSemver(e.minExtensionVersion, this.extensionVersion) > 0) continue;
        seen.add(e.id);
        defs.push(e);
      }
    }
    return defs;
  }

  async importText(json: string, source: 'file' | 'remote' = 'file'): Promise<ImportResult> {
    const v = validatePackText(json, this.extensionVersion);
    if (!v.ok) return v;
    const packs = await this.list();
    const clash = v.pack.effects.find(
      (e) => BUILTIN_IDS.has(e.id) || packs.some((p) => p.pack.packId !== v.pack.packId && p.pack.effects.some((x) => x.id === e.id)),
    );
    if (clash) return { ok: false, errors: [`Effect id "${clash.id}" is already used by another collection`] };
    const existing = packs.find((p) => p.pack.packId === v.pack.packId);
    if (existing && compareSemver(v.pack.packVersion, existing.pack.packVersion) === 0 && source === 'remote') {
      return { ok: true, warnings: ['Already up to date'], pack: existing.pack };
    }
    const entry: InstalledPack = {
      pack: v.pack,
      installedAt: new Date().toISOString(),
      source,
      enabled: existing?.enabled ?? true,
      previous: existing ? existing.pack : null,
    };
    await this.save([...packs.filter((p) => p.pack.packId !== v.pack.packId), entry]);
    return { ok: true, warnings: v.warnings, pack: v.pack };
  }

  async rollback(packId: string): Promise<boolean> {
    const packs = await this.list();
    const p = packs.find((x) => x.pack.packId === packId);
    if (!p?.previous) return false;
    await this.save(packs.map((x) => (x === p ? { ...p, pack: p.previous!, previous: null, installedAt: new Date().toISOString() } : x)));
    return true;
  }

  async setEnabled(packId: string, enabled: boolean): Promise<void> {
    const packs = await this.list();
    await this.save(packs.map((x) => (x.pack.packId === packId ? { ...x, enabled } : x)));
  }

  async remove(packId: string): Promise<void> {
    await this.save((await this.list()).filter((p) => p.pack.packId !== packId));
  }

  private async save(packs: InstalledPack[]): Promise<void> {
    await this.kv.set(PACKS_KEY, packs);
  }
}
