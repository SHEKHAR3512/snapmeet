import type { Engine } from '../engine/engine';

/** Attach the mixer to actual microphone senders, including microphones acquired before
 * SnapMeet was enabled. Screen-share audio (displaySurface) is never touched. */
export function installMeetAudioRouting(engine: Engine): void {
  if (typeof RTCPeerConnection === 'undefined') return;
  const peers = new Set<RTCPeerConnection>();
  const pending = new WeakSet<RTCRtpSender>();
  const retryAt = new WeakMap<RTCRtpSender, number>();
  const proto = RTCPeerConnection.prototype;
  const addTrack = proto.addTrack;
  const addTransceiver = proto.addTransceiver;
  const remember = (pc: RTCPeerConnection) => {
    peers.add(pc);
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'closed') peers.delete(pc); });
  };
  proto.addTrack = function(track: MediaStreamTrack, ...streams: MediaStream[]) {
    remember(this);
    return addTrack.call(this, track, ...streams);
  };
  proto.addTransceiver = function(trackOrKind: MediaStreamTrack | string, init?: RTCRtpTransceiverInit) {
    remember(this);
    return addTransceiver.call(this, trackOrKind, init);
  };
  const timer = setInterval(() => {
    if (!engine.settings.enabled) return;
    for (const pc of peers) {
      if (pc.connectionState === 'closed') { peers.delete(pc); continue; }
      for (const sender of pc.getSenders()) {
        const track = sender.track;
        if (!track || track.kind !== 'audio' || track.readyState !== 'live' || engine.audio.owns(track) || pending.has(sender)) continue;
        // Physical microphone tracks expose a device ID. Display/tab capture does not.
        const settings = track.getSettings();
        if (!settings.deviceId || settings.displaySurface || performance.now() < (retryAt.get(sender) ?? 0)) continue;
        pending.add(sender);
        void engine.audio.attach(new MediaStream([track])).then(async stream => {
          if (sender.track !== track || pc.connectionState === 'closed') return;
          await sender.replaceTrack(stream.getAudioTracks()[0]!);
        }).catch(error => {
          retryAt.set(sender, performance.now() + 3000);
          console.warn('[SnapMeet] Microphone routing:', error);
        }).finally(() => pending.delete(sender));
      }
    }
  }, 750);
  window.addEventListener('pagehide', () => { clearInterval(timer); peers.clear(); }, { once: true });
}
