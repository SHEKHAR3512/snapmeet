# Meme update ? manual validation pending

No tests, lint, typecheck, build, browser checks, or audio playback were run for this update.
Clip names come from the source listings; exact recordings have not been auditioned.

| Meme | Gesture | Treatment / chosen audio |
| --- | --- | --- |
| Dust Away | Finger snap | Existing person-mask dust dissolve; Thanos snap |
| Absolute Cinema | Two open palms | Your face, tracked suit, monochrome film title; Absolute Cinema soundboard variant |
| Aura +9999 | Victory sign | Person silhouette glow, face-positioned score; Aura phonk |
| Indian Serial Drama | Three fingers | Face-centered repeated zooms and tints; Indian serial drama sting |
| Aayein? | Point up | Your frozen confused face, question marks; Aayein voice |
| Emotional Damage | Closed fist | Face-centered impact zoom, shake and caption; Emotional Damage voice |
| This Is Fine | Open palm, thumb out | Your face, tracked hat, mug and fire; This Is Fine soundboard variant |
| Mission Passed / Respect ++ | Thumbs up | Tilt/scale-tracked descending sunglasses; GTA SA mission complete |
| Main Character | Rock horns | Golden person glow and face-positioned score; Golden Wind meme variant |
| Plot Twist | Four fingers, thumb tucked | Face-centered reveal zooms; Dun dun dun brass sting |

Snap remains assignable to any catalog effect. Open palms while vanished return to camera.
The 280 ms static pose hold and release latch provide an alternative to fast finger snaps;
a camera can miss a snap that occurs between frames, so first-try recognition is not guaranteed.

The suit is a procedural jacket/tie overlay anchored to the face. It has no shoulder or
hand occlusion model, so it may overlap hands held across the torso. Tracking is local.
Meme variants such as Aura, Main Character, and Absolute Cinema have no single audio
version established by this project; selected clips can be replaced at the same asset paths
with the user's preferred recordings, updating the asset lock hashes afterward.

## Useful repositories

- https://github.com/google-ai-edge/mediapipe ? the existing runtime plus the newly bundled
  Face Landmarker model; landmarks drive eye position, chin, forehead, scale and roll.
- https://github.com/andypotato/fingerpose ? useful reference for rotation-independent
  finger curl/direction classification. No source copied or extra TensorFlow runtime added.
- https://github.com/kinivi/hand-gesture-recognition-mediapipe ? useful future route for
  collecting labeled user gesture samples and training a classifier. Not integrated.
- https://github.com/sodiqjon-maxammadjonov/soundboard ? source mirror for Aayein,
  Golden Wind, and the brass reveal sound. Only audio assets downloaded; no code executed.

## Implementation notes

Hand inference is submitted ahead of segmentation, at up to roughly 30 Hz regardless of
render quality, with no queued frame backlog per model. Segmentation and face tracking
run at up to 10 Hz. Late results are discarded after camera/config/reset changes.
Snap release keeps the peak release speed while waiting for the middle finger to curl.
Static gestures use palm-normalized joint extension rather than vertical screen positions.

Only local video elements displaying known SnapMeet tracks get a CSS mirror correction;
remote video and outgoing pixels are not flipped. This still needs verification against
Meet's current self-view DOM and browser behavior.

The Web Audio mixer wraps both combined camera/microphone and microphone-only requests.
Track enable, stop, source ending, constraints, and cloning are forwarded to preserve Meet
mute and device behavior. Clips stop on reset/end/disable. No microphone audio is routed
into local speakers. Browser audio activation and actual Meet receiver sound need manual
validation. See `public/audio/sources.json` for all ten sources and hashes.
