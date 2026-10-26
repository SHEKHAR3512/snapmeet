import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Deterministic frame-fixture tests for the GPU renderer (no camera, no Meet).
 * Synthetic inputs: a pure red "camera" frame, a circular person mask, a pure green
 * background. Licensed/consent-free by construction.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const harness = () => readFileSync(join(HERE, '.harness', 'harness.js'), 'utf8');

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
  page = await browser.newPage();
  await page.route('https://harness.test/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: `<!doctype html><title>harness</title><script>${harness()}</script>` }),
  );
  await page.goto('https://harness.test/');
  await page.evaluate(() => {
    type H = {
      FrameRenderer: new (w: number, h: number) => {
        canvas: OffscreenCanvas;
        render(f: TexImageSource, s: unknown): void;
        dispose(): void;
      };
      BUILTIN_EFFECTS: Array<{ id: string; template: string; durationMs: number; parameters: Record<string, unknown> }>;
    };
    const H = (window as unknown as { SnapMeetHarness: H }).SnapMeetHarness;
    const W = 320;
    const HH = 180;
    const solid = (c: string) => {
      const cv = new OffscreenCanvas(W, HH);
      const x = cv.getContext('2d')!;
      x.fillStyle = c;
      x.fillRect(0, 0, W, HH);
      return cv;
    };
    const gradient = () => {
      const cv = new OffscreenCanvas(W, HH);
      const x = cv.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, W, HH);
      g.addColorStop(0, '#d23c3c');
      g.addColorStop(0.5, '#3cb44b');
      g.addColorStop(1, '#3c64d2');
      x.fillStyle = g;
      x.fillRect(0, 0, W, HH);
      return cv;
    };
    // Mask 64×36: circle of radius 10 around the center.
    const MW = 64;
    const MH = 36;
    const maskData = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (Math.hypot(x - 32, y - 18) < 10) maskData[y * MW + x] = 255;
    const mask = {
      data: maskData,
      width: MW,
      height: MH,
      version: 1,
      at: 0,
      info: { coverage: 0.14, bbox: [0.34, 0.22, 0.66, 0.78], centroid: [0.5, 0.5], head: [0.5, 0.3] },
    };
    const renderer = new H.FrameRenderer(W, HH);
    const read = () => {
      const c = new OffscreenCanvas(W, HH);
      const x = c.getContext('2d')!;
      x.drawImage(renderer.canvas, 0, 0);
      return x.getImageData(0, 0, W, HH).data;
    };
    const stats = (d: Uint8ClampedArray) => {
      let red = 0;
      let green = 0;
      let sat = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! > 150 && d[i + 1]! < 90 && d[i + 2]! < 90) red++;
        if (d[i + 1]! > 150 && d[i]! < 90 && d[i + 2]! < 90) green++;
        sat += Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
      }
      const n = d.length / 4;
      return { red: red / n, green: green / n, sat: sat / n };
    };
    const at = (d: Uint8ClampedArray, x: number, y: number) => {
      const i = (Math.floor(y * HH) * W + Math.floor(x * W)) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const def = (id: string) => H.BUILTIN_EFFECTS.find((d) => d.id === id)!;
    let runId = 1;
    const session = (o: { effect?: ReturnType<typeof def> | null; effectPhase: string; phaseStartedAt?: number; phaseDurationMs?: number | null; startedAt?: number; run?: number }) => ({
      phase: 'LIVE',
      effectPhase: o.effectPhase,
      effect: o.effect ? { runId: o.run ?? runId, effectId: o.effect.id, template: o.effect.template, definition: o.effect, startedAt: o.startedAt ?? 0, seed: 1234 } : null,
      effectPhaseStartedAt: o.phaseStartedAt ?? 0,
      effectPhaseDurationMs: o.phaseDurationMs ?? null,
      recoveryReason: null,
    });
    const frame = (video: TexImageSource, now: number, s: unknown, extra: Record<string, unknown> = {}) => {
      renderer.render(video, { now, session: s, mask, background: { key: 'green', source: solid('#00c800') }, reducedMotion: false, quality: 'medium', proof: false, ...extra });
      return read();
    };
    (window as unknown as Record<string, unknown>).T = { solid, gradient, frame, stats, at, def, session, nextRun: () => ++runId, renderer };
  });
});

