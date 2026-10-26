import { useMemo, useState } from 'react';
import { effectBadge, filterEffects, type CatalogFilter } from '../../catalog/labels';
import type { ControllerApi, UiState } from '../state';
import { EffectPreview } from './EffectPreview';
import { REGION_LABEL } from './labels';

const FILTERS: Array<{ id: CatalogFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'IN', label: 'India' },
  { id: 'US', label: 'USA' },
  { id: 'GLOBAL', label: 'Global' },
  { id: 'FAVORITES', label: 'Favorites' },
  { id: 'NEW', label: 'New' },
];

export function EffectsTab({ api, ui }: { api: ControllerApi; ui: UiState }) {
  const [filter, setFilter] = useState<CatalogFilter>('ALL');
  const [query, setQuery] = useState('');
  const { settings, definitions, status } = ui;
  const now = useMemo(() => new Date(), []);
  const shown = filterEffects(definitions, filter, query, settings.favorites, now);

  const toggleFavorite = (id: string) => {
    const favorites = settings.favorites.includes(id)
      ? settings.favorites.filter((f) => f !== id)
      : [...settings.favorites, id].slice(-64);
    void api.updateSettings({ favorites });
  };

  const play = (id: string) => {
    if (settings.selectedEffectId !== id) void api.updateSettings({ selectedEffectId: id });
    void api.command({ type: 'trigger', effectId: id });
  };

  return (
    <div>
      <input
        className="sm-search"
        type="search"
        placeholder="Search effects"
        aria-label="Search effects"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="sm-filters" role="group" aria-label="Filter effects">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="sm-filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="sm-empty">
          {filter === 'FAVORITES' && !query ? 'No favorites yet — tap ☆ on an effect.' : 'No effects match.'}
        </p>
      ) : (
        <div className="sm-grid">
          {shown.map((d) => {
            const badge = effectBadge(d, now);
            const selected = settings.selectedEffectId === d.id;
            const active = status?.activeEffectId === d.id;
            const fav = settings.favorites.includes(d.id);
            return (
              <div key={d.id} className={`sm-card${selected ? ' selected' : ''}${active ? ' active' : ''}`}>
                <button
                  type="button"
                  className="sm-card-main"
                  onClick={() => play(d.id)}
                  aria-label={`Play ${d.title}`}
                  title={d.description ?? d.title}
                >
                  <EffectPreview def={d} />
                  <span className="sm-card-meta">
                    <span className="sm-card-title">{d.title}</span>
                    <span className="sm-card-sub" style={{ display: 'block' }}>
                      {d.regions.map((r) => REGION_LABEL[r]).join(' · ')}
                      {d.requires.includes('person-mask') ? ' · needs setup' : ''}
                    </span>
                  </span>
                </button>
                {badge && <span className="sm-badge">{badge === 'trending' ? 'Trending' : 'New'}</span>}
                <button
                  type="button"
                  className="sm-star"
                  aria-pressed={fav}
                  aria-label={fav ? `Remove ${d.title} from favorites` : `Add ${d.title} to favorites`}
                  onClick={() => toggleFavorite(d.id)}
                >
                  {fav ? '★' : '☆'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
