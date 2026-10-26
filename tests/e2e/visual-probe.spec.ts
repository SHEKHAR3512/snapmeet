import { chromium, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Visual probe (@probe): renders each effect on a synthetic scene and writes PNG contact
// sheets for human review. Output dir: $SNAPMEET_SHOTS (default test-results/shots).
const HERE = dirname(fileURLToPath(import.meta.url));

test('effect contact sheet @probe', async () => {
  const out = process.env.SNAPMEET_SHOTS ?? join(HERE, '..', '..', 'test-results', 'shots');
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage();
  const js = readFileSync(join(HERE, '.harness', 'harness.js'), 'utf8');
  await page.route('https://harness.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><script>${js}</script>` }));
  await page.goto('https://harness.test/');
  const sheets: Record<string, string> = await page.evaluate(async () => {
    const H = (window as unknown as { SnapMeetHarness: { FrameRenderer: new (w: number, h: number) => { canvas: OffscreenCanvas; render(f: TexImageSource, s: unknown): void }; BUILTIN_EFFECTS: Array<{ id: string; template: string; durationMs: number }> } }).SnapMeetHarness;
    const W = 640, HH = 360;
    // Synthetic scene: a room and a simple figure (no real person).
    const scene = (t: number) => {
      const c = new OffscreenCanvas(W, HH); const x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, 0, HH); g.addColorStop(0, '#9fb3c8'); g.addColorStop(1, '#6b7c8f');
      x.fillStyle = g; x.fillRect(0, 0, W, HH);
      x.fillStyle = '#c7a27a'; x.fillRect(40, 60, 120, 90); // picture frame on the wall
      x.fillStyle = '#5a4636'; x.fillRect(0, 300, W, 60); // desk
      x.fillStyle = '#2f5d8a'; x.beginPath(); x.ellipse(320 + Math.sin(t) * 4, 330, 120, 140, 0, Math.PI, 0); x.fill(); // body
      x.fillStyle = '#e0b48f'; x.beginPath(); x.arc(320 + Math.sin(t) * 4, 150, 58, 0, Math.PI * 2); x.fill(); // head
      x.fillStyle = '#3a2a20'; x.beginPath(); x.arc(320 + Math.sin(t) * 4, 128, 60, Math.PI, 0); x.fill(); // hair
      return c;
    };
    const MW = 128, MH = 72; const md = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const px = (x + 0.5) / MW * W, py = (y + 0.5) / MH * HH;
      const head = Math.hypot(px - 320, py - 150) < 60;
      const body = py > 190 && ((px - 320) / 120) ** 2 + ((py - 330) / 140) ** 2 < 1;
      if (head || body) md[y * MW + x] = 255;
    }
    const mask = { data: md, width: MW, height: MH, version: 1, at: 0, info: { coverage: 0.2, bbox: [0.31, 0.24, 0.69, 1], centroid: [0.5, 0.6], head: [0.5, 0.38] } };
    const bgC = new OffscreenCanvas(W, HH); const bx = bgC.getContext('2d')!;
    const gg = bx.createLinearGradient(0, 0, 0, HH); gg.addColorStop(0, '#9fb3c8'); gg.addColorStop(1, '#6b7c8f'); bx.fillStyle = gg; bx.fillRect(0, 0, W, HH);
    bx.fillStyle = '#c7a27a'; bx.fillRect(40, 60, 120, 90); bx.fillStyle = '#5a4636'; bx.fillRect(0, 300, W, 60);
    const r = new H.FrameRenderer(W, HH);
    let run = 1;
    const shot = (now: number, s: unknown) => { r.render(scene(now / 300), { now, session: s, mask, background: { key: 'room', source: bgC }, reducedMotion: false, quality: 'high', proof: false }); const c = new OffscreenCanvas(W, HH); c.getContext('2d')!.drawImage(r.canvas, 0, 0); return c; };
    const ses = (d: { id: string; template: string; durationMs: number } | null, phase: string, startedAt = 0, phaseStartedAt = 0, dur: number | null = null, id = run) => ({ phase: 'LIVE', effectPhase: phase, effect: d ? { runId: id, effectId: d.id, template: d.template, definition: d, startedAt, seed: 77 } : null, effectPhaseStartedAt: phaseStartedAt, effectPhaseDurationMs: dur, recoveryReason: null });
    const sheet = async (frames: OffscreenCanvas[]) => {
      const cols = frames.length; const s = new OffscreenCanvas(W * cols / 2, HH / 2); const x = s.getContext('2d')!;
      frames.forEach((f, i) => x.drawImage(f, i * W / 2, 0, W / 2, HH / 2));
      const blob = await s.convertToBlob({ type: 'image/png' }); const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (const b of buf) bin += String.fromCharCode(b); return btoa(bin);
    };
    const out: Record<string, string> = {};
    for (const d of H.BUILTIN_EFFECTS) {
      run++;
      const frames: OffscreenCanvas[] = [];
      if (d.template === 'dust-away') {
        for (const t of [0, 500, 1000, 1500, 2200]) frames.push(shot(t, ses(d, 'DISINTEGRATING', 0, 0, 3000)));
        frames.push(shot(4000, ses(d, 'VANISHED', 0, 3000)));
        frames.push(shot(9500, ses(d, 'REAPPEARING', 0, 9000, 1300)));
      } else {
        for (const f of [0.15, 0.35, 0.55, 0.8]) frames.push(shot(d.durationMs * f, ses(d, 'PLAYING', 0, 0, d.durationMs)));
      }
      out[d.id] = await sheet(frames);
    }
    return out;
  });
  for (const [id, b64] of Object.entries(sheets)) writeFileSync(join(out, `${id}.png`), Buffer.from(b64, 'base64'));
  await browser.close();
});
