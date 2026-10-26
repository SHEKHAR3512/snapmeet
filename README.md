# SnapMeet

A Chrome extension that turns **your own outgoing Google Meet camera** into real-time meme
effects — snap (or press a button) and dissolve into dust, go Absolute Cinema, flex an
Aura +9999. Other participants see the effect in your video without installing anything.
Everything runs locally in your browser: no servers, accounts, paid APIs or uploads.

> **Status: beta, real-Meet validation pending.** The camera pipeline, effects and vision
> runtime are verified in automated tests against a stand-in page that uses Google Meet's
> exact security headers, and over a real WebRTC connection. A two-person test in an actual
> Meet call has not been run yet — see [docs/FEASIBILITY.md](docs/FEASIBILITY.md#manual-meet-validation-pending--needs-two-devicesaccounts).
> Snap detection is **experimental**.

## Effects

| Effect | What others see | Needs setup |
| --- | --- | --- |
| Dust Away | Your body dissolves into dust; the empty room (or a virtual background) stays | Empty-room capture or virtual background |
| Absolute Cinema | Monochrome, letterbox bars, film grain, title card | — |
| Aura +9999 | Glowing outline and a counting score | — |
| Indian Serial Drama | Three dramatic zoom punches with soft tints | — |
| Aayein? | Freeze frame, floating question marks | — |
| Emotional Damage | Short shake, punch-in, impact caption | — |
| This Is Fine | Original procedural flames and a calm speech bubble | — |
| Mission Passed | Game-inspired success title | — |

Plus two variants (Main Character Energy, Plot Twist). More can be added as data-only
collections — see [docs/EFFECT_AUTHORING.md](docs/EFFECT_AUTHORING.md).

## Requirements

* Desktop Google Chrome 116+ (or Chromium) with WebGL2. Tested with Chromium 156.
* Node.js 22+ to build.

## Install (unpacked)

```bash
npm install          # also copies the MediaPipe WASM runtime into public/wasm
npm run build        # verifies pinned model hashes, writes dist/
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, choose `dist/`.
2. Click the SnapMeet toolbar icon and switch on **Use SnapMeet in Google Meet**.
3. Join (or reload) a Meet call. If you were already in the call, turn your camera off and
   on once — SnapMeet cannot replace a camera Meet already opened.

`npm run package` produces `release/snapmeet-<version>.zip`.
**Uninstall:** remove it in `chrome://extensions`; Meet goes back to your normal camera
immediately after a reload.

## Use

* A small **SnapMeet** panel appears at the bottom-left of Meet. Click an effect card to
  play it. **Reset** is always visible, even when collapsed.
* **Dust Away:** open **Setup**, choose *Empty room* (a 5-second countdown, step out of the
  frame) or a *Virtual* background, then play it. While vanished you stay connected and
  audible; press **Reappear** or wait for the timer (3/5/10 s or stay vanished).
* **Snap to trigger (experimental):** Gestures tab → turn on, practise 5 snaps, adjust
  sensitivity. Buttons and shortcuts always work.
* **Shortcuts:** `Alt+Shift+S` play selected · `Alt+Shift+A` reappear / return to camera ·
  `Alt+Shift+X` reset · `Alt+Shift+M` show/hide controls. Change them at
  `chrome://extensions/shortcuts`. They are ignored while typing in chat.
* **Playground:** popup → *Open playground* (or `npm run dev`) to try effects on your own
  camera, check what a WebRTC receiver gets, and run gesture trials.
* Your self-view in Meet is mirrored, so captions look reversed **to you** — others see
  them the right way round.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Meet started your camera before SnapMeet was on" | Toggle the camera off/on (Ctrl+E twice) or reload before joining. |
| "SnapMeet is not connected to this tab" | Reload the Meet tab (happens after installing/updating). |
| Dust Away says it needs setup | Setup tab → capture the empty room or pick a virtual background. |
| "No person detected" / "Finding you in the frame" | Sit centred with your head and shoulders visible and decent light. |
| Room capture warns the camera moved / light changed | Recapture the empty room. |
| Video shows "Video paused" | Privacy fallback after an error or camera restart while vanished: press **Return to camera**. |
| Effects are disabled, WebGL2 unavailable | Enable hardware acceleration in Chrome settings. |
| Choppy video | Setup → lower quality; leave *Lower quality automatically* on. Diagnostics shows timings. |

## Development

```bash
npm run dev          # playground on a Vite dev server
npm run typecheck && npm run lint
npm test             # unit tests (Vitest)
npm run test:e2e     # build + Playwright (loads dist/ into Chromium; needs `npx playwright install chromium`)
npm run test:probes  # evidence probes: diagnostics dump, worker probe, screenshots, soak (SNAPMEET_SOAK_MIN)
npm run catalog:validate -- docs/examples/example-pack.json
```

Docs: [Architecture](docs/ARCHITECTURE.md) · [Feasibility](docs/FEASIBILITY.md) ·
[Test results](docs/TEST_RESULTS.md) · [Effect authoring](docs/EFFECT_AUTHORING.md) ·
[Privacy](docs/PRIVACY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Tasks](TASKS.md)

## Known limitations

* Real-Meet compatibility and hidden/minimised-tab behaviour are not yet verified.
* SnapMeet must be on before Meet opens the camera (or the camera toggled afterwards).
* The empty-room background is a still image: moving the camera or changing light breaks
  the illusion until you recapture. Unseen pixels behind you are never invented.
* Dust Away briefly freezes your silhouette at the snap while it dissolves (artistic choice).
* Snap recognition is a heuristic, unmeasured on real hands; the palms gesture likewise.
* Fonts are system font stacks; on systems without Impact/Didot captions use fallbacks.
* No audio effects (planned for V2).
