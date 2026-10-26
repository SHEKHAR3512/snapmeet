# SnapMeet privacy policy

Last updated: 2026-10-26

## What SnapMeet does with your camera

SnapMeet only acts when you turn it on. When Google Meet asks for your camera, SnapMeet
processes the frames **inside your browser tab** (WebGL and a local MediaPipe model) and
hands the processed video to Meet, which sends it to the call like any camera.

* Camera frames are **not recorded, uploaded or stored** by SnapMeet.
* Your microphone audio is passed to Meet unchanged; SnapMeet does not read it.
* Screen sharing is not touched.
* An empty-room capture or custom background image is held **in memory for that Meet tab
  only** and discarded when the tab closes. It is never written to disk by SnapMeet.
* Opening the popup, settings or playground never turns on your camera. The playground
  asks for the camera only when you press **Start camera**.

## What is stored

`chrome.storage.local` on your device holds your preferences (on/off, quality, favourites,
gesture settings), any effect collections you import, and, if you configure one, the URL
and last-check result of a remote collection. Gesture trial results in the playground are
stored in that page's local storage only.

## Network activity

* All code, the WASM runtime and the models are bundled. The automated test suite records
  every request made by the Meet page context with SnapMeet active and finds only the Meet
  origin and the extension's own packaged files.
* The only network request SnapMeet itself can make is the **optional** remote collection
  refresh, which you must configure (and grant permission for that site). It downloads a
  JSON file at most once a day, without cookies, and sends no camera, audio, meeting or
  personal data.
* Meet itself transmits your (processed) video to the other participants, as usual.

## Diagnostics and analytics

There are no analytics and no accounts. The diagnostics panel shows resolutions, frame
rates, timings and error messages; it does not include video, meeting codes, participant
names or device identifiers, and it never leaves your device.

## Permissions

* `https://meet.google.com/*` — to run on Meet only.
* `storage` — preferences and imported collections.
* `scripting` — to load the local vision runtime into the Meet tab when its worker cannot start.
* `alarms` — the at-most-daily optional collection check.
* Optional `https://*/*` — requested per site, only if you set a remote collection URL.

## Contact

Report issues to the maintainers of this repository.
