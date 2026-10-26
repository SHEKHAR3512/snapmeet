import { useEffect, useState, type KeyboardEvent } from 'react';
import { useUi, type ControllerApi } from '../state';
import { DiagnosticsTab } from './DiagnosticsTab';
import { EffectsTab } from './EffectsTab';
import { GesturesTab } from './GesturesTab';
import { phaseLabel } from './labels';
import { SetupTab } from './SetupTab';

const TABS = [
  { id: 'effects', label: 'Effects' },
  { id: 'setup', label: 'Setup' },
  { id: 'gestures', label: 'Gestures' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function Dock({ api, inline = false }: { api: ControllerApi; inline?: boolean }) {
  const ui = useUi(api.store);
  const [tab, setTab] = useState<TabId>('effects');
  const [stale, setStale] = useState(false);
  const { status, settings, connected } = ui;
  const collapsed = !inline && settings.dockCollapsed;
  const label = phaseLabel(status, connected);
  const hidden = status?.effectPhase === 'VANISHED' || status?.effectPhase === 'DISINTEGRATING';
  const recovery = status?.phase === 'RECOVERY_REQUIRED';
  const selected = ui.definitions.find((d) => d.id === settings.selectedEffectId) ?? ui.definitions[0];
  const canPlay = !!status && status.enabled && status.phase === 'LIVE' && !hidden && status.effectPhase !== 'REAPPEARING';

  useEffect(() => {
    if (ui.requestedTab && TABS.some((t) => t.id === ui.requestedTab)) {
      setTab(ui.requestedTab as TabId);
      api.store.set({ requestedTab: null });
      if (settings.dockCollapsed && !inline) void api.updateSettings({ dockCollapsed: false });
    }
  }, [ui.requestedTab, api, settings.dockCollapsed, inline]);

  useEffect(() => {
    if (connected) return setStale(false);
    const t = setTimeout(() => setStale(true), 4000);
    return () => clearTimeout(t);
  }, [connected]);

  const setCollapsed = (v: boolean) => void api.updateSettings({ dockCollapsed: v });
  const reset = () => void api.command({ type: 'reset' });
  const reappear = () => void api.command({ type: 'reappear' });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !inline) {
      e.stopPropagation();
      setCollapsed(true);
    }
  };

  const rootClass = `sm-root${inline ? ' sm-inline' : ''}${settings.reducedMotion ? ' sm-reduced' : ''}`;

  if (collapsed) {
    return (
      <div className={rootClass}>
        <div className="sm-dock">
          <div className="sm-pill" role="region" aria-label="SnapMeet">
            <span className={`sm-dot ${label.tone}`} aria-hidden="true" />
            <button type="button" className="sm-pill-title" onClick={() => setCollapsed(false)} aria-expanded="false" title={label.text}>
              SnapMeet · {label.text}
            </button>
            {(hidden || recovery) && (
              <button type="button" className="sm-btn small primary" onClick={reappear}>
                {recovery ? 'Return to camera' : 'Reappear'}
              </button>
            )}
            <button type="button" className="sm-icon-btn" onClick={reset} aria-label="Reset effects" title="Reset effects (Alt+Shift+X)">
              ⟲
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <div className="sm-dock">
        <div className="sm-panel" role="region" aria-label="SnapMeet controls" onKeyDown={onKeyDown}>
          <div className="sm-header">
            <span className="sm-brand">SnapMeet</span>
            <span className="sm-chip" role="status">
              <span className={`sm-dot ${label.tone}`} aria-hidden="true" />
              {label.text}
            </span>
            {!inline && (
              <button type="button" className="sm-icon-btn" onClick={() => setCollapsed(true)} aria-label="Collapse controls" aria-expanded="true">
                ▾
              </button>
            )}
          </div>

          <div className="sm-banners" aria-live="polite">
            {stale && !connected && (
              <div className="sm-banner error">
                <p>SnapMeet is not connected to this tab. Reload the Meet tab (the extension may have been updated).</p>
              </div>
            )}
            {recovery && (
              <div className="sm-banner error strong">
                <p>
                  Your video is paused so your camera isn't revealed unexpectedly
                  {status?.recoveryReason === 'camera-restarted-while-vanished' ? ' (the camera restarted while you were vanished)' : ''}.
                </p>
                <button type="button" className="sm-btn small primary" onClick={reappear}>
                  Return to camera
                </button>
              </div>
            )}
            {hidden && !recovery && (
              <div className="sm-banner strong">
                <p>You're vanished. Others see the background; your microphone is unchanged.</p>
                <button type="button" className="sm-btn small primary" onClick={reappear}>
                  Reappear
                </button>
              </div>
            )}
            {status?.needsReacquire && (
              <div className="sm-banner warn">
                <p>
                  Meet started your camera before SnapMeet was on. Turn your camera off and on in Meet (Ctrl+E twice), or
                  reload before joining.
                </p>
              </div>
            )}
            {status?.webgl === 'unsupported' && (
              <div className="sm-banner error">
                <p>WebGL2 is unavailable, so effects are disabled. Your normal camera is still sent.</p>
              </div>
            )}
            {ui.notices.map((n) => (
              <div key={n.id} className={`sm-banner ${n.level === 'info' ? '' : n.level}`}>
                <p>{n.message}</p>
                {n.code === 'needs-setup' && tab !== 'setup' && (
                  <button type="button" className="sm-btn small" onClick={() => setTab('setup')}>
                    Set up
                  </button>
                )}
                <button type="button" className="sm-icon-btn" style={{ width: 30, height: 30 }} aria-label="Dismiss" onClick={() => api.store.dismissNotice(n.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="sm-tabs" role="tablist" aria-label="SnapMeet sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`sm-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`sm-panel-${t.id}`}
                className="sm-tab"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="sm-body" role="tabpanel" id={`sm-panel-${tab}`} aria-labelledby={`sm-tab-${tab}`}>
            {tab === 'effects' && <EffectsTab api={api} ui={ui} />}
            {tab === 'setup' && <SetupTab api={api} ui={ui} />}
            {tab === 'gestures' && <GesturesTab api={api} ui={ui} />}
            {tab === 'diagnostics' && <DiagnosticsTab api={api} ui={ui} />}
          </div>

          <div className="sm-footer">
            {hidden || recovery ? (
              <button type="button" className="sm-btn primary" onClick={reappear}>
                {recovery ? 'Return to camera' : 'Reappear'}
              </button>
            ) : (
              <button
                type="button"
                className="sm-btn primary"
                disabled={!canPlay || !selected}
                onClick={() => selected && void api.command({ type: 'trigger', effectId: selected.id })}
                title="Alt+Shift+S"
              >
                Play {selected?.title ?? 'effect'}
              </button>
            )}
            <button type="button" className="sm-btn" onClick={reset} title="Alt+Shift+X">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
