import { expect, test, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, MEET_URL, openMeet, setSettings, type Ext } from './fixtures';

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'synthetic-figure.y4m');
type Counters = { pipelines: number; liveSources: number; consumers: number; phase: string; effectPhase: string };
const counters = (page: Page) => page.evaluate(() => (window as unknown as { __h: { counters(): Counters } }).__h.counters());

let ext: Ext;
test.beforeEach(async () => {
  ext = await launchWithExtension({ videoFile: VIDEO });
});
test.afterEach(async () => {
  await ext.close();
});

test('repeated camera toggles mid-effect leave no orphan capture tracks; keyboard recovery works', async () => {
  await setSettings(ext, { enabled: true, showDock: false, selectedEffectId: 'dust-away', backgroundMode: 'virtual', reappearAfterMs: 3000 });
  const page = await openMeet(ext);
  let recoveries = 0;
  let dusts = 0;
  for (let i = 0; i < 12; i++) {
    await page.evaluate(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      (window as unknown as { __s: MediaStream }).__s = s;
    });
    await expect.poll(async () => (await counters(page)).pipelines).toBe(1);
    await expect.poll(async () => (await counters(page)).phase).toMatch(/^(LIVE|RECOVERY_REQUIRED)$/);
    if ((await counters(page)).phase === 'RECOVERY_REQUIRED') {
      // Camera restarted while vanished: neutral frame until the user explicitly returns.
      recoveries++;
      await page.keyboard.press('Alt+Shift+A');
      await expect.poll(async () => (await counters(page)).phase).toBe('LIVE');
    }
    await page.waitForTimeout(800); // let segmentation produce a mask
    await page.keyboard.press('Alt+Shift+S'); // play the selected effect (Dust Away)
    await page.waitForTimeout(i % 2 ? 4200 : 300); // stop mid-dissolve or while vanished
    if ((await counters(page)).effectPhase !== 'IDLE') dusts++;
    await page.evaluate(() => (window as unknown as { __s: MediaStream }).__s.getTracks().forEach((t) => t.stop()));
    await expect.poll(() => counters(page)).toMatchObject({ pipelines: 0, liveSources: 0, consumers: 0, phase: 'CAMERA_OFF' });
  }
  test.info().annotations.push({ type: 'lifecycle', description: `dust runs interrupted: ${dusts}, recoveries: ${recoveries}` });
  expect(dusts).toBeGreaterThan(6);
  expect(recoveries).toBeGreaterThan(3);
});

test('page network audit: only the Meet origin and the extension package are contacted', async () => {
  const urls = new Set<string>();
  ext.context.on('request', (r) => urls.add(new URL(r.url()).origin));
  await setSettings(ext, { enabled: true, showDock: true, snapEnabled: true, selectedEffectId: 'dust-away' });
  const page = await openMeet(ext);
  await page.evaluate(() => (window as unknown as { __h: { call(): Promise<unknown> } }).__h.call());
  const dock = page.locator('snapmeet-dock');
  await dock.getByRole('tab', { name: 'Diagnostics' }).click();
  await expect(dock.getByText(/^ready \(/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const external = [...urls].filter((o) => o !== new URL(MEET_URL).origin && !o.startsWith('chrome-extension://') && o !== 'null');
  expect(external).toEqual([]);
});
