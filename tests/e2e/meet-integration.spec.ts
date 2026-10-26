import { expect, test, type Page } from '@playwright/test';
import { launchWithExtension, lumaDiff, openMeet, setSettings, type Ext } from './fixtures';

/**
 * Integration tests against a stand-in page served at https://meet.google.com/ with Meet's
 * real CSP + Trusted Types headers. They prove the extension's camera interception,
 * outbound WebRTC transport, lifecycle and CSP compatibility. They do NOT prove
 * compatibility with Meet's own application code — see docs/FEASIBILITY.md for the
 * manual two-participant test.
 */
type Sample = { meanSat: number; meanLuma: number; topBandLuma: number; lumas: number[]; width: number; height: number };
type Counters = { pipelines: number; liveSources: number; consumers: number; phase: string; effectPhase: string };

const h = <T>(page: Page, fn: string, arg?: unknown) =>
  page.evaluate(([f, a]) => (window as unknown as { __h: Record<string, (x?: unknown) => unknown> }).__h[f as string]!(a), [fn, arg] as const) as Promise<T>;

async function waitReceiving(page: Page): Promise<void> {
  await expect.poll(async () => (await h<{ framesDecoded?: number }>(page, 'receiverStats')).framesDecoded ?? 0, { timeout: 15_000 }).toBeGreaterThan(10);
}

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchWithExtension();
});
test.afterEach(async () => {
  await ext.close();
});

test('disabled: Meet gets the native camera untouched', async () => {
  await setSettings(ext, { enabled: false });
  const page = await openMeet(ext);
  const info = await h<{ label: string }>(page, 'call');
  expect(info.label).toBe('fake_device_0');
  await waitReceiving(page);
  const s = await h<Sample>(page, 'sample');
  expect(s.meanSat).toBeGreaterThan(40); // the fake camera is colorful
  expect(await h<Counters>(page, 'counters')).toMatchObject({ pipelines: 0 });
});

test('proof mode: the remote peer receives processed (grayscale, watermarked, live) video; audio preserved', async () => {
  await setSettings(ext, { enabled: true, proofMode: true });
  const page = await openMeet(ext);
  const info = await h<{ video: number; audio: string[]; label: string; settings: MediaTrackSettings }>(page, 'call');
  expect(info.video).toBe(1);
  expect(info.audio).toEqual(['Fake Default Audio Input']);
  // Adapter forwards real device metadata (no fabricated values).
  expect(info.label).toBe('fake_device_0');
  expect(info.settings.deviceId?.length).toBeGreaterThan(10);
  expect(info.settings.width).toBe(1280);
  expect(info.settings.height).toBe(720);

  await waitReceiving(page);
  const a = await h<Sample>(page, 'sample');
  await page.waitForTimeout(700);
  const b = await h<Sample>(page, 'sample');
  expect(a.meanSat).toBeLessThan(6); // grayscale after encode/decode
  expect(lumaDiff(a.lumas, b.lumas)).toBeGreaterThan(0.5); // live motion, not a frozen frame
  expect(a.width).toBeGreaterThan(0);
  const stats = await h<{ audioPackets?: number }>(page, 'receiverStats');
  expect(stats.audioPackets ?? 0).toBeGreaterThan(0); // original mic track still flows
  expect(await h<Counters>(page, 'counters')).toMatchObject({ pipelines: 1, liveSources: 1, consumers: 1, phase: 'LIVE' });
});

test('audio-only requests are passed through without a video pipeline', async () => {
  await setSettings(ext, { enabled: true });
  const page = await openMeet(ext);
  const info = await page.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { video: s.getVideoTracks().length, audio: s.getAudioTracks().length };
  });
  expect(info).toEqual({ video: 0, audio: 1 });
  expect(await h<Counters>(page, 'counters')).toMatchObject({ pipelines: 0 });
});

test('native getUserMedia errors propagate unchanged', async () => {
  await setSettings(ext, { enabled: true });
  const page = await openMeet(ext);
  const err = await page.evaluate(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: 'no-such-camera' } } });
      return null;
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(err).toBe('OverconstrainedError');
  expect(await h<Counters>(page, 'counters')).toMatchObject({ pipelines: 0 });
});

test('camera off: stopping the returned track (and clones) releases the physical camera', async () => {
  await setSettings(ext, { enabled: true });
  const page = await openMeet(ext);
  await h(page, 'call');
  await waitReceiving(page);
  const afterClone = await page.evaluate(() => {
    const s = (window as unknown as { __local: MediaStream }).__local;
    const clone = s.getVideoTracks()[0]!.clone();
    (window as unknown as { __clone: MediaStreamTrack }).__clone = clone;
    s.getVideoTracks()[0]!.stop();
    return clone.readyState;
  });
  expect(afterClone).toBe('live');
  expect(await h<Counters>(page, 'counters')).toMatchObject({ pipelines: 1, liveSources: 1, consumers: 1 });
  await page.evaluate(() => (window as unknown as { __clone: MediaStreamTrack }).__clone.stop());
  await expect.poll(() => h<Counters>(page, 'counters')).toMatchObject({ pipelines: 0, liveSources: 0, phase: 'CAMERA_OFF' });

  // Camera back on: a fresh pipeline starts cleanly.
  await h(page, 'call');
  await expect.poll(() => h<Counters>(page, 'counters')).toMatchObject({ pipelines: 1, liveSources: 1, phase: 'LIVE' });
});

