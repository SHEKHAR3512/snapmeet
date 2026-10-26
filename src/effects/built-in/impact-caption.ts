import { fragment } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeOutCubic, envelope, ramp } from '../easing';
import type { EffectContext, EffectFrame } from '../types';

const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_amount;
uniform vec3 u_tint;
void main() {
  vec2 uv = img(v_uv);
  vec2 s = 0.5 + (uv - 0.5) / u_zoom + u_offset;
  vec3 c = texture(u_video, clamp(s, 0.0, 1.0)).rgb;
  float l = luma(c);
  c = mix(c, mix(vec3(l), c, 0.7) * 1.08, u_amount);
  float d = distance(uv, vec2(0.5));
  float v = smoothstep(0.35, 0.85, d);
  c = mix(c, c * 0.35 + u_tint * 0.45, v * 0.75 * u_amount);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`);

/** Emotional Damage: restrained decaying shake, punch-in, tinted vignette and a slam-in caption. */
export class ImpactCaptionEffect extends ShaderEffect<'impact-caption'> {
  constructor(ctx: EffectContext) {
    super('impact-caption', ctx, FS);
  }

  render(f: EffectFrame): void {
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const amount = envelope(t, D, 120, 400);
    let ox = 0;
    let oy = 0;
    let zoom: number;
    if (this.reducedMotion) {
      zoom = 1 + 0.05 * amount;
    } else {
      // Max ~1.6% of the frame, decaying within ~1 s — a jolt, not a strobe.
      const amp = (p.shake ?? 0.6) * 0.016 * Math.exp(-t / 330) * amount;
      ox = Math.sin(t * 0.083 + this.seed) * amp;
      oy = Math.cos(t * 0.067 + this.seed * 0.5) * amp;
      zoom = 1 + 0.12 * easeOutCubic(ramp(t, 0, 220)) * amount;
    }
    const hue = (p.hue ?? 0) / 360;
    const tint = hslToRgb(hue, 0.85, 0.42);
    this.program
      .use()
      .f('u_offset', ox, oy)
      .f('u_zoom', zoom)
      .f('u_amount', amount)
      .f('u_tint', tint[0], tint[1], tint[2])
      .tex('u_video', 0, f.inputs.video);
    this.ctx.quad.draw();

    const appear = this.reducedMotion ? easeOutCubic(ramp(t, 0, 350)) : easeOutCubic(ramp(t, 60, 240));
    const alpha = Math.min(appear, 1 - ramp(t, D - 380, D - 60));
    if (alpha > 0) {
      const scale = this.reducedMotion ? 1 : 1.7 - 0.7 * appear;
      const sprite = this.sprites.text({
        text: p.caption ?? 'EMOTIONAL DAMAGE',
        font: 'display',
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 14,
        letterSpacingEm: 0.02,
      });
      this.sprites.draw(sprite, {
        x: 0.5,
        y: 0.8,
        height: 0.095 * scale,
        maxWidth: 0.92 * scale,
        rotation: this.reducedMotion ? 0 : -0.035,
        alpha,
        outAspect: this.outAspect(f),
      });
    }
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
