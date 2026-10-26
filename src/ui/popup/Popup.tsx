import { useEffect, useState } from 'react';
import type { Diagnostics, EngineStatus } from '../../bridge/protocol';
import { SettingsStore } from '../../shared/storage';
import type { Settings } from '../../shared/settings';
import { phaseLabel } from '../dock/labels';

const settingsStore = new SettingsStore();

interface TabInfo {
  meet: boolean;
  id?: number;
  connected?: boolean;
  status?: EngineStatus | null;
  diagnostics?: Diagnostics | null;
}

async function queryTab(): Promise<TabInfo> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://meet.google.com/')) return { meet: false };
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'get-tab-status' });
    return { meet: true, id: tab.id, ...r };
  } catch {
    return { meet: true, id: tab.id, connected: false };
  }
}

/** Popup: never touches the camera. It only edits preferences and talks to the Meet tab. */
export function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabInfo | null>(null);

  useEffect(() => {
    void settingsStore.load().then(setSettings);
    const off = settingsStore.subscribe(setSettings);
    const poll = () => void queryTab().then(setTab);
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  if (!settings) return null;
  const update = async (patch: Partial<Settings>) => setSettings(await settingsStore.update(patch));
  const sendTab = (msg: object) => tab?.id && chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  const label = phaseLabel(tab?.status ?? null, !!tab?.connected);
  const s = tab?.status;
  const d = tab?.diagnostics;
  const version = chrome.runtime.getManifest().version;

  return (
    <div className="stack" style={{ width: 340, padding: 16 }}>
      <div className="row">
        <h1>SnapMeet</h1>
        <span className="muted small">v{version}</span>
      </div>

      <div className="card stack">
        <div className="row">
          <label htmlFor="enabled">
            <strong>Use SnapMeet in Google Meet</strong>
          </label>
          <input id="enabled" type="checkbox" role="switch" checked={settings.enabled} onChange={(e) => void update({ enabled: e.target.checked })} />
        </div>
        <p className="muted small">
          Routes your outgoing Meet camera through local effects. Turn it on before joining, or turn your camera off and on
          afterwards. Nothing is uploaded.
        </p>
      </div>

      <div className="card stack">
        <h2>This tab</h2>
        {!tab?.meet ? (
          <p className="muted">Open a Google Meet tab to control effects.</p>
        ) : !tab.connected ? (
          <p className="muted">SnapMeet isn't connected to this Meet tab yet. Reload the tab after installing or updating.</p>
        ) : (
          <>
            <div className="row">
              <span>
                <span className={`status-dot ${label.tone}`} />
                {label.text}
              </span>
              <span className="muted small">{s?.pipelines ?? 0} camera stream(s)</span>
            </div>
            {s?.needsReacquire && (
              <div className="notice small">Turn your camera off and on in Meet (Ctrl+E twice) to start SnapMeet.</div>
            )}
            {s?.phase === 'RECOVERY_REQUIRED' && (
              <div className="notice error small">Video paused for privacy. Use “Return to camera”.</div>
            )}
            {d && (
              <p className="muted small">
                {d.outputWidth}×{d.outputHeight} · {d.renderFps} fps · vision {s?.vision}
              </p>
            )}
            <div className="btns">
              <button type="button" className="btn primary" onClick={() => void sendTab({ type: 'open-dock' })}>
                Open controls
              </button>
              {(s?.effectPhase === 'VANISHED' || s?.phase === 'RECOVERY_REQUIRED') && (
                <button type="button" className="btn" onClick={() => void sendTab({ type: 'command', command: 'reappear' })}>
                  {s?.phase === 'RECOVERY_REQUIRED' ? 'Return to camera' : 'Reappear'}
                </button>
              )}
              <button type="button" className="btn" onClick={() => void sendTab({ type: 'command', command: 'reset-effects' })}>
                Reset effects
              </button>
            </div>
          </>
        )}
      </div>

      <div className="btns">
        <button type="button" className="btn" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('playground.html') })}>
          Open playground
        </button>
        <button type="button" className="btn" onClick={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </button>
        <button type="button" className="btn" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
          Shortcuts
        </button>
      </div>
    </div>
  );
}
