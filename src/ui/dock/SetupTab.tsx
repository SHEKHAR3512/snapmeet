import { useEffect, useRef, useState } from 'react';
import { CUSTOM_IMAGE_LIMITS, VIRTUAL_BACKGROUNDS, type VirtualBackground } from '../../shared/backgrounds';
import type { BackgroundMode, Quality } from '../../shared/settings';
import type { ControllerApi, UiState } from '../state';

const COUNTDOWN_S = 5;

export function SetupTab({ api, ui }: { api: ControllerApi; ui: UiState }) {
  const { settings, status } = ui;
  const set = (patch: Parameters<ControllerApi['updateSettings']>[0]) => void api.updateSettings(patch);
  return (
    <div>
      <section className="sm-section" aria-labelledby="sm-bg-h">
        <h3 id="sm-bg-h">Disappearance background</h3>
        <div className="sm-seg" role="group" aria-label="Background mode">
          {(
            [
              ['captured', 'Empty room'],
              ['virtual', 'Virtual'],
              ['custom', 'My image'],
            ] as Array<[BackgroundMode, string]>
          ).map(([mode, label]) => (
            <button key={mode} type="button" aria-pressed={settings.backgroundMode === mode} onClick={() => set({ backgroundMode: mode })}>
              {label}
            </button>
          ))}
        </div>
        {settings.backgroundMode === 'captured' && <CaptureFlow api={api} ui={ui} />}
        {settings.backgroundMode === 'virtual' && (
          <div className="sm-thumbs" role="group" aria-label="Virtual backgrounds">
            {VIRTUAL_BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                type="button"
                className="sm-thumb"
                aria-pressed={settings.virtualBackgroundId === bg.id}
                aria-label={bg.title}
                title={bg.title}
                onClick={() => set({ virtualBackgroundId: bg.id })}
              >
                <VirtualThumb bg={bg} />
              </button>
            ))}
          </div>
        )}
        {settings.backgroundMode === 'custom' && <CustomImage api={api} available={!!status?.background.available} />}
      </section>

      <section className="sm-section" aria-labelledby="sm-q-h">
        <h3 id="sm-q-h">Quality & motion</h3>
        <div className="sm-row">
          <label htmlFor="sm-quality">Output quality</label>
          <select
            id="sm-quality"
            className="sm-select"
            value={settings.quality}
            onChange={(e) => set({ quality: e.target.value as Quality })}
          >
            <option value="low">Low (480p)</option>
            <option value="medium">Medium (720p)</option>
            <option value="high">High (source)</option>
          </select>
        </div>
        <Toggle id="sm-auto" label="Lower quality automatically when slow" checked={settings.autoQuality} onChange={(v) => set({ autoQuality: v })} />
        <Toggle id="sm-rm" label="Reduced motion (no shakes or flashes)" checked={settings.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
        <div className="sm-row">
          <label htmlFor="sm-reappear">After Dust Away</label>
          <select
            id="sm-reappear"
            className="sm-select"
            value={settings.reappearAfterMs}
            onChange={(e) => set({ reappearAfterMs: Number(e.target.value) })}
          >
            <option value={3000}>Reappear after 3 s</option>
            <option value={5000}>Reappear after 5 s</option>
            <option value={10000}>Reappear after 10 s</option>
            <option value={0}>Stay vanished</option>
          </select>
        </div>
        <Toggle
          id="sm-proof"
          label="Proof mode (grayscale + live watermark)"
          checked={settings.proofMode}
          onChange={(v) => set({ proofMode: v })}
        />
        <p className="sm-hint">Proof mode verifies that other participants receive SnapMeet's processed video.</p>
      </section>
    </div>
  );
}

export function Toggle(props: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="sm-row">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className="sm-switch"
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </div>
  );
}

function VirtualThumb({ bg }: { bg: VirtualBackground }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) bg.paint(ctx, c.width, c.height);
  }, [bg]);
  return <canvas ref={ref} width={160} height={90} />;
}

export function BitmapView({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d')?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return <canvas ref={ref} />;
}

function CaptureFlow({ api, ui }: { api: ControllerApi; ui: UiState }) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bg = ui.status?.background;
  const live = ui.status?.phase === 'LIVE';

  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      setCount(null);
      api.command({ type: 'capture-background' }).then((r) => setError(r.ok ? null : (r.error ?? 'Capture failed')));
      return;
    }
    const t = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(t);
  }, [count, api]);

  if (count !== null) {
    return (
      <div role="status" aria-live="assertive">
        <div className="sm-countdown">{count}</div>
        <p className="sm-hint" style={{ textAlign: 'center' }}>
          Step out of the frame. Keep the camera still.
        </p>
        <button type="button" className="sm-btn" style={{ width: '100%' }} onClick={() => setCount(null)}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div>
      <p className="sm-hint">
        Capture your empty room once. If the camera moves or the light changes, recapture. The image stays in memory for
        this call only.
      </p>
      {ui.bgPreview && bg?.available && (
        <div className="sm-preview">
          <BitmapView bitmap={ui.bgPreview.bitmap} />
        </div>
      )}
      {bg?.personVisible && <p className="sm-hint" style={{ color: 'var(--sm-danger)' }}>Someone still seems to be in the shot. Recapture after stepping fully out.</p>}
      {bg?.stale && <p className="sm-hint" style={{ color: 'var(--sm-danger)' }}>The camera or its shape changed since capture. Recapture.</p>}
      {bg?.drift && !bg.stale && <p className="sm-hint" style={{ color: 'var(--sm-accent)' }}>The room looks different now (camera moved or lighting changed). Recapture for a clean vanish.</p>}
      {error && <p className="sm-hint" style={{ color: 'var(--sm-danger)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="sm-btn primary" disabled={!live} onClick={() => setCount(COUNTDOWN_S)}>
          {bg?.available || bg?.stale ? 'Recapture empty room' : 'Capture empty room'}
        </button>
        {(bg?.available || bg?.stale) && (
          <button type="button" className="sm-btn" onClick={() => void api.command({ type: 'clear-background' })}>
            Clear
          </button>
        )}
      </div>
      {!live && <p className="sm-hint">Turn your camera on to capture.</p>}
    </div>
  );
}

function CustomImage({ api, available }: { api: ControllerApi; available: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <p className="sm-hint">
        PNG, JPEG or WebP up to {CUSTOM_IMAGE_LIMITS.maxBytes / (1024 * 1024)} MB. Kept in memory for this call only.
      </p>
      <input
        type="file"
        accept={CUSTOM_IMAGE_LIMITS.types.join(',')}
        aria-label="Choose background image"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const r = await api.setCustomBackground(f);
          setMsg(r.ok ? 'Background set.' : (r.error ?? 'Could not use that image.'));
          e.target.value = '';
        }}
      />
      {msg && <p className="sm-hint">{msg}</p>}
      {!msg && available && <p className="sm-hint">A custom image is active.</p>}
    </div>
  );
}
