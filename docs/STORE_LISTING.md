# Chrome Web Store materials (draft — not submitted)

Nothing has been published. Publishing needs a Chrome Web Store developer account, a
public privacy-policy URL (host `docs/PRIVACY.md`), review of the model licence terms, and
real-Meet validation first (see TASKS.md).

**Name:** SnapMeet — meme effects for your Meet camera

**Short description (≤132 chars):**
Snap and dissolve into dust, go Absolute Cinema, flex your aura — live effects on your own Meet camera, processed on your device.

**Category:** Fun / Communication

**Description:**
SnapMeet adds playful, real-time effects to the video you send in Google Meet. Other
participants see them without installing anything.

• Dust Away — dissolve into dust while your room stays behind. Reappear on cue.
• Absolute Cinema, Aura +9999, Indian Serial Drama, Aayein?, Emotional Damage,
  This Is Fine, Mission Passed — and more via collections.
• Trigger with a click, a keyboard shortcut, or (experimental) a finger snap.
• Empty-room capture or virtual backgrounds; reduced-motion mode; quality controls.

Private by design: video is processed locally with WebGL and on-device models. Nothing is
recorded or uploaded, there are no accounts and no analytics. Your microphone and screen
sharing are untouched.

Note: turn SnapMeet on before joining, or toggle your camera once after enabling it.

**Single purpose:** Apply visual effects to the user's own outgoing Google Meet camera video.

**Permission justifications:**
* Host `meet.google.com` — run only on Google Meet to process the user's camera stream.
* `storage` — save preferences and imported effect collections.
* `scripting` — load the bundled vision runtime into the Meet tab if its worker cannot start.
* `alarms` — at most daily check of an optional, user-configured effect collection URL.
* Optional host access — requested per site only when the user sets a remote collection.

**Remote code:** none. All JavaScript and WASM are in the package. Remote collections are
JSON data validated against a fixed schema.

**Data disclosure:** No user data collected or transmitted.

**Screenshots to capture (1280×800):** dock with effect grid over a Meet call; Dust Away
mid-dissolve as seen by the other participant; Setup tab; playground with loopback.
Use only people who consented to appear.
