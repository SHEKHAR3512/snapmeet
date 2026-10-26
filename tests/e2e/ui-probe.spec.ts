import { test } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, openMeet, setSettings } from './fixtures';

// UI/visual probe (@probe): screenshots of the dock tabs and received Dust Away frames.
const HERE = dirname(fileURLToPath(import.meta.url));
const VIDEO = join(HERE, '..', 'fixtures', 'synthetic-figure.y4m');

test('ui screenshots @probe', async () => {
  const out = process.env.SNAPMEET_SHOTS ?? join(HERE, '..', '..', 'test-results', 'shots');
  const ext = await launchWithExtension({ videoFile: VIDEO });
  await setSettings(ext, { enabled: true, showDock: true, dockCollapsed: false, selectedEffectId: 'dust-away', backgroundMode: 'virtual', virtualBackgroundId: 'night-city', reappearAfterMs: 0 });
  const page = await openMeet(ext);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(async () => {
    await (window as unknown as { __h: { call(): Promise<unknown> } }).__h.call();
    const v = (window as unknown as { __remote: HTMLVideoElement }).__remote;
    v.style.cssText = 'position:fixed;right:16px;top:16px;width:640px;height:360px;background:#000';
    document.body.style.background = '#202124';
    document.body.appendChild(v);
  });
  const dock = page.locator('snapmeet-dock');
  await dock.getByRole('tab', { name: 'Diagnostics' }).click();
  await dock.getByText(/^ready \(/).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(out, 'ui-diagnostics.png') });
  for (const tab of ['Setup', 'Gestures', 'Effects']) {
    await dock.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `ui-${tab.toLowerCase()}.png`) });
  }
  await page.waitForTimeout(1000);
  await dock.getByRole('button', { name: 'Play Dust Away' }).first().click();
  for (const t of [500, 700, 800, 2000]) {
    await page.waitForTimeout(t);
    await page.screenshot({ path: join(out, `dust-remote-${t}.png`), clip: { x: 624, y: 16, width: 640, height: 360 } });
  }
  await page.screenshot({ path: join(out, 'ui-vanished.png') });
  await dock.getByRole('button', { name: 'Collapse controls' }).click();
  await page.screenshot({ path: join(out, 'ui-collapsed.png'), clip: { x: 0, y: 600, width: 600, height: 200 } });
  await ext.close();
});
