# Feasibility findings (phase zero)

Date: 2026-10-26. Status of the **real Google Meet gate: PENDING** (requires a signed-in
Google account and a second participant; see "Manual Meet validation" below).

## Environment

| Item | Value |
| --- | --- |
| OS | macOS (Darwin 25.6.0), Apple M1 |
| Installed browser | Google Chrome 155.0.8059.86 (not automatable with unpacked extensions: branded Chrome ignores `--load-extension`) |
| Automated browser | Playwright Chromium 156.0.8078.4 (chromium-1248), headless, ANGLE Metal GPU |
| MediaPipe | `@mediapipe/tasks-vision` 1.1.1 (SIMD WASM, GPU delegate) |
| Models | `selfie_segmenter_landscape.tflite`, `hand_landmarker.task` (hashes in `scripts/assets.lock.json`) |
| Injection | MAIN-world content script at `document_start` + isolated controller; vision worker from a same-origin blob |

The target machine from the plan (i5-9300H, GTX 1650) and an integrated-GPU device have **not**
been measured yet.

## Meet's security headers (fetched 2026-10-26)

`https://meet.google.com/` sends three enforced policies:

1. `require-trusted-types-for 'script'`
2. `script-src 'report-sample' 'nonce-…' 'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:; object-src 'none'; base-uri 'self'`
3. `script-src 'unsafe-inline' 'unsafe-eval' blob: data: 'self' https://apis.google.com …` (allowlist, no `chrome-extension:`)

plus a report-only policy. The e2e suite serves a stand-in page at
`https://meet.google.com/…` with these exact headers (`tests/e2e/fixtures.ts`).

## Experiments and results

| # | Experiment | Result | Evidence |
| --- | --- | --- | --- |
| 1 | MAIN-world script at `document_start` wraps `getUserMedia` before page scripts | Works (stand-in page) | `meet-integration.spec.ts` |
| 2 | Original reference/binding kept; idempotent; native errors preserved | `OverconstrainedError` propagates unchanged | "native getUserMedia errors propagate" |
| 3 | Audio-only passthrough; video → processed video + original audio | Works; remote peer receives audio packets | "audio-only…", "proof mode…" |
| 4 | Constraints | Original constraints go to the real camera; `applyConstraints` is forwarded and the output follows (1280×720 → 640×360) | "applyConstraints…" |
| 5 | Processed video reaches a remote peer | **Yes over a local RTCPeerConnection**: grayscale + moving watermark received, live motion. Absolute Cinema letterbox and Dust Away (person → background) measured at the receiver. **Not yet verified through Meet's SFU.** | "proof mode…", "Absolute Cinema…", `dust-away.spec.ts` |
| 6 | Track API usage by Meet (stop/clone/enabled/getSettings/applyConstraints/device switch) | Adapters implemented for all of these and tested against the stand-in. **Which ones Meet actually calls is not observed yet.** | `track-adapter.ts`, "camera off…", "track.enabled=false…" |
| 7 | Release physical camera when no consumers remain (incl. clones, explicit stop) | Works; 12 toggles mid-effect leave 0 live source tracks | `lifecycle.spec.ts` |
| 8 | MediaPipe WASM/model loading under Meet CSP + Trusted Types | MediaPipe's own loader injection (`<script>`) would violate Trusted Types. Solved by providing the loader up front. **Worker:** a blob worker created via a dedicated Trusted Types policy works with **zero CSP violations**; GPU delegate available in the worker. Main-thread fallback via `scripting.executeScript` (world MAIN) also works. zod's JIT probe would cause CSP reports, so zod runs `jitless`. | "vision runtime loads…", `worker-probe.spec.ts` (@probe) |
| 9 | Hidden/background tab behaviour | Loop is driven by `MediaStreamTrackProcessor` reads and output by `MediaStreamTrackGenerator`, neither of which depends on `requestAnimationFrame`. **Not measured in a real hidden/minimised window** (headless cannot represent this). | pending |
| 10 | Enabled after Meet already has the camera | No retroactive replacement. The dock and popup show: "Turn your camera off and on in Meet (Ctrl+E twice), or reload before joining." | "enabled after the camera started…" |

### Performance measured (headless Chromium, Apple M1, fake 1280×720 @ 20 fps camera)

| Arrangement | Main-thread pipeline time | Segmentation | Hands |
| --- | --- | --- | --- |
| Inference on page thread | p50 14.4 ms, p95 28.7 ms | p50 11.7 ms | p50 12.5 ms |
| **Inference in worker (shipped)** | **p50 2.1 ms, p95 3.3 ms** | p50 12.2 ms round trip, 10/s | p50 20.8 ms round trip, 12.5/s |

Output stayed at 1280×720 (medium preset) with the worker. Pipeline time is the added local
processing per frame on the page thread; end-to-end meeting latency is not measured.

### Model semantics observed

`selfie_segmenter_landscape` reports one label, `"selfie"`, and one confidence mask, which is
person confidence (≈0–9 % coverage on the person-free fake camera; a drawn figure is
detected). The runtime resolves the mask by label, falls back by mask count, and shows the
rule in Diagnostics.

## Remaining risks

* Meet may use track APIs or internal checks not covered by the adapters (e.g. simulcast
  configuration on a generator track, label/device-id checks during device switching).
* Meet's own background-blur/effects pipeline may also wrap or replace the track.
* Hidden-tab throttling in real Chrome, and GPU budget on the i5/GTX 1650 target.
* Snap recognition quality is unmeasured on real hands (only synthetic sequences).
* `MediaStreamTrackProcessor`/`Generator` on `window` are Chrome-specific; Chrome may
  restrict them to workers in future. The `<video>`/`captureStream` fallback exists but is
  less robust in background tabs.

## Manual Meet validation (pending — needs two devices/accounts)

1. `npm install && npm run build`; open `chrome://extensions`, enable Developer mode,
   **Load unpacked** → `dist/`.
2. Click the SnapMeet icon → turn on **Use SnapMeet in Google Meet**. Open Settings and
   enable **Proof mode**.
3. On device A (with the extension) start a meeting. On device B (no extension; phone is
   fine) join it.
4. Verify on B: A's video is **grayscale** with a **moving "SNAPMEET PROOF hh:mm:ss.t"
   watermark** and a white bar sweeping along the bottom. Note A's audio is audible.
5. On A: toggle the camera off/on (Ctrl+E) twice; check B sees black/avatar then the
   watermarked video again; check the camera light turns **off** while the camera is off.
6. On A: switch camera in Meet settings (if a second camera exists). Leave the call;
   check the camera light turns off.
7. Turn off Proof mode. Setup tab → capture empty room (or pick a virtual background),
   press **Play Dust Away**; B should see A dissolve and the room remain while A keeps
   talking. Press **Reappear**. Try Absolute Cinema and one caption effect; check captions
   read correctly on B.
8. Try screen sharing on A while SnapMeet is on: B's shared screen must be unaffected.
9. Try Meet's own background blur together with SnapMeet; record what happens.
10. Minimise A's window for 2 minutes during the call; record whether B's video keeps
    moving (watch the watermark clock in proof mode).
11. Record Chrome version, OS, date and results in `docs/TEST_RESULTS.md`.
