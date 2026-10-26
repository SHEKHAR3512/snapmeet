import { test } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openMeet, setSettings } from './fixtures';

/**
 * Soak probe (@probe). SNAPMEET_SOAK_MIN minutes (default 30) of a processed call with an
 * effect every 20 s and snap tracking on. Logs JS heap, render rate and counters each
 * minute to test-results/soak.log (or $SNAPMEET_SOAK_LOG).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO = join(HERE, '..', 'fixtures', 'synthetic-figure.y4m');

test('soak @probe', async () => {
  const minutes = Number(process.env.SNAPMEET_SOAK_MIN ?? 30);
  test.setTimeout((minutes + 3) * 60_000);
  const log = process.env.SNAPMEET_SOAK_LOG ?? join(HERE, '..', '..', 'test-results', 'soak.log');
  mkdirSync(dirname(log), { recursive: true });
  const ext = await launchWithExtension({ videoFile: VIDEO });
  await setSettings(ext, { enabled: true, showDock: true, dockCollapsed: false, snapEnabled: true, selectedEffectId: 'dust-away', backgroundMode: 'virtual', reappearAfterMs: 3000 });
  const page = await openMeet(ext);
  const cdp = await ext.context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => (window as unknown as { __h: { call(): Promise<unknown> } }).__h.call());
  const dock = page.locator('snapmeet-dock');
  await dock.getByRole('tab', { name: 'Diagnostics' }).click();
  const effects = ['Play Dust Away', 'Play Absolute Cinema', 'Play Emotional Damage', 'Play This Is Fine'];
  const start = Date.now();
  let n = 0;
  appendFileSync(log, `# soak start ${new Date().toISOString()} for ${minutes} min\n`);
  while (Date.now() - start < minutes * 60_000) {
    await page.waitForTimeout(20_000);
    await page.keyboard.press('Alt+Shift+X');
    await dock.getByRole('tab', { name: 'Effects' }).click();
    await dock.getByRole('button', { name: effects[n++ % effects.length]! }).first().click().catch(() => {});
    await dock.getByRole('tab', { name: 'Diagnostics' }).click();
    if (n % 3 === 0) {
      const m = (await cdp.send('Performance.getMetrics')).metrics;
      const get = (k: string) => m.find((x) => x.name === k)?.value ?? 0;
      const c = await page.evaluate(() => (window as unknown as { __h: { counters(): unknown } }).__h.counters());
      const diag = (await dock.locator('dl.sm-kv').innerText()).replace(/\n/g, ' | ');
      const rs = await page.evaluate(() => (window as unknown as { __h: { receiverStats(): Promise<unknown> } }).__h.receiverStats());
      appendFileSync(log, `${((Date.now() - start) / 60_000).toFixed(1)}min heapMB=${(get('JSHeapUsedSize') / 1e6).toFixed(1)} nodes=${get('Nodes')} listeners=${get('JSEventListeners')} counters=${JSON.stringify(c)} receiver=${JSON.stringify(rs)} diag=${diag}\n`);
    }
  }
  appendFileSync(log, `# soak end ${new Date().toISOString()}\n`);
  await ext.close();
});
