import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DIST = join(HERE, '..', '..', 'dist');
export const MEET_URL = 'https://meet.google.com/snp-e2e-test';
const NONCE = 'snapmeete2enonce';

/**
 * Google Meet's response CSP headers, copied verbatim from https://meet.google.com/ on
 * 2026-10-26 (only the nonce differs). Two enforced script-src policies plus Trusted
 * Types: the MAIN-world bundle and the lazily injected vision runtime must work under these.
 */
export const MEET_CSP_HEADERS: Array<[string, string]> = [
  ['content-security-policy', "require-trusted-types-for 'script';report-uri /_/MeetingsUi/cspreport"],
  [
    'content-security-policy',
    `script-src 'report-sample' 'nonce-${NONCE}' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:;object-src 'none';base-uri 'self';report-uri /_/MeetingsUi/cspreport`,
  ],
  [
    'content-security-policy',
    "script-src 'unsafe-inline' 'unsafe-eval' blob: data: 'self' https://apis.google.com https://ssl.gstatic.com https://www.google.com https://www.googletagmanager.com https://www.gstatic.com https://www.google-analytics.com https://www.google.com/tools/feedback/ https://www.gstatic.com/feedback/js/ https://www.gstatic.com/inproduct_help/ https://www.gstatic.com/support/content/ https://www.gstatic.com/uservoice/feedback/client/web/live/ https://www.gstatic.com/uservoice/surveys/resources/prod/js/survey/ https://support.google.com/inapp/ https://youtube.googleapis.com https://youtube.com https://s.ytimg.com https://www.youtube.googleapis.com https://static.corp.google.com https://meet.google.com/_/ink/release/;report-uri /_/MeetingsUi/cspreport/allowlist",
  ],
];

const MEET_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Meet (SnapMeet e2e stand-in)</title>
<script nonce="${NONCE}">
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI));
</script></head><body><main id="app">fake meet</main></body></html>`;

export interface Ext {
  context: BrowserContext;
  sw: Worker;
  close(): Promise<void>;
}

export async function launchWithExtension(): Promise<Ext> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'snapmeet-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  await context.grantPermissions(['camera', 'microphone'], { origin: 'https://meet.google.com' });
  // Report endpoint: swallow (and never reach Google).
  await context.route('https://meet.google.com/_/**', (r) => r.fulfill({ status: 204 }));
  await context.route(`${MEET_URL}*`, (route) => {
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
    // Repeated CSP headers are equivalent to one comma-separated policy list (CSP3), parsed as separate policies.
    headers['content-security-policy'] = MEET_CSP_HEADERS.map(([, v]) => v).join(', ');
    return route.fulfill({ status: 200, headers, body: MEET_HTML });
  });
  let sw = context.serviceWorkers()[0];
  sw ??= await context.waitForEvent('serviceworker');
  return {
    context,
    sw,
    async close() {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export async function setSettings(ext: Ext, patch: Record<string, unknown>): Promise<void> {
  await ext.sw.evaluate(async (p) => {
    const key = 'snapmeet.settings';
    const cur = (await chrome.storage.local.get(key))[key] ?? {};
    await chrome.storage.local.set({ [key]: { ...cur, ...p } });
  }, patch);
}

export async function openMeet(ext: Ext): Promise<Page> {
  const page = await ext.context.newPage();
  await page.goto(MEET_URL);
  await installHelpers(page);
  return page;
}

/** Page-side helpers: acquire like Meet, send over a peer connection, sample what the receiver decodes. */
async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__h = {
      async call(constraints: MediaStreamConstraints = { video: { width: 1280, height: 720 }, audio: true }) {
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        w.__local = s;
        const vt = s.getVideoTracks()[0];
        const info = {
          video: s.getVideoTracks().length,
          audio: s.getAudioTracks().map((t) => t.label),
          label: vt?.label ?? null,
          settings: vt?.getSettings() ?? null,
        };
        if (!vt) return info;
        const a = new RTCPeerConnection();
        const b = new RTCPeerConnection();
        a.onicecandidate = (e) => e.candidate && void b.addIceCandidate(e.candidate);
        b.onicecandidate = (e) => e.candidate && void a.addIceCandidate(e.candidate);
        const remote = new Promise<MediaStreamTrack>((res) => {
          b.ontrack = (e) => e.track.kind === 'video' && res(e.track);
        });
        for (const t of s.getTracks()) a.addTrack(t, s);
        await a.setLocalDescription();
        await b.setRemoteDescription(a.localDescription!);
        await b.setLocalDescription();
        await a.setRemoteDescription(b.localDescription!);
        const v = document.createElement('video');
        v.muted = true;
        v.srcObject = new MediaStream([await remote]);
        await v.play();
        w.__remote = v;
        w.__pcs = [a, b];
        return info;
      },
      sample() {
        const v = w.__remote as HTMLVideoElement;
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 90;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(v, 0, 0, 160, 90);
        const d = ctx.getImageData(0, 0, 160, 90).data;
        let sat = 0;
        let luma = 0;
        let topBand = 0;
        let topCount = 0;
        const lumas: number[] = [];
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const r = d[i]!;
          const g = d[i + 1]!;
          const b = d[i + 2]!;
          sat += Math.max(r, g, b) - Math.min(r, g, b);
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          luma += l;
          lumas.push(l);
          if (Math.floor(p / 160) < 6) {
            topBand += l;
            topCount++;
          }
        }
        const n = d.length / 4;
        return { meanSat: sat / n, meanLuma: luma / n, topBandLuma: topBand / topCount, lumas, width: v.videoWidth, height: v.videoHeight };
      },
      async receiverStats() {
        const [, b] = w.__pcs as RTCPeerConnection[];
        const out: Record<string, number> = {};
        (await b!.getStats()).forEach((s) => {
          if (s.type === 'inbound-rtp') {
            if (s.kind === 'video') out.framesDecoded = s.framesDecoded;
            if (s.kind === 'audio') out.audioPackets = s.packetsReceived;
          }
        });
        return out;
      },
      counters() {
        const dbg = (globalThis as unknown as Record<symbol, { counters(): unknown } | undefined>)[Symbol.for('snapmeet.debug')];
        return dbg ? dbg.counters() : null;
      },
    };
  });
}

export function lumaDiff(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}