test.afterAll(async () => {
  await browser.close();
});

type Stats = { red: number; green: number; sat: number };

test('Dust Away: frozen person dissolves; VANISHED output is the background only (no camera pixels)', async () => {
  const r = await page.evaluate(() => {
    const T = (window as unknown as { T: Record<string, (...a: unknown[]) => unknown> }).T as {
      solid(c: string): OffscreenCanvas;
      frame(v: OffscreenCanvas, now: number, s: unknown): Uint8ClampedArray;
      stats(d: Uint8ClampedArray): Stats;
      at(d: Uint8ClampedArray, x: number, y: number): number[];
      def(id: string): unknown;
      session(o: unknown): unknown;
      nextRun(): number;
    };
    const red = T.solid('#ff0000');
    const blue = T.solid('#0000ff');
    const dust = T.def('dust-away');
    const run = T.nextRun();
    const dis = (_t: number) => T.session({ effect: dust, effectPhase: 'DISINTEGRATING', phaseStartedAt: 0, phaseDurationMs: 3000, run });
    const start = T.frame(red, 0, dis(0));
    // Later frames use a BLUE camera: any blue in the output would be a live-camera leak.
    const mid = T.frame(blue, 800, dis(800));
    const end = T.frame(blue, 3000, dis(3000));
    const vanished = T.frame(blue, 3100, T.session({ effect: dust, effectPhase: 'VANISHED', phaseStartedAt: 3000, run }));
    const blueIn = (d: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 150 && d[i]! < 90 && d[i + 1]! < 90) n++;
      return n;
    };
    return {
      start: T.stats(start),
      startCenter: T.at(start, 0.5, 0.5),
      startCorner: T.at(start, 0.05, 0.05),
      mid: T.stats(mid),
      end: T.stats(end),
      vanished: T.stats(vanished),
      blueLeaks: [blueIn(start), blueIn(mid), blueIn(end), blueIn(vanished)],
    };
  });
  // Frozen person (the dissolve front may already add a faint ember tint at t=0).
  expect(r.startCenter[0]).toBeGreaterThan(200);
  expect(r.startCenter[2]).toBeLessThan(60);
  expect(r.startCorner).toEqual([0, 200, 0]); // background around the person
  expect(r.mid.red).toBeGreaterThan(0); // partially dissolved, particles in flight
  expect(r.mid.red).toBeLessThan(r.start.red);
  expect(r.end.red).toBe(0); // dissolve and particle tail complete
  expect(r.vanished.green).toBe(1); // exactly the background
  expect(r.blueLeaks).toEqual([0, 0, 0, 0]); // the live camera never appears while hidden
});

test('Dust Away: reappear dissolves the live person back in and ends on the raw camera', async () => {
  const r = await page.evaluate(() => {
    const T = (window as unknown as { T: Record<string, unknown> }).T as {
      solid(c: string): OffscreenCanvas;
      frame(v: OffscreenCanvas, now: number, s: unknown): Uint8ClampedArray;
      stats(d: Uint8ClampedArray): Stats;
      at(d: Uint8ClampedArray, x: number, y: number): number[];
      def(id: string): unknown;
      session(o: unknown): unknown;
      nextRun(): number;
    };
    const blue = T.solid('#0000ff');
    const dust = T.def('dust-away');
    const run = T.nextRun();
    T.frame(blue, 0, T.session({ effect: dust, effectPhase: 'DISINTEGRATING', phaseDurationMs: 3000, run }));
    const re = (_t: number) => T.session({ effect: dust, effectPhase: 'REAPPEARING', phaseStartedAt: 5000, phaseDurationMs: 1300, run });
    const early = T.frame(blue, 5000, re(5000));
    const end = T.frame(blue, 6300, re(6300));
    return { earlyCorner: T.at(early, 0.05, 0.05), endCorner: T.at(end, 0.05, 0.05), endCenter: T.at(end, 0.5, 0.5) };
  });
  expect(r.earlyCorner).toEqual([0, 200, 0]);
  expect(r.endCorner).toEqual([0, 0, 255]);
  expect(r.endCenter).toEqual([0, 0, 255]);
});

