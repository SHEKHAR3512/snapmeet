import { expect, test, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openMeet, setSettings, type Ext } from './fixtures';

/**
 * Dust Away end-to-end over WebRTC, using a synthetic drawn figure as the fake camera
 * (tests/fixtures/synthetic-figure.y4m — no real person). Background: the chroma-green
 * virtual background, so "vanished" is measurable at the receiver.
 */
const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'synthetic-figure.y4m');
type Sample = { green: number; meanSat: number };
const h = <T>(page: Page, fn: string) =>
  page.evaluate((f) => (window as unknown as { __h: Record<string, () => unknown> }).__h[f]!(), fn) as Promise<T>;

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchWithExtension({ videoFile: VIDEO });
});
test.afterEach(async () => {
  await ext.close();
});

test('snap-free Dust Away: receiver sees the person vanish into the background, audio keeps flowing, reappear restores', async () => {
  await setSettings(ext, {
    enabled: true,
    showDock: true,
    dockCollapsed: false,
    selectedEffectId: 'dust-away',
    backgroundMode: 'virtual',
    virtualBackgroundId: 'chroma-green',
    reappearAfterMs: 0,
  });
  const page = await openMeet(ext);
  await h(page, 'call');
  await expect.poll(async () => ((await h<{ framesDecoded?: number }>(page, 'receiverStats')).framesDecoded ?? 0), { timeout: 15_000 }).toBeGreaterThan(10);
  const dock = page.locator('snapmeet-dock');
  await dock.getByRole('tab', { name: 'Diagnostics' }).click();
  await expect(dock.getByText(/^ready \((GPU|CPU), worker\)$/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const coverage = Number(/Person in frame\s*(\d+)%/.exec(await dock.locator('dl.sm-kv').innerText())?.[1] ?? 0);
  test.info().annotations.push({ type: 'segmentation', description: `synthetic figure coverage ${coverage}%` });
  expect(coverage, 'the segmenter should find the synthetic figure').toBeGreaterThan(3);

  const before = await h<Sample>(page, 'sample');
  expect(before.green).toBeLessThan(0.05);
  await dock.getByRole('tab', { name: 'Effects' }).click();
  await dock.getByRole('button', { name: 'Play Dust Away' }).first().click();
  await expect(dock.getByText("You're vanished.", { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await h<{ effectPhase: string }>(page, 'counters')).effectPhase, { timeout: 10_000 }).toBe('VANISHED');
  await page.waitForTimeout(500); // let the last pre-vanish frames drain through the receiver
  const audioBefore = (await h<{ audioPackets?: number }>(page, 'receiverStats')).audioPackets ?? 0;
  const vanished = await h<Sample>(page, 'sample');
  expect(vanished.green).toBeGreaterThan(0.97); // only the background is transmitted
  await page.waitForTimeout(1000);
  expect((await h<{ audioPackets?: number }>(page, 'receiverStats')).audioPackets ?? 0).toBeGreaterThan(audioBefore);
  // "Stay vanished": still hidden a while later.
  expect((await h<Sample>(page, 'sample')).green).toBeGreaterThan(0.97);

  await dock.getByRole('button', { name: 'Reappear' }).first().click();
  await expect.poll(async () => (await h<Sample>(page, 'sample')).green, { timeout: 8000 }).toBeLessThan(0.05);
});
