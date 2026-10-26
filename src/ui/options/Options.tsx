import { useCallback, useEffect, useState } from 'react';
import { REMOTE_KEY, refreshRemote, validateRemoteUrl, type RemoteConfig } from '../../catalog/remote';
import { CatalogStore, type InstalledPack } from '../../catalog/store';
import { createKV, SettingsStore } from '../../shared/storage';
import type { Quality, Settings } from '../../shared/settings';

const kv = createKV();
const settingsStore = new SettingsStore(kv);
const version = chrome.runtime.getManifest().version;
const catalog = new CatalogStore(kv, version);

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);

  const reloadPacks = useCallback(() => void catalog.list().then(setPacks), []);
  useEffect(() => {
    void settingsStore.load().then(setSettings);
    reloadPacks();
    void chrome.commands.getAll().then(setCommands);
    return settingsStore.subscribe(setSettings);
  }, [reloadPacks]);

  if (!settings) return null;
  const update = async (patch: Partial<Settings>) => setSettings(await settingsStore.update(patch));

  const onImport = async (file: File) => {
    if (file.size > 256 * 1024) {
      setImportMsg({ ok: false, lines: ['File is larger than 256 KB.'] });
      return;
    }
    const r = await catalog.importText(await file.text());
    setImportMsg(r.ok ? { ok: true, lines: [`Installed “${r.pack.title}” ${r.pack.packVersion}.`, ...r.warnings] } : { ok: false, lines: r.errors });
    reloadPacks();
  };

  return (
    <main className="stack" style={{ maxWidth: 760, margin: '0 auto', padding: '28px 16px 48px' }}>
      <div className="row">
        <h1>SnapMeet settings</h1>
        <span className="muted">v{version}</span>
      </div>

      <section className="card stack" aria-labelledby="general-h">
        <h2 id="general-h">General</h2>
        <Check id="enabled" label="Use SnapMeet in Google Meet" checked={settings.enabled} onChange={(v) => update({ enabled: v })} />
        <Check id="dock" label="Show the in-call controls" checked={settings.showDock} onChange={(v) => update({ showDock: v })} />
        <div className="row">
          <label htmlFor="quality">Output quality</label>
          <select id="quality" value={settings.quality} onChange={(e) => void update({ quality: e.target.value as Quality })}>
            <option value="low">Low (480p)</option>
            <option value="medium">Medium (720p)</option>
            <option value="high">High (source resolution)</option>
          </select>
        </div>
        <Check id="auto" label="Lower quality automatically when the computer is busy" checked={settings.autoQuality} onChange={(v) => update({ autoQuality: v })} />
        <Check id="rm" label="Reduced motion (replaces shakes and flashes with gentle transitions)" checked={settings.reducedMotion} onChange={(v) => update({ reducedMotion: v })} />
        <div className="row">
          <label htmlFor="reappear">After Dust Away</label>
          <select id="reappear" value={settings.reappearAfterMs} onChange={(e) => void update({ reappearAfterMs: Number(e.target.value) })}>
            <option value={3000}>Reappear after 3 seconds</option>
            <option value={5000}>Reappear after 5 seconds</option>
            <option value={10000}>Reappear after 10 seconds</option>
            <option value={0}>Stay vanished until I reappear</option>
          </select>
        </div>
        <Check id="proof" label="Proof mode: grayscale + live watermark (to verify what others receive)" checked={settings.proofMode} onChange={(v) => update({ proofMode: v })} />
      </section>

      <section className="card stack" aria-labelledby="packs-h">
        <h2 id="packs-h">Effect collections</h2>
        <p className="muted small">
          Collections are data-only JSON packs that reuse SnapMeet's built-in effect templates. They cannot run code or load
          remote media. If an import fails, your installed effects are unchanged.
        </p>
        <div>
          <label className="btn" htmlFor="pack-file">
            Import collection (.json)
          </label>
          <input
            id="pack-file"
            type="file"
            accept="application/json,.json"
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {importMsg && (
          <div className={`notice small${importMsg.ok ? '' : ' error'}`} role="status">
            {importMsg.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
        {packs.length === 0 ? (
          <p className="muted small">No imported collections. The built-in effects are always available.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Collection</th>
                <th>Version</th>
                <th>Effects</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.pack.packId}>
                  <td>{p.pack.title}</td>
                  <td>{p.pack.packVersion}</td>
                  <td>{p.pack.effects.length}</td>
                  <td>
                    <div className="btns">
                      <button type="button" className="btn" onClick={() => void catalog.setEnabled(p.pack.packId, !p.enabled).then(reloadPacks)}>
                        {p.enabled ? 'Disable' : 'Enable'}
                      </button>
                      {p.previous && (
                        <button type="button" className="btn" onClick={() => void catalog.rollback(p.pack.packId).then(reloadPacks)}>
                          Roll back to {p.previous.packVersion}
                        </button>
                      )}
                      <button type="button" className="btn danger" onClick={() => void catalog.remove(p.pack.packId).then(reloadPacks)}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RemoteCollection onChanged={reloadPacks} />

      <section className="card stack" aria-labelledby="keys-h">
        <h2 id="keys-h">Keyboard shortcuts</h2>
        <table>
          <tbody>
            {commands
              .filter((c) => c.name && !c.name.startsWith('_'))
              .map((c) => (
                <tr key={c.name}>
                  <td>{c.description}</td>
                  <td>{c.shortcut || <span className="muted">Not set</span>}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div>
          <button type="button" className="btn" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
            Change shortcuts
          </button>
        </div>
      </section>

      <section className="card stack" aria-labelledby="privacy-h">
        <h2 id="privacy-h">Privacy</h2>
        <p className="small">
          Camera frames are processed locally in your browser and are never recorded, uploaded or stored. An empty-room
          capture or custom image lives in memory for the current Meet tab only. SnapMeet has no analytics and no account.
        </p>
      </section>
    </main>
  );
}

function Check(props: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </div>
  );
}

function RemoteCollection({ onChanged }: { onChanged: () => void }) {
  const [cfg, setCfg] = useState<RemoteConfig>({ url: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void kv.get<RemoteConfig>(REMOTE_KEY).then((c) => c && setCfg(c));
  }, []);

  const save = async (refresh: boolean) => {
    if (!cfg.url) {
      await kv.set(REMOTE_KEY, { url: '' });
      setMsg('Remote collection turned off.');
      return;
    }
    const bad = validateRemoteUrl(cfg.url);
    if (bad) return setMsg(bad);
    if (cfg.sha256 && !/^[0-9a-f]{64}$/i.test(cfg.sha256)) return setMsg('SHA-256 must be 64 hex characters.');
    // Ask for access to this one origin only, at the moment the user opts in.
    const origin = `${new URL(cfg.url).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return setMsg('Permission to read that site was not granted.');
    await kv.set(REMOTE_KEY, { url: cfg.url, ...(cfg.sha256 ? { sha256: cfg.sha256.toLowerCase() } : {}) });
    if (refresh) {
      const r = await refreshRemote(kv, catalog, { force: true });
      setMsg(r ?? 'Saved.');
      onChanged();
      const c = await kv.get<RemoteConfig>(REMOTE_KEY);
      if (c) setCfg(c);
    } else setMsg('Saved. SnapMeet checks at most once a day.');
  };

  return (
    <section className="card stack" aria-labelledby="remote-h">
      <h2 id="remote-h">Remote collection (optional)</h2>
      <p className="muted small">
        Point SnapMeet at a static HTTPS JSON collection to receive new effects. It is checked at most once a day, must
        pass the same validation as imports, and a failed update keeps your current effects. No camera data is ever sent.
      </p>
      <div className="row">
        <label htmlFor="remote-url">Collection URL</label>
        <input id="remote-url" type="url" placeholder="https://example.com/snapmeet-pack.json" style={{ flex: 1 }} value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
      </div>
      <div className="row">
        <label htmlFor="remote-sha">Pinned SHA-256 (optional)</label>
        <input id="remote-sha" type="text" style={{ flex: 1 }} value={cfg.sha256 ?? ''} onChange={(e) => setCfg({ ...cfg, sha256: e.target.value.trim() || undefined })} />
      </div>
      <div className="btns">
        <button type="button" className="btn" onClick={() => void save(false)}>
          Save
        </button>
        <button type="button" className="btn primary" disabled={!cfg.url} onClick={() => void save(true)}>
          Save and refresh now
        </button>
      </div>
      {(msg || cfg.lastResult) && (
        <p className="small muted" role="status">
          {msg ?? `${cfg.lastResult} (${cfg.lastCheckedAt ? new Date(cfg.lastCheckedAt).toLocaleString() : ''})`}
        </p>
      )}
    </section>
  );
}
