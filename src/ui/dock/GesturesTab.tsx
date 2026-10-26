import { CALIBRATION_ATTEMPTS } from '../../gestures/calibration';
import { thresholdsFor } from '../../gestures/snap-detector';
import type { ControllerApi, UiState } from '../state';
import { Toggle } from './SetupTab';

export function GesturesTab({ api, ui }: { api: ControllerApi; ui: UiState }) {
  const { settings, status, definitions } = ui;
  const set = (patch: Parameters<ControllerApi['updateSettings']>[0]) => void api.updateSettings(patch);
  const cal = status?.calibration;
  const snap = status?.snap;
  const th = thresholdsFor(settings.snapSensitivity);
  // Closeness meter: full when the thumb and middle finger touch.
  const closeness = snap?.closeness ?? null;
  const meter = closeness === null ? 0 : Math.max(0, Math.min(1, 1 - (closeness - th.close) / (th.open + 0.4 - th.close)));
  const recentGesture = ui.lastGesture && Date.now() - ui.lastGesture.at < 2500 ? ui.lastGesture : null;

  return (
    <div>
      <section className="sm-section" aria-labelledby="sm-snap-h">
        <h3 id="sm-snap-h">
          Finger snap <span className="sm-exp">Experimental</span>
        </h3>
        <p className="sm-hint">
          Snap detection uses hand landmarks and a timing heuristic. It can miss snaps or fire by accident; buttons and
          shortcuts always work. Keep your hand visible in the frame.
        </p>
        <Toggle id="sm-snap" label="Snap to trigger" checked={settings.snapEnabled} onChange={(v) => set({ snapEnabled: v })} />
        <div className="sm-row">
          <label htmlFor="sm-snap-effect">Snap plays</label>
          <select
            id="sm-snap-effect"
            className="sm-select"
            value={settings.snapEffectId}
            onChange={(e) => set({ snapEffectId: e.target.value })}
          >
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        <div className="sm-row">
          <label htmlFor="sm-sens">Sensitivity</label>
          <input
            id="sm-sens"
            className="sm-range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.snapSensitivity}
            onChange={(e) => set({ snapSensitivity: Number(e.target.value) })}
            aria-valuetext={`${Math.round(settings.snapSensitivity * 100)}%`}
          />
        </div>

        <div className="sm-banner" role="status" aria-live="polite" style={{ marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="sm-row" style={{ minHeight: 24 }}>
              <span>
                {!settings.snapEnabled && !settings.palmsEnabled && !cal?.active
                  ? 'Hand tracking is off'
                  : status?.vision === 'loading'
                    ? 'Loading hand tracking…'
                    : status?.vision !== 'ready'
                      ? 'Hand tracking unavailable'
                      : snap?.tracked
                        ? 'Hand tracked'
                        : 'No hand in view'}
              </span>
              <span className="sm-chip">
                {recentGesture?.gesture === 'snap'
                  ? 'Snap!'
                  : recentGesture?.gesture === 'near-miss'
                    ? recentGesture.detail === 'slow-release'
                      ? 'Too slow'
                      : 'Finger did not curl'
                    : snap?.primed
                      ? 'Ready'
                      : snap?.coolingDown
                        ? 'Cooldown'
                        : '—'}
              </span>
            </div>
            <div className="sm-meter" aria-label="Thumb to middle finger closeness">
              <div style={{ width: `${Math.round(meter * 100)}%` }} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          {cal?.active ? (
            <>
              <p className="sm-hint">
                Practice: snap {CALIBRATION_ATTEMPTS} times. Calibration never triggers effects.
              </p>
              <div className="sm-dots" aria-label={`${cal.attempts.length} of ${CALIBRATION_ATTEMPTS} attempts`}>
                {Array.from({ length: CALIBRATION_ATTEMPTS }, (_, i) => {
                  const a = cal.attempts[i];
                  return <span key={i} className={a ? (a.ok ? 'ok' : 'miss') : ''} />;
                })}
              </div>
              <button type="button" className="sm-btn" onClick={() => void api.command({ type: 'calibration', action: 'stop' })}>
                Stop practice
              </button>
            </>
          ) : (
            <>
              {cal && cal.attempts.length > 0 && (
                <p className="sm-hint">
                  Last practice: {cal.attempts.filter((a) => a.ok).length}/{cal.attempts.length} recognized.
                  {cal.recommendedSensitivity !== null && cal.recommendedSensitivity !== settings.snapSensitivity && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="sm-btn small"
                        onClick={() => set({ snapSensitivity: cal.recommendedSensitivity! })}
                      >
                        Use suggested sensitivity {Math.round(cal.recommendedSensitivity * 100)}%
                      </button>
                    </>
                  )}
                </p>
              )}
              <button
                type="button"
                className="sm-btn"
                disabled={status?.phase !== 'LIVE' || status.effectPhase !== 'IDLE'}
                onClick={() => void api.command({ type: 'calibration', action: 'start' })}
              >
                Practice {CALIBRATION_ATTEMPTS} snaps
              </button>
            </>
          )}
        </div>
      </section>

      <section className="sm-section" aria-labelledby="sm-palms-h">
        <h3 id="sm-palms-h">
          Two raised palms <span className="sm-exp">Experimental</span>
        </h3>
        <Toggle id="sm-palms" label="Raise both open palms for Absolute Cinema" checked={settings.palmsEnabled} onChange={(v) => set({ palmsEnabled: v })} />
      </section>
    </div>
  );
}
