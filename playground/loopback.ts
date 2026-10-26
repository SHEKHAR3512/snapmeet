/**
 * Local RTCPeerConnection pair. Proves the processed track is encodable/transmittable by
 * WebRTC and reports what the receiver decodes. It is not a substitute for a real Meet
 * call (different SFU, simulcast and constraints handling).
 */
export interface LoopbackStats {
  width: number;
  height: number;
  fps: number;
  framesDecoded: number;
}

export interface Loopback {
  close(): void;
}

export async function startLoopback(
  track: MediaStreamTrack,
  onRemote: (s: MediaStream) => void,
  onStats: (s: LoopbackStats) => void,
): Promise<Loopback> {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && void b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && void a.addIceCandidate(e.candidate);
  b.ontrack = (e) => onRemote(e.streams[0] ?? new MediaStream([e.track]));
  a.addTrack(track, new MediaStream([track]));
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription!);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription!);

  const timer = setInterval(async () => {
    const report = await b.getStats();
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        onStats({
          width: s.frameWidth ?? 0,
          height: s.frameHeight ?? 0,
          fps: Math.round(s.framesPerSecond ?? 0),
          framesDecoded: s.framesDecoded ?? 0,
        });
      }
    });
  }, 1000);

  return {
    close() {
      clearInterval(timer);
      a.close();
      b.close();
    },
  };
}
