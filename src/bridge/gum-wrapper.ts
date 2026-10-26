import type { Engine } from '../engine/engine';

const WRAPPED = Symbol.for('snapmeet.gum.wrapped');
/** How long a camera request may wait for the controller's settings before failing open. */
export const CONFIG_WAIT_MS = 1500;

/**
 * Wraps MediaDevices.prototype.getUserMedia (idempotent).
 *  - audio-only requests: locally mixed with meme sounds when enabled;
 *  - video requests while disabled: passed through, but noted for reacquire guidance;
 *  - video requests while enabled: the real camera is acquired once with the page's
 *    original constraints (native errors propagate unchanged) and a processed stream
 *    with locally mixed audio is returned.
 * getDisplayMedia is never touched.
 */
export function installGetUserMediaWrapper(engine: Engine): boolean {
  if (typeof MediaDevices === 'undefined') return false;
  const proto = MediaDevices.prototype as MediaDevices & { [WRAPPED]?: boolean };
  if (proto[WRAPPED]) return false;
  const original = proto.getUserMedia;
  if (typeof original !== 'function') return false;

  const getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints): Promise<MediaStream> {
    if (!constraints || (!constraints.video && !constraints.audio)) return original.call(this, constraints);
    await engine.whenConfigured(CONFIG_WAIT_MS);
    const real = await original.call(this, constraints);
    if (!engine.settings.enabled) {
      engine.notePassthrough(real);
      return real;
    }
    try {
      const processed = constraints.video ? engine.attachStream(real) : real;
      try { return await engine.audio.attach(processed); } catch (error) {
        console.warn('[SnapMeet] Audio mixer unavailable; using microphone directly.', error);
        return processed;
      }
    } catch (e) {
      // Fail open before any effect is active: the user expects their camera here.
      console.warn('[SnapMeet] could not attach the video pipeline; using the camera directly.', e);
      engine.notePassthrough(real);
      return real;
    }
  };
  Object.defineProperty(getUserMedia, 'name', { value: 'getUserMedia' });
  Object.defineProperty(proto, 'getUserMedia', { value: getUserMedia, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(proto, WRAPPED, { value: true });
  return true;
}
