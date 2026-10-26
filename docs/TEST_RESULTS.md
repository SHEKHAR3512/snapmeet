# Test results

Date: 2026-10-26 · Commit: see git history · Machine: Apple M1, macOS (Darwin 25.6.0)

Status legend: **implemented** → **unit-tested** → **browser-tested** (Chromium + extension,
Meet-header stand-in) → **real-Meet-verified**. Nothing is real-Meet-verified yet.

## Environment

| Item | Version |
| --- | --- |
| Automated browser | Playwright Chromium 156.0.8078.4 (headless, ANGLE Metal GPU) |
| Installed Chrome | Google Chrome 155.0.8059.86 (manual testing only) |
| Node.js | 24.16.0 |
| MediaPipe Tasks Vision | 1.1.1, GPU delegate, in a dedicated worker |
| Fake camera | Chromium fake device (1280×720 @ 20 fps) and `tests/fixtures/synthetic-figure.y4m` (320×180 drawn figure) |

## Automated suites

| Suite | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | pass |
| Unit tests (`npm test`) | **59 / 59 pass** — session state machine, snap/palms/calibration sequences, catalog schema/store/rollback, remote refresh, settings migration, bridge validation, quality hysteresis, mask processing, drift, particles |
| Meet-header integration (`meet-integration.spec.ts`) | **10 / 10 pass** |
| Renderer frame fixtures (`renderer.spec.ts`) | **5 / 5 pass** |
| Dust Away over WebRTC (`dust-away.spec.ts`) | **1 / 1 pass** |
| Lifecycle + network audit (`lifecycle.spec.ts`) | **2 / 2 pass** |

### What the browser tests established

| Scenario (plan §16) | Outcome | Level |
| --- | --- | --- |
| Receiver sees the processed effect | Grayscale + moving watermark; Absolute Cinema letterbox; Dust Away background-only frames — all measured at an `RTCPeerConnection` receiver | browser-tested |
| Enabled before acquisition | Pipeline attached; real device label/id forwarded | browser-tested |
| Enabled after joining | Reacquire guidance shown; no silent replacement | browser-tested |
| Camera off/on, clones | Physical camera released when the last consumer stops; restart clean (12 toggles mid-effect) | browser-tested |
| `track.enabled = false` | Receiver gets black (not a frozen last frame) | browser-tested |
| Microphone | Original audio track returned; receiver audio packets keep increasing while vanished | browser-tested |
| Audio-only request / native errors | Passed through / `OverconstrainedError` unchanged | browser-tested |
| Reset during every transition | Deterministic return to LIVE/IDLE | unit-tested |
| Failure while vanished | `RECOVERY_REQUIRED`, neutral frame, explicit return (unit); camera restart while vanished → recovery, keyboard recovery works (browser) | unit + browser |
| Hidden state has no person remnants | Renderer fixture: 0 live-camera pixels while dissolving/vanished; receiver: >97 % background pixels | browser-tested |
| All 8 templates | Render visibly, no GL errors, return to exact passthrough; reduced-motion variants; visual review of contact sheets | browser-tested |
| Vision under Meet CSP + Trusted Types | Worker + GPU, 0 CSP violations, 0 page errors | browser-tested |
| Network | Page context contacts only the Meet origin and the extension package | browser-tested |
| Malformed / failed content update | Last good collection kept | unit-tested |

### Performance (headless Chromium, Apple M1)

| Metric | Value |
| --- | --- |
| Added main-thread pipeline time | p50 1.5–2.1 ms, p95 2.8–3.3 ms |
| Segmentation (worker round trip) | p50 ≈ 12 ms, ~10 updates/s |
| Hand landmarks (worker round trip) | p50 ≈ 21 ms, ~12.5 updates/s (camera at 20 fps) |
| Render rate | 20 fps (= fake camera rate) |
| Output | 1280×720 (medium), no automatic downgrade |

### Soak (`npm run test:probes`, SNAPMEET_SOAK_MIN=30)

Effect every 20 s, snap tracking on, data at the first 22 minutes (run in progress when recorded):

| Minute | JS heap | DOM nodes | Listeners |
| --- | --- | --- | --- |
| 1 | 6.4 MB | 623 | 222 |
| 5 | 6.9 MB | 756 | 349 |
| 10 | 7.1 MB | 758 | 342 |
| 15 | 7.9 MB | 1139 | 413 |
| 22 | 7.3 MB | 1132 | 369 |

Heap is flat (6.4–7.9 MB, no monotonic growth). DOM nodes stepped once at minute 11
(756 → 1130) and stayed flat — consistent with dock content (notice/diagnostics rows), not
a leak, but worth a look. One pipeline and one live camera track throughout; frames and
audio kept arriving at the receiver. GPU/native memory was not measured.

## Not yet tested (pending, with reason)

| Scenario | Why pending |
| --- | --- |
| Two participants in a real Google Meet call | Needs a signed-in account and a second device — steps in `docs/FEASIBILITY.md` |
| Meet's own use of track APIs, device switching, Meet background effects together | Requires real Meet |
| Hidden / minimised window | Headless cannot represent it; manual test with Proof mode watermark |
| Screen sharing untouched | `getDisplayMedia` is never wrapped (by design); confirm in real Meet |
| Real person, real room, poor light, camera moved after capture | Needs a person and camera |
| Snap accuracy (≥80 % of 30 snaps, ≤1 false trigger / 10 min) | Needs consented human trials (playground → Gesture trials) |
| i5-9300H / GTX 1650 and integrated-GPU performance | Hardware not available here |
| Offline after install | All assets are bundled and the network audit is clean; a real offline run is still to do |
