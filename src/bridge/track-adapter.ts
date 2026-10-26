import type { VideoPipeline } from '../engine/pipeline';

/**
 * Narrow adapters that make the processed track behave like the camera track Meet asked
 * for. They forward to the real source track (real device id, label, capabilities and
 * constraints) rather than inventing metadata; width/height report what is actually
 * transmitted. Which of these Meet actually relies on is recorded in docs/FEASIBILITY.md.
 */
const proto = MediaStreamTrack.prototype;
const nativeStop = proto.stop;
const nativeClone = proto.clone;
const nativeGetSettings = proto.getSettings;
const enabledDesc = Object.getOwnPropertyDescriptor(proto, 'enabled')!;

export interface AdapterHooks {
  released(p: VideoPipeline): void;
  enabledChanged(p: VideoPipeline): void;
}

function define(obj: object, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, configurable: true, writable: true });
}

export function adoptOutputTrack(track: MediaStreamTrack, p: VideoPipeline, hooks: AdapterHooks): MediaStreamTrack {
  const src = p.source;
  p.consumers.add(track);

  define(track, 'stop', function stop(this: MediaStreamTrack) {
    nativeStop.call(this);
    if (p.consumers.delete(this) && p.consumers.size === 0) hooks.released(p);
  });
  define(track, 'clone', function clone(this: MediaStreamTrack) {
    const c = nativeClone.call(this);
    // A clone of an ended track is ended too; it is never a consumer.
    if (this.readyState === 'live' && p.state !== 'stopped') adoptOutputTrack(c, p, hooks);
    return c;
  });
  define(track, 'getSettings', function getSettings(this: MediaStreamTrack): MediaTrackSettings {
    const own = nativeGetSettings.call(this);
    const real = src.readyState === 'live' ? src.getSettings() : {};
    return {
      ...real,
      width: p.outWidth,
      height: p.outHeight,
      aspectRatio: p.outWidth / p.outHeight,
      frameRate: real.frameRate ?? own.frameRate,
    };
  });
  define(track, 'getCapabilities', () => (src.getCapabilities ? src.getCapabilities() : {}));
  define(track, 'getConstraints', () => src.getConstraints());
  define(track, 'applyConstraints', (c?: MediaTrackConstraints) => src.applyConstraints(c));
  Object.defineProperty(track, 'label', { get: () => src.label, configurable: true });
  Object.defineProperty(track, 'enabled', {
    configurable: true,
    get(this: MediaStreamTrack) {
      return enabledDesc.get!.call(this) as boolean;
    },
    set(this: MediaStreamTrack, v: boolean) {
      enabledDesc.set!.call(this, v);
      hooks.enabledChanged(p);
    },
  });
  return track;
}

/** Stream-level clone must go through the adapted track clone so ownership is tracked. */
export function adoptStream(stream: MediaStream): MediaStream {
  define(stream, 'clone', function clone(this: MediaStream) {
    return new MediaStream(this.getTracks().map((t) => t.clone()));
  });
  return stream;
}

/** Physical camera ended (unplugged / permission revoked): end every consumer like a native track. */
export function endConsumers(p: VideoPipeline): void {
  for (const t of [...p.consumers]) {
    nativeStop.call(t);
    t.dispatchEvent(new Event('ended'));
  }
  p.consumers.clear();
}
