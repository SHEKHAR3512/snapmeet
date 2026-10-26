import type { Engine } from '../engine/engine';

/** Correct only local SnapMeet previews. Transmitted pixels remain unmirrored. */
export function installSelfViewCorrection(engine: Engine): void {
  const patched = new Map<HTMLVideoElement, { value: string; priority: string }>();
  const restore = (video: HTMLVideoElement) => {
    const old = patched.get(video);
    if (!old) return;
    if (old.value) video.style.setProperty('scale', old.value, old.priority);
    else video.style.removeProperty('scale');
    patched.delete(video);
  };
  const update = () => {
    const local = new Set<string>();
    if (engine.settings.enabled) for (const pipeline of engine.pipelines) {
      local.add(pipeline.output.track.id);
      for (const track of pipeline.consumers) local.add(track.id);
    }
    for (const video of patched.keys()) {
      const stream = video.srcObject;
      if (!video.isConnected || !(stream instanceof MediaStream) || !stream.getVideoTracks().some(t => local.has(t.id))) restore(video);
    }
    for (const video of document.querySelectorAll('video')) {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream) || !stream.getVideoTracks().some(t => local.has(t.id))) continue;
      // Temporarily restore our scale before measuring Meet's own transform chain.
      restore(video);
      let flip = 1;
      for (let el: Element | null = video; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (style.transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(style.transform);
          if (matrix.a < 0) flip *= -1;
        }
        if (parseFloat(style.scale) < 0) flip *= -1;
      }
      if (flip < 0) {
        patched.set(video, { value: video.style.getPropertyValue('scale'), priority: video.style.getPropertyPriority('scale') });
        const scale = getComputedStyle(video).scale.split(/\s+/).map(Number);
        const x = Number.isFinite(scale[0]) ? scale[0]! : 1;
        const y = Number.isFinite(scale[1]) ? scale[1]! : x;
        video.style.setProperty('scale', `${-x} ${y}`, 'important');
      }
    }
  };
  const timer = setInterval(update, 500);
  window.addEventListener('pagehide', () => { clearInterval(timer); for (const v of patched.keys()) restore(v); }, { once: true });
}
