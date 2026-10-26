import { test } from '@playwright/test';
import { launchWithExtension, openMeet, setSettings } from './fixtures';

// Feasibility probe (records results; no pass/fail semantics): can a dedicated Worker run
// inside Meet's CSP + Trusted Types from the MAIN world or from the extension's isolated world?
test('worker feasibility probe @probe', async () => {
  const ext = await launchWithExtension();
  await setSettings(ext, { enabled: false });
  const page = await openMeet(ext);
  const main = await page.evaluate(async () => {
    const out: Record<string, string> = {};
    const code = 'self.onmessage = (e) => self.postMessage(e.data * 2);';
    const tt = (window as unknown as { trustedTypes: { createPolicy(n: string, r: object): { createScriptURL(s: string): string } } }).trustedTypes.createPolicy('snapmeet-probe', { createScriptURL: (s: string) => s });
    for (const kind of ['blob', 'data']) {
      try {
        const url = kind === 'blob' ? URL.createObjectURL(new Blob([code], { type: 'text/javascript' })) : 'data:text/javascript,' + encodeURIComponent(code);
        const w = new Worker(tt.createScriptURL(url));
        out[kind] = await new Promise((res) => {
          w.onmessage = (e) => res('ok ' + e.data);
          w.onerror = (e) => res('error ' + (e.message || 'load failed'));
          w.postMessage(21);
          setTimeout(() => res('timeout'), 3000);
        });
      } catch (e) {
        out[kind] = 'throw ' + (e as Error).message;
      }
    }
    out.violations = JSON.stringify((window as unknown as { __violations: string[] }).__violations);
    return out;
  });
  const [tab] = await ext.sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://meet.google.com/*' })).map((t) => t.id));
  const isolated = await ext.sw.evaluate(async (tabId) => {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tabId! },
      world: 'ISOLATED',
      func: async () => {
        const code = 'self.onmessage = (e) => self.postMessage(e.data * 2);';
        try {
          const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
          return await new Promise<string>((res) => {
            w.onmessage = (e) => res('ok ' + e.data);
            w.onerror = (e) => res('error ' + (e.message || 'load failed'));
            w.postMessage(21);
            setTimeout(() => res('timeout'), 3000);
          });
        } catch (e) {
          return 'throw ' + (e as Error).message;
        }
      },
    });
    return r?.result;
  }, tab);
  console.log('WORKER_PROBE', JSON.stringify({ main, isolated }, null, 1));
  await ext.close();
});
