import { expect, test } from '@playwright/test';
import { launchWithExtension, openMeet, setSettings } from './fixtures';

// Evidence capture (not an assertion suite): prints engine diagnostics under the Meet CSP stand-in.
test('dump diagnostics @probe', async () => {
  const ext = await launchWithExtension();
  await setSettings(ext, { enabled: true, showDock: true, dockCollapsed: false, selectedEffectId: 'dust-away', snapEnabled: true });
  const page = await openMeet(ext);
  await page.evaluate(() => (window as unknown as { __h: { call(): Promise<unknown> } }).__h.call());
  const dock = page.locator('snapmeet-dock');
  await dock.getByRole('tab', { name: 'Diagnostics' }).click();
  await expect(dock.getByText(/^ready \((GPU|CPU), (worker|main-thread)\)$/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(15000);
  console.log('DIAG\n' + (await dock.locator('dl.sm-kv').innerText()));
  await ext.close();
});
