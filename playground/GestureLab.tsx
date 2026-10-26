import { useEffect, useRef, useState } from 'react';
import { api, onGesture, store } from './engine-host';

/**
 * Local, consented gesture trials (plan §8). Counts recognized snaps and near-misses during
 * a timed trial. Results stay on this device unless you export them yourself; no video is
 * recorded.
 */
const TRIALS = [
  { id: 'intended-snaps', label: 'Intended snaps (aim for 30)' },
  { id: 'pinch', label: 'Pinching' },
  { id: 'wave', label: 'Waving' },
  { id: 'typing', label: 'Typing' },
  { id: 'face-touch', label: 'Face touching' },
  { id: 'clapping', label: 'Clapping' },
  { id: 'conversation', label: 'Normal conversation (10 min)' },
] as const;

interface TrialResult {
  trial: string;
  participant: string;
  lighting: string;
  durationS: number;
  attempts: number | null;
  snaps: number;
  nearMisses: number;
  sensitivity: number;
  at: string;
}

const RESULTS_KEY = 'snapmeet.gestureTrials';

export function GestureLab() {
  const [trial, setTrial] = useState<string>(TRIALS[0].id);
  const [participant, setParticipant] = useState('P1');
  const [lighting, setLighting] = useState('normal');
  const [running, setRunning] = useState<{ start: number; snaps: number; near: number } | null>(null);
  const [attempts, setAttempts] = useState('30');
  const [results, setResults] = useState<TrialResult[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '[]') as TrialResult[];
    } catch {
      return [];
    }
  });
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(
    () =>
      onGesture((ev) => {
        const r = runningRef.current;
        if (!r) return;
        setRunning({ ...r, snaps: r.snaps + (ev.gesture === 'snap' ? 1 : 0), near: r.near + (ev.gesture === 'near-miss' ? 1 : 0) });
      }),
    [],
  );

  const save = (next: TrialResult[]) => {
    setResults(next);
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable
    }
  };

  const startTrial = () => {
    if (!store.get().settings.snapEnabled) void api.updateSettings({ snapEnabled: true });
    setRunning({ start: performance.now(), snaps: 0, near: 0 });
  };

  const stopTrial = () => {
    const r = running;
    if (!r) return;
    setRunning(null);
    save([
      ...results,
      {
        trial,
        participant,
        lighting,
        durationS: Math.round((performance.now() - r.start) / 1000),
        attempts: trial === 'intended-snaps' ? Number(attempts) || null : null,
        snaps: r.snaps,
        nearMisses: r.near,
        sensitivity: store.get().settings.snapSensitivity,
        at: new Date().toISOString(),
      },
    ]);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'snapmeet-gesture-trials.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <section className="card stack" aria-labelledby="lab-h" style={{ marginTop: 16 }}>
      <h2 id="lab-h">Gesture trials (local)</h2>
      <p className="muted small">
        Run consented trials to measure the experimental snap detector: deliberate snaps, then everyday movements that
        should <em>not</em> trigger. Effects still play during trials; switch the snap effect to something short if needed.
      </p>
      <div className="btns">
        <select aria-label="Trial type" value={trial} onChange={(e) => setTrial(e.target.value)} disabled={!!running}>
          {TRIALS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input type="text" aria-label="Participant label" value={participant} onChange={(e) => setParticipant(e.target.value)} style={{ width: 70 }} />
        <select aria-label="Lighting" value={lighting} onChange={(e) => setLighting(e.target.value)}>
          <option value="normal">Normal light</option>
          <option value="dim">Dim light</option>
          <option value="backlit">Backlit</option>
        </select>
        {trial === 'intended-snaps' && (
          <input type="number" aria-label="Snap attempts made" min={1} max={200} value={attempts} onChange={(e) => setAttempts(e.target.value)} style={{ width: 70 }} />
        )}
        {running ? (
          <button type="button" className="btn primary" onClick={stopTrial}>
            Stop trial ({running.snaps} snaps, {running.near} near-misses)
          </button>
        ) : (
          <button type="button" className="btn" onClick={startTrial}>
            Start trial
          </button>
        )}
      </div>
      {results.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>Trial</th>
                <th>Who / light</th>
                <th>Duration</th>
                <th>Detected</th>
                <th>Near-miss</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.trial}</td>
                  <td>
                    {r.participant} / {r.lighting}
                  </td>
                  <td>{r.durationS}s</td>
                  <td>{r.attempts ? `${r.snaps}/${r.attempts}` : r.snaps}</td>
                  <td>{r.nearMisses}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btns">
            <button type="button" className="btn" onClick={exportJson}>
              Export JSON
            </button>
            <button type="button" className="btn danger" onClick={() => save([])}>
              Clear results
            </button>
          </div>
        </>
      )}
    </section>
  );
}
