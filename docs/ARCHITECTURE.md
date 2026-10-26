# SnapMeet architecture

SnapMeet replaces the camera track that Google Meet receives with a processed track
rendered locally. Nothing about the call itself (signalling, audio, screen share) is touched.

## Contexts

| Context | Bundle | Runs | Responsibilities |
| --- | --- | --- | --- |
| MAIN world (Meet page) | `main-bootstrap.js` | `document_start`, top frame of `https://meet.google.com/*` | Wraps `getUserMedia`, owns the `Engine` (session, pipelines, GPU renderer, gestures, backgrounds). |
| Vision worker (Meet page) | blob of `wasm/vision_wasm_internal.js` + `vision-worker.js` | Started lazily by the engine | MediaPipe person segmentation and hand landmarks, off the page's main thread. |
| Main-thread vision fallback | `wasm/vision_wasm_internal.js` + `vision.js` | Injected by the service worker only if the worker cannot start | Same models on the page thread. |
| Isolated world | `content.js` | `document_start` | Extension storage, catalog, the Shadow-DOM control dock, keyboard shortcuts, message relay. Never sees frames. |
| Service worker | `service-worker.js` | Extension | Settings defaults, `chrome.commands` routing, `scripting.executeScript` for the vision fallback, daily optional catalog refresh. Never sees frames. |
| Popup / options | `popup.html`, `options.html` | Extension pages | Preferences, packs, diagnostics summary. They never open the camera. |
| Playground | `playground.html` (also `npm run dev`) | Extension page | Same `Engine.attachStream` path as Meet, on your own camera, plus a WebRTC loopback and gesture trials. |

## Video path

```
Meet calls getUserMedia({video, audio})
  └─ wrapper (gum-wrapper.ts): waits ≤1.5 s for settings; disabled → native stream untouched
      └─ real getUserMedia with Meet's original constraints (native errors propagate)
          ├─ audio tracks ─────────────────────────────────────────────┐ (returned unchanged)
          └─ camera track → MediaStreamTrackProcessor (VideoFrames)     │
                ├─ clone → vision worker (≤1 in flight per model) ──► mask / hand landmarks
                └─ WebGL2 FrameRenderer: effect or passthrough → scene → present
                      └─ new VideoFrame(OffscreenCanvas) → MediaStreamTrackGenerator
                            └─ adapted output track ───────────────────┴─► new MediaStream → Meet
```

The loop is driven by camera frames (`ReadableStream.read()`), not `requestAnimationFrame`.
Fallbacks (feature-detected): `<video>` + `requestVideoFrameCallback` input and
`canvas.captureStream()` output.

The renderer draws every frame into a scene framebuffer, then presents it. Text and artwork
are drawn with Canvas 2D into textures. Dust Away particles are stateless: each vertex derives
its origin, release time and trajectory from its id, the seed and time in the vertex shader.

### Failure handling

* Renderer failure or WebGL context loss: if the user is **not** hidden, the raw frame is
  sent through a Canvas 2D path; if hidden (dissolving, vanished, reappearing) the session
  enters `RECOVERY_REQUIRED` and a neutral "Video paused" frame is sent until the user
  presses **Return to camera** (or Reset / `Alt+Shift+A`).
* Camera restarted while vanished: also `RECOVERY_REQUIRED`.
* Vision failure: mask effects are refused with a message; other effects keep working.
* Pipeline attach failure before any effect: the native stream is returned (fail-open is
  safe because nothing is hidden at that point).

## Track ownership

`VideoPipeline` owns one physical camera track. Its consumers are the returned output track
plus every clone. `stop()` on a consumer removes it; when no consumers remain, the pipeline
stops the frame source, renderer and generator **and the physical camera track**.
`MediaStream.clone()` is routed through the adapted track `clone()` so clones are tracked.
If the camera ends by itself (unplug, permission revoked), every consumer is stopped and
receives an `ended` event, like a native track.

Track adapters (`bridge/track-adapter.ts`) forward to the real source: `label`,
`getSettings()` (real device id, group id, frame rate; width/height of the transmitted
frame), `getCapabilities()`, `getConstraints()`, `applyConstraints()`. `enabled = false` on
all consumers disables the source and keeps black frames flowing (as a disabled native
track would), instead of freezing the receiver on the last frame.

## Session state

`session/session.ts` is a pure state machine (unit-tested):

* session: `OFF → LOADING → LIVE ⇄ CALIBRATING`, `CAMERA_OFF`, `RECOVERY_REQUIRED`
* effect: `IDLE`, `PLAYING`, `DISINTEGRATING → VANISHED → REAPPEARING`

## Bridge

Isolated → MAIN: one `window.postMessage` hands over a private `MessagePort`; the MAIN
listener is registered at `document_start` in the capture phase and stops propagation of
the hello. Commands are a finite zod-validated union with request ids and a 192 KB size
limit. The page shares the MAIN world, so this is a validation boundary, not a trust
boundary: the worst a hostile page script could do is trigger an effect on the user's own
camera. No fetch, eval, file or extension-API forwarding exists. No frames cross it.

## Effects and catalog

`effects/registry.ts` maps 8 bundled templates to renderers (`load / start / render /
cancel / dispose`). Catalog entries (`catalog/schema.ts`) are data that select a template
and bounded parameters. See [EFFECT_AUTHORING.md](EFFECT_AUTHORING.md).

## Scheduling and quality

* Segmentation input 256 px wide, hands 640 px wide; intervals per quality preset
  (`engine/quality.ts`), at most one request in flight per model, frames are dropped
  rather than queued. Hidden states run segmentation at 5 Hz only to prepare the reappear.
* Hands run only when snap/palms is enabled or during calibration, and only while idle.
* `AdaptiveQuality` steps down after 4 s over budget and up after 20 s of headroom,
  never while an effect is running; model warm-up is excluded.