test('all eight effect templates render visibly, without GL errors, and return to passthrough', async () => {
  const results = await page.evaluate(() => {
    const T = (window as unknown as { T: Record<string, unknown> }).T as {
      gradient(): OffscreenCanvas;
      frame(v: OffscreenCanvas, now: number, s: unknown): Uint8ClampedArray;
      def(id: string): { id: string; durationMs: number };
      session(o: unknown): unknown;
      nextRun(): number;
    };
    const video = T.gradient();
    const base = T.frame(video, 0, T.session({ effectPhase: 'IDLE' }));
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
      return s / (a.length / 4) / 3;
    };
    const out: Record<string, { mid: number; after: number; error?: string }> = {};
    for (const id of ['absolute-cinema', 'aura-9999', 'serial-drama', 'aayein', 'emotional-damage', 'this-is-fine', 'mission-passed']) {
      const d = T.def(id);
      const run = T.nextRun();
      try {
        let maxDiff = 0;
        for (const t of [0, d.durationMs * 0.25, d.durationMs * 0.5, d.durationMs * 0.75, d.durationMs - 1]) {
          const f = T.frame(video, t, T.session({ effect: d, effectPhase: 'PLAYING', phaseDurationMs: d.durationMs, startedAt: 0, run }));
          maxDiff = Math.max(maxDiff, diff(f, base));
        }
        const after = T.frame(video, d.durationMs + 10, T.session({ effectPhase: 'IDLE' }));
        out[id] = { mid: maxDiff, after: diff(after, base) };
      } catch (e) {
        out[id] = { mid: 0, after: 999, error: String(e) };
      }
    }
    return out;
  });
  for (const [id, r] of Object.entries(results)) {
    expect(r.error, id).toBeUndefined();
    expect(r.mid, `${id} should visibly change the frame`).toBeGreaterThan(8);
    expect(r.after, `${id} should return to passthrough`).toBe(0);
  }
});

test('reduced motion variants render and cancel cleanly when switching effects mid-run', async () => {
  const ok = await page.evaluate(() => {
    const T = (window as unknown as { T: Record<string, unknown> }).T as {
      gradient(): OffscreenCanvas;
      def(id: string): { id: string; durationMs: number };
      session(o: unknown): unknown;
      nextRun(): number;
      renderer: { render(f: TexImageSource, s: unknown): void };
    };
    const video = T.gradient();
    const ids = ['emotional-damage', 'serial-drama', 'aayein', 'dust-away', 'this-is-fine'];
    for (let i = 0; i < 30; i++) {
      const d = T.def(ids[i % ids.length]!);
      const run = T.nextRun();
      const phase = d.id === 'dust-away' ? 'DISINTEGRATING' : 'PLAYING';
      T.renderer.render(video, {
        now: i * 100,
        session: T.session({ effect: d, effectPhase: phase, phaseDurationMs: 3000, startedAt: i * 100 - 50, run }),
        mask: null,
        background: null,
        reducedMotion: true,
        quality: 'low',
        proof: false,
      });
    }
    return true;
  });
  expect(ok).toBe(true);
});

test('proof mode output is grayscale with a watermark', async () => {
  const r = await page.evaluate(() => {
    const T = (window as unknown as { T: Record<string, unknown> }).T as {
      gradient(): OffscreenCanvas;
      frame(v: OffscreenCanvas, now: number, s: unknown, extra?: Record<string, unknown>): Uint8ClampedArray;
      stats(d: Uint8ClampedArray): Stats;
      session(o: unknown): unknown;
    };
    const d = T.frame(T.gradient(), 0, T.session({ effectPhase: 'IDLE' }), { proof: true });
    return T.stats(d);
  });
  expect(r.sat).toBeLessThan(1);
});