test('track.enabled=false pauses processing and disables the source', async () => {
  await setSettings(ext, { enabled: true });
  const page = await openMeet(ext);
  await h(page, 'call');
  await waitReceiving(page);
  const r = await page.evaluate(async () => {
    const t = (window as unknown as { __local: MediaStream }).__local.getVideoTracks()[0]!;
    t.enabled = false;
    return t.enabled;
  });
  expect(r).toBe(false);
  await page.waitForTimeout(500);
  const s = await h<Sample>(page, 'sample');
  expect(s.meanLuma).toBeLessThan(10); // disabled tracks send black, like a native camera
});

test('applyConstraints is forwarded to the real camera and the output follows', async () => {
  await setSettings(ext, { enabled: true, quality: 'high', autoQuality: false });
  const page = await openMeet(ext);
  await h(page, 'call');
  await waitReceiving(page);
  const settings = await page.evaluate(async () => {
    const t = (window as unknown as { __local: MediaStream }).__local.getVideoTracks()[0]!;
    await t.applyConstraints({ width: 640, height: 360 });
    await new Promise((r) => setTimeout(r, 800));
    return t.getSettings();
  });
  expect(settings.width).toBe(640);
  expect(settings.height).toBe(360);
});

test('enabled after the camera started: honest reacquire guidance instead of silent replacement', async () => {
  await setSettings(ext, { enabled: false, showDock: true });
  const page = await openMeet(ext);
  await h(page, 'call');
  await setSettings(ext, { enabled: true });
  await expect(page.locator('snapmeet-dock').getByText('Turn your camera off and on in Meet')).toBeVisible({ timeout: 10_000 });
  expect(await h<Counters>(page, 'counters')).toMatchObject({ pipelines: 0 });
});

test('Absolute Cinema plays in the transmitted video (letterbox + monochrome) and ends cleanly', async () => {
  await setSettings(ext, { enabled: true, showDock: true, dockCollapsed: false, selectedEffectId: 'absolute-cinema' });
  const page = await openMeet(ext);
  await h(page, 'call');
  await waitReceiving(page);
  const before = await h<Sample>(page, 'sample');
  expect(before.meanSat).toBeGreaterThan(40);
  await page.locator('snapmeet-dock').getByRole('button', { name: 'Play Absolute Cinema' }).first().click();
  await page.waitForTimeout(1600);
  const during = await h<Sample>(page, 'sample');
  expect(during.meanSat).toBeLessThan(8);
  expect(during.topBandLuma).toBeLessThan(12); // black letterbox bar
  await expect.poll(async () => (await h<Sample>(page, 'sample')).meanSat, { timeout: 8000 }).toBeGreaterThan(40);
  expect(await h<Counters>(page, 'counters')).toMatchObject({ phase: 'LIVE', effectPhase: 'IDLE' });
});

test('vision runtime loads inside the Meet CSP + Trusted Types page without violations; Dust Away is gated honestly', async () => {
  await setSettings(ext, { enabled: true, showDock: true, dockCollapsed: false, selectedEffectId: 'dust-away', backgroundMode: 'virtual' });
  const page = await openMeet(ext);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await h(page, 'call');
  await waitReceiving(page);
  const dock = page.locator('snapmeet-dock');
  await dock.getByRole('tab', { name: 'Diagnostics' }).click();
  await expect(dock.getByText(/^ready \((GPU|CPU), (worker|main-thread)\)$/)).toBeVisible({ timeout: 30_000 });
  await expect(dock.getByText(/person mask:/)).toBeVisible();
  await expect(dock.locator('dl.sm-kv')).toContainText(/Person in frame\s*\d+% of mask/, { timeout: 10_000 });
  const coverageText = /Person in frame\s*(\d+% of mask)/.exec(await dock.locator('dl.sm-kv').innerText())?.[1] ?? null;
  test.info().annotations.push({ type: 'segmentation', description: `fake camera person coverage: ${coverageText}` });
  // The fake camera shows no person. A few false-positive pixels are possible, but the
  // chosen mask must not be the inverted (background) mask, which would cover most of the frame.
  expect(Number(coverageText?.replace(/%.*/, ''))).toBeLessThan(30);
  // Inference runs in a worker, off Meet's main thread.
  await expect(dock.getByText(/^ready \((GPU|CPU), worker\)$/)).toBeVisible();

  const violations = await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
