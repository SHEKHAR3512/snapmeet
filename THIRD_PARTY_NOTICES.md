# Third-party notices

SnapMeet bundles the following third-party software and models. Everything else in the
extension (effect visuals, virtual backgrounds, icons, captions, CSS previews) is original
work created for SnapMeet and rendered procedurally; no film footage, celebrity likeness,
brand logos, brand fonts or soundtracks are included.

## Software (bundled into the extension)

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| @mediapipe/tasks-vision (JS + `vision_wasm_internal.{js,wasm}`) | 1.1.1 | Apache-2.0 (declared in package.json; the npm package ships no LICENSE file) | Person segmentation, hand landmarks |
| react, react-dom | 19.3.1 | MIT | Control dock, popup, options, playground UI |
| scheduler | 0.28.0 | MIT | React dependency |
| zod | 4.6.7 | MIT | Settings, catalog and bridge validation |

Copyright notices:

* MediaPipe — Copyright The MediaPipe Authors. Licensed under the Apache License, Version 2.0
  (https://www.apache.org/licenses/LICENSE-2.0).
* React — Copyright (c) Meta Platforms, Inc. and affiliates. MIT License.
* Zod — Copyright (c) 2025 Colin McDonnell. MIT License.

## Models (bundled, unmodified)

| File | Source | SHA-256 | Licence |
| --- | --- | --- | --- |
| `models/selfie_segmenter_landscape.tflite` | storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/ (retrieved 2026-10-26) | `490e9ea7…6b8e` | Apache-2.0 per the MediaPipe models documentation — **re-confirm the model card terms before public store distribution** |
| `models/hand_landmarker.task` | storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/ (retrieved 2026-10-26) | `fbc2a300…cde1` | Apache-2.0 per the MediaPipe models documentation — **re-confirm before public distribution** |

Full hashes: `scripts/assets.lock.json` (verified on every build).

## Development-only tools (not shipped)

TypeScript, Vite, @vitejs/plugin-react, Vitest, Playwright, ESLint, typescript-eslint,
jsdom, @types/* — used to build and test; not included in `dist/`.
