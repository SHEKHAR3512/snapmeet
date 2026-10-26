import { useEffect, useRef, useState } from 'react';
import { Dock } from '../src/ui/dock/Dock';
import { api, engine, initEngineHost } from './engine-host';
import { GestureLab } from './GestureLab';
import { startLoopback, type Loopback, type LoopbackStats } from './loopback';

export function Playground() {
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [processed, setProcessed] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirror, setMirror] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  const [loopStats, setLoopStats] = useState<LoopbackStats | null>(null);
  const [counters, setCounters] = useState(engine.debugCounters());
  const outRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<Loopback | null>(null);

  useEffect(() => {
    void initEngineHost().then(() => setReady(true));
    const t = setInterval(() => setCounters(engine.debugCounters()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (outRef.current) outRef.current.srcObject = processed;
  }, [processed]);

  const start = async () => {
    setError(null);
    void engine.audio.unlock().catch(() => {});
    try {
      const raw = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
        audio: false,
      });
      setProcessed(engine.attachStream(raw));
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
    } catch (e) {
      setError(`${(e as Error).name}: ${(e as Error).message}`);
    }
  };

  const stop = () => {
    stopLoop();
    processed?.getTracks().forEach((t) => t.stop());
    setProcessed(null);
  };

  const stopLoop = () => {
    loopRef.current?.close();
    loopRef.current = null;
    setLoopOn(false);
    setLoopStats(null);
    if (remoteRef.current) remoteRef.current.srcObject = null;
  };

  const toggleLoop = async () => {
    if (loopOn) return stopLoop();
    const track = processed?.getVideoTracks()[0];
    if (!track) return;
    loopRef.current = await startLoopback(track, (remote) => {
      if (remoteRef.current) remoteRef.current.srcObject = remote;
    }, setLoopStats);
    setLoopOn(true);
  };

  return (
    <div className="pg">
      <header className="pg-head">
        <div>
          <h1>SnapMeet playground</h1>
          <p className="muted small">Try effects on your own camera. Everything runs locally; nothing is recorded or uploaded.</p>
        </div>
      </header>

      <div className="pg-main">
        <section className="pg-stage">
          <div className="card stack">
            <div className="btns">
              {!processed ? (
                <button type="button" className="btn primary" onClick={() => void start()} disabled={!ready}>
                  Start camera
                </button>
              ) : (
                <button type="button" className="btn" onClick={stop}>
                  Stop camera
                </button>
              )}
              {devices.length > 1 && (
                <select aria-label="Camera" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                  <option value="">Default camera</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Camera'}
                    </option>
                  ))}
                </select>
              )}
              <label className="row" style={{ minHeight: 0 }}>
                <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror my preview
              </label>
              <button type="button" className="btn" onClick={() => void toggleLoop()} disabled={!processed}>
                {loopOn ? 'Stop WebRTC loopback' : 'Send through WebRTC loopback'}
              </button>
            </div>
            {error && <div className="notice error small">{error}</div>}
            <p className="muted small">
              Pipelines {counters.pipelines} · live camera tracks {counters.liveSources} · consumers {counters.consumers} ·{' '}
              {counters.phase}/{counters.effectPhase}
            </p>
          </div>

          <div className="pg-videos">
            <figure>
              <video ref={outRef} autoPlay playsInline muted style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
              <figcaption className="muted small">
                Processed output {mirror ? '(mirrored like Meet’s self-view; captions read correctly for others)' : ''}
              </figcaption>
            </figure>
            {loopOn && (
              <figure>
                <video ref={remoteRef} autoPlay playsInline muted />
                <figcaption className="muted small">
                  Received over a local peer connection
                  {loopStats ? ` · ${loopStats.width}×${loopStats.height} · ${loopStats.fps} fps · ${loopStats.framesDecoded} frames` : ''}
                </figcaption>
              </figure>
            )}
          </div>
          <GestureLab />
        </section>

        <aside className="pg-side">{ready && <Dock api={api} inline />}</aside>
      </div>
    </div>
  );
}
