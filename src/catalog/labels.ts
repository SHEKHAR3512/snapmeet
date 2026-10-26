import type { EffectDefinition, Region } from './schema';

const DAY = 86_400_000;

/**
 * "Trending" is shown only when the curator marked it and at least one source was
 * checked within the last 30 days. Otherwise recently added effects show "New".
 * No popularity scores are computed or invented.
 */
export function effectBadge(def: EffectDefinition, now: Date): 'trending' | 'new' | null {
  const t = now.getTime();
  if (def.badge === 'trending' && def.sources?.some((s) => t - Date.parse(s.checkedAt) <= 30 * DAY)) {
    return 'trending';
  }
  if (t - Date.parse(def.addedAt) <= 45 * DAY) return 'new';
  return null;
}

export type CatalogFilter = 'ALL' | Region | 'FAVORITES' | 'NEW';

export function filterEffects(
  defs: EffectDefinition[],
  filter: CatalogFilter,
  query: string,
  favorites: readonly string[],
  now: Date,
): EffectDefinition[] {
  const q = query.trim().toLowerCase();
  return defs.filter((d) => {
    if (filter === 'FAVORITES' && !favorites.includes(d.id)) return false;
    if (filter === 'NEW' && effectBadge(d, now) === null) return false;
    if ((filter === 'IN' || filter === 'US' || filter === 'GLOBAL') && !d.regions.includes(filter)) return false;
    if (!q) return true;
    return (
      d.title.toLowerCase().includes(q) ||
      d.tags.some((t) => t.includes(q)) ||
      (d.description?.toLowerCase().includes(q) ?? false)
    );
  });
}
