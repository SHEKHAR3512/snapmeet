<div align="center">

<img src="public/assets/icon-128.png" width="96" alt="SnapMeet icon" />

# SnapMeet

**Snap your fingers in Google Meet and dissolve into dust.**

A Chrome extension that adds real-time meme effects to *your own* outgoing Meet camera.
Everyone else in the call sees them, and they don't need to install anything.

100% local · no servers · no accounts · no paid APIs · nothing uploaded

</div>

> [!IMPORTANT]
> **Beta.** The camera pipeline, all eight effects and the on-device AI are covered by
> automated tests that run against a page using Google Meet's exact security headers and
> a real WebRTC connection. A test in a live two-person Meet call is **still pending**, and
> finger-snap detection is **experimental**. See [Status](#status).

---

## ✨ Effects

| | Effect | What the other participants see |
| --- | --- | --- |
| 🫥 | **Dust Away** | Your body disintegrates into drifting dust; your empty room (or a virtual background) stays. You keep talking the whole time. |
| 🎬 | **Absolute Cinema** | Face-tracked suit, black-and-white grade, film grain and title. |
| 💜 | **Aura +9999** | A glowing outline around you and a score that counts up. |
| 📺 | **Indian Serial Drama** | Three dramatic zoom punches toward your face with tinted shock frames. |
| ❓ | **Aayein?** | Freeze frame with bouncing question marks. |
| 💥 | **Emotional Damage** | A quick shake, punch-in and impact caption. |
| 🔥 | **This Is Fine** | Face-tracked hat, coffee mug, flames and a calm speech bubble. |
| 🏆 | **Mission Passed** | Sunglasses on your eyes, Mission Passed / Respect ++ and the GTA completion sting. |

Plus *Main Character Energy* and *Plot Twist* variants. New effects can be added as small
JSON collections, without writing code — see [Effect authoring](docs/EFFECT_AUTHORING.md).

Trigger effects by **clicking**, with **keyboard shortcuts**, or (experimental) by
**snapping your fingers** / **raising both palms**.

## 🧠 How it works

```
Google Meet asks for your camera
        │
        ▼
SnapMeet wraps getUserMedia (only when you've switched it on)
        │
        ├── microphone ─────────────────────────────── passed through untouched ──┐
        │                                                                          │
        └── camera frames ─► WebGL2 effects renderer ─► processed video track ─────┴─► Meet
                   │                    ▲
                   └─► MediaPipe (in a worker): person mask + hand/face landmarks
```

* Runs inside the Meet tab — the effect is part of the video Meet sends, so the other
  side needs nothing installed.
* Person segmentation and hand tracking use Google's MediaPipe models **bundled in the
  extension** and running in a background worker, so Meet's own UI stays smooth.
* Dust Away particles are simulated entirely on the GPU.
* Privacy fail-safe: if anything breaks while you're "vanished", SnapMeet sends a neutral
  *Video paused* frame instead of suddenly revealing your camera.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🚀 Quick start

**Requirements:** desktop Chrome 116+ with hardware acceleration, Node.js 22+.

```bash
git clone https://github.com/SHEKHAR3512/snapmeet.git
cd snapmeet
npm install        # also copies the MediaPipe WASM runtime into public/wasm
npm run build      # verifies model checksums and writes the extension to dist/
```

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick `dist/`.
2. Click the SnapMeet toolbar icon → switch on **Use SnapMeet in Google Meet**.
3. Join a Meet call. *(Already in a call? Turn your camera off and on once.)*
4. Use the **SnapMeet** panel at the bottom-left of Meet.

For Dust Away, first open **Setup** and either capture your empty room (5-second countdown —
step out of the frame) or choose a virtual background.

### ⌨️ Shortcuts

| Keys | Action |
| --- | --- |
| `Alt+Shift+S` | Play the selected effect |
| `Alt+Shift+A` | Reappear / return to camera |
| `Alt+Shift+X` | Reset effects |
| `Alt+Shift+M` | Show / hide the controls |

Change them at `chrome://extensions/shortcuts`. They're ignored while you type in chat.

### 🧪 Try it without joining a call

The **playground** (popup → *Open playground*, or `npm run dev`) runs the same engine on
your camera, shows what a WebRTC receiver gets, and includes a gesture-trial recorder.

## 📷 Testing in a real Meet call without a webcam

Start Chrome with a fake camera that plays a video file:

```bash
# macOS — quit Chrome first (Cmd+Q)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/snapmeet-test-profile" \
  --use-fake-device-for-media-stream \
  --use-file-for-fake-video-capture="$PWD/tests/fixtures/synthetic-figure.y4m"
```

Load `dist/` in that window, switch SnapMeet on, enable **Proof mode** in Settings, and
join a meeting from a second device (e.g. your phone). The phone should show grayscale video
with a moving **SNAPMEET PROOF** watermark. Keep the fake microphone muted — it beeps.

To use a clip of yourself instead (loops automatically):

```bash
ffmpeg -i me.mp4 -t 15 -vf scale=1280:720,fps=30 -pix_fmt yuv420p me.y4m
```

No luck with the flags? Use [OBS](https://obsproject.com/) → Media Source → **Start Virtual Camera**.
The full checklist is in [docs/FEASIBILITY.md](docs/FEASIBILITY.md#manual-meet-validation-pending--needs-two-devicesaccounts).

## 🔒 Privacy

* Video is processed **on your device**. It is never recorded, uploaded or stored.
* Meme clips are mixed into microphone streams locally. Meet mute also mutes the clips. Screen sharing is never modified.
* Room captures and custom backgrounds live in memory for that tab only.
* No analytics, no accounts. Opening the popup never turns on your camera.
* The only optional network request is a remote effect collection *you* configure.

Full policy: [docs/PRIVACY.md](docs/PRIVACY.md).

## 🛠️ Development

```bash
npm run dev           # playground on a Vite dev server
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm test              # unit tests (Vitest)
npx playwright install chromium
npm run test:e2e      # build + browser tests (extension loaded into Chromium)
npm run test:probes   # measurements: diagnostics, worker probe, screenshots, soak
npm run package       # release/snapmeet-<version>.zip
npm run catalog:validate -- docs/examples/example-pack.json
```

The e2e suite serves a stand-in page at `https://meet.google.com/…` with Meet's real
Content-Security-Policy and Trusted Types headers, sends SnapMeet's output over a real
`RTCPeerConnection`, and measures what the receiver decodes (e.g. that a vanished user is
background-only, that the mic keeps flowing, that the camera is released).

### Project layout

```
src/
  bridge/      MAIN-world bootstrap, getUserMedia wrapper, track adapters, protocol
  engine/      pipeline, WebGL2 renderer, quality, backgrounds, diagnostics
  effects/     effect templates (dust, cinema, aura, …) and sprite/text rendering
  vision/      MediaPipe runtime, worker, mask processing
  gestures/    snap / palms detectors, calibration
  session/     effect state machine
  catalog/     effect schema, built-in catalog, packs, remote refresh
  content/     isolated-world controller, shortcuts
  ui/          dock, popup, options
  extension/   manifest, service worker
playground/    local test page
tests/         unit (Vitest) and e2e (Playwright)
docs/          architecture, feasibility, privacy, authoring, test results
```

## 📊 Status

| Area | State |
| --- | --- |
| Outgoing video pipeline, effects, recovery, cleanup | ✅ Automated tests (Meet-header stand-in + WebRTC) |
| Vision under Meet's CSP / Trusted Types (worker, GPU) | ✅ Automated tests |
| Live two-person Google Meet call | ⏳ Pending manual test |
| Hidden / minimised tab behaviour | ⏳ Pending manual test |
| Finger-snap accuracy on real hands | 🧪 Experimental, off by default |

Progress and next steps: [TASKS.md](TASKS.md) · Results: [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md)

### Known limitations

* SnapMeet must be on before Meet opens your camera (or toggle the camera afterwards).
* The empty-room background is a still photo; moving the camera or changing the light means recapturing.
* Dust Away briefly freezes your silhouette at the snap while it dissolves (an artistic choice).
* Local SnapMeet video elements receive a mirror correction; outgoing captions retain normal orientation.
* Uses system fonts; on machines without Impact/Didot, fallbacks are used.

## 🤝 Contributing

Issues and pull requests are welcome — especially results from real Meet calls (include
your Chrome version, OS and a screenshot of the Diagnostics tab), new effect collections,
and snap-detection trial data.

## ⚖️ Notes

SnapMeet is an independent project and is **not affiliated with or endorsed by Google**.
"Google Meet" is a trademark of Google LLC. Visual props are procedural; bundled third-party meme sound sources and variant choices are recorded in `public/audio/sources.json`. Third-party software and models: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Gesture, face and sound update (not tested)

All ten bundled memes have hand controls. Open **Gestures** for the pose list and to
switch controls on/off. Hold a pose for about 280 ms, then relax before repeating it.
Snap can still play any selected entry in the **Snap plays** dropdown. Raise both palms
to return while vanished. Existing snap/palms preferences are preserved on upgrade;
new installations enable them by default.

Props track your face, including tilt and scale. The cinema jacket is a procedural 2D
overlay positioned from your chin; it is not a body mesh or photorealistic clothing swap.
Face loss removes props rather than leaving glasses floating on another part of the frame.

**Setup ? Meme sounds** controls outgoing sound volume. Enable SnapMeet before Meet
acquires the microphone; after upgrading, reload the extension and rejoin the call.
Sound plays through the outgoing microphone track, not your speakers. Keep the Meet
microphone unmuted to transmit it. The playground currently needs a microphone-bearing
stream for outgoing sound; its video-only preview does not play sounds locally.

Sources and chosen sound variants: [meme implementation notes](docs/MEME_UPDATE.md).
These changes have not been built, typechecked, linted, or tested, at the user's request.
Earlier test results in this repository apply to the previous implementation only.
