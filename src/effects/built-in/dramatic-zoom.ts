import { fragment } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeInOutCubic, easeOutCubic, ramp } from '../easing';
import type { EffectContext, EffectFrame, EffectStart } from '../types';

const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform vec2 u_center;
uniform float u_zoom;
uniform vec3 u_tint;
uniform float u_tintAmount;
uniform float u_vignette;
void main() {
  vec2 uv = img(v_uv);
  vec2 s = u_center + (uv - 0.5) / u_zoom;
  vec3 c = texture(u_video, s).rgb;
  float l = luma(c);
  c = mix(c, vec3(l) * u_tint * 1.25, u_tintAmount);
  float d = distance(uv, vec2(0.5));
  c *= mix(1.0, smoothstep(0.9, 0.35, d), u_vignette);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`);

const TINTS: Array<[number, number, number]> = [
  [1.0, 0.45, 0.4],
  [0.45, 0.6, 1.0],
  [1.0, 0.82, 0.45],
];
const PUNCH_GAP = 560;
const PUNCH_MS = 140;

/** Indian Serial Drama: up to three zoom punches toward the face with soft tinted shock frames. */
export class DramaticZoomEffect extends ShaderEffect<'dramatic-zoom'> {
  private focus: [number, number] = [0.5, 0.4];

  constructor(ctx: EffectContext) {
    super('dramatic-zoom', ctx, FS);
  }

  protected override onStart(run: EffectStart): void {
    this.focus = run.inputs.face?.eyes ?? run.inputs.maskInfo?.head ?? [0.5, 0.4];
  }

  render(f: EffectFrame): void {
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const punches = this.reducedMotion ? 1 : (p.punches ?? 3);
    const maxZoom = p.maxZoom ?? 1.45;
    const outStart = D - 550;

    let zoom = 1;
    let tintAmount = 0;
    let tintIndex = 0;
    if (this.reducedMotion) {
      zoom = 1 + (maxZoom - 1) * 0.4 * easeInOutCubic(ramp(t, 0, 1200));
    } else {
      for (let k = 0; k < punches; k++) {
        const start = k * PUNCH_GAP;
        if (t < start) break;
        const from = 1 + ((maxZoom - 1) * k) / punches;
        const to = 1 + ((maxZoom - 1) * (k + 1)) / punches;
        zoom = from + (to - from) * easeOutCubic(ramp(t, start, start + PUNCH_MS));
        // Soft tint that decays over 420 ms — at most ~1.8 changes/s, never a strobe.
        const decay = 1 - ramp(t, start, start + 420);
        if (p.tint !== false && decay > 0) {
          tintAmount = 0.42 * decay;
          tintIndex = k % TINTS.length;
        }
      }
    }
    const out = easeInOutCubic(ramp(t, outStart, D));
    zoom = zoom + (1 - zoom) * out;

    if (f.inputs.face) this.focus = f.inputs.face.eyes;
    const [fx, fy] = this.focus;
    const half = 0.5 / zoom;
    const cx = Math.min(1 - half, Math.max(half, fx));
    const cy = Math.min(1 - half, Math.max(half, fy));
    const tint = TINTS[tintIndex]!;
    this.program
      .use()
      .f('u_center', cx, cy)
      .f('u_zoom', zoom)
      .f('u_tint', tint[0], tint[1], tint[2])
      .f('u_tintAmount', tintAmount)
      .f('u_vignette', 0.45 * (1 - out))
      .tex('u_video', 0, f.inputs.video);
    this.ctx.quad.draw();

    const captionStart = this.reducedMotion ? 600 : (punches - 1) * PUNCH_GAP + 250;
    const alpha = Math.min(ramp(t, captionStart, captionStart + 250), 1 - ramp(t, outStart, outStart + 300));
    if (alpha > 0) {
      const sprite = this.sprites.text({
        text: p.caption ?? 'Yeh kya ho gaya?!',
        font: 'display',
        fill: '#fff4e0',
        stroke: '#2a0606',
        strokeWidth: 12,
        shadow: { color: 'rgba(0,0,0,0.7)', blur: 16 },
      });
      this.sprites.draw(sprite, { x: 0.5, y: 0.85, height: 0.08, maxWidth: 0.9, alpha, outAspect: this.outAspect(f) });
    }
  }
}
