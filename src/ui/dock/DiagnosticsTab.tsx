import { useEffect } from 'react';
import type { ControllerApi, UiState } from '../state';
import { SHORTCUTS } from './labels';

export function DiagnosticsTab({ api, ui }: { api: ControllerApi; ui: UiState }) {
  useEffect(() => {
    void api.command({ type: 'get-diagnostics' });
    const t = setInterval(() => void api.command({ type: 'get-diagnostics' }), 1000);
    return () => clearInterval(t);
  }, [api]);
  const d = ui.diagnostics;
  const s = ui.status;
  const rows: Array<[string, string]> = [
    ['State', s ? `${s.phase} / ${s.effectPhase}` : '—'],
    ['Camera streams', String(s?.pipelines ?? 0)],
    ['Source', d ? `${d.sourceWidth}×${d.sourceHeight}` : '—'],
    ['Output', d ? `${d.outputWidth}×${d.outputHeight} (${d.quality})` : '—'],
    ['Render rate', d ? `${d.renderFps} fps` : '—'],
    ['Pipeline time', d ? `p50 ${d.pipelineMsP50} ms · p95 ${d.pipelineMsP95} ms` : '—'],
    ['Segmentation', d ? `${d.segmentationHz}/s · p50 ${d.segmentationMs} ms · p95 ${d.segmentationMsP95} ms` : '—'],
    ['Hand tracking', d ? `${d.handsHz}/s · p50 ${d.handsMs} ms · p95 ${d.handsMsP95} ms` : '—'],
    ['Dropped frames', String(d?.droppedFrames ?? 0)],
    ['Frame path', d?.frameSource ?? '—'],
    ['WebGL', s?.webgl ?? '—'],
    ['Vision', s ? `${s.vision}${d?.visionDelegate ? ` (${d.visionDelegate})` : ''}` : '—'],
    ['Model labels', d?.segmenterLabels.join(', ') || '—'],
    ['Person in frame', d?.personCoverage == null ? '—' : `${Math.round(d.personCoverage * 100)}% of mask`],
    ['Background', s ? `${s.background.mode}${s.background.available ? ' · ready' : ' · not set'}${s.background.stale ? ' · stale' : ''}` : '—'],
  ];
  return (
    <div>
      <dl className="sm-kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {(s?.visionError || d?.errors.length) ? (
        <section className="sm-section" style={{ marginTop: 12 }}>
          <h3>Recent errors</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {s?.visionError && <li>{s.visionError}</li>}
            {d?.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      ) : null}
      <section className="sm-section" style={{ marginTop: 12 }}>
        <h3>Shortcuts</h3>
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="sm-row" style={{ minHeight: 26 }}>
            <span>{s.action}</span>
            <span className="sm-kbd">{s.keys}</span>
          </div>
        ))}
        <p className="sm-hint">Change them at chrome://extensions/shortcuts. Diagnostics never include video, names or meeting codes.</p>
      </section>
    </div>
  );
}
