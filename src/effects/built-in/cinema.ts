import { drawAccessory } from '../accessories';
import { fragment } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeOutCubic, envelope, ramp } from '../easing';
import type { EffectContext, EffectFrame } from '../types';

const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform float u_mono;
uniform float u_bars;
uniform float u_grain;
uniform float u_frame;
uniform vec2 u_res;
void main() {
  vec2 uv = img(v_uv);
  vec3 c = texture(u_video, uv).rgb;
  float l = smoothstep(0.03, 0.97, luma(c));
  vec3 col = mix(c, vec3(pow(l, 1.08)), u_mono);
  float g = hash12(floor(uv * u_res * 0.5) + u_frame * 17.13) - 0.5;
  col += g * u_grain * u_mono;
  float d = distance(uv, vec2(0.5));
  col *= mix(1.0, smoothstep(0.95, 0.3, d), 0.55 * u_mono);
  if (uv.y < u_bars || uv.y > 1.0 - u_bars) col = vec3(0.0);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`);

/** Absolute Cinema: monochrome grade, animated letterbox, film grain, serif title card. */
export class CinemaEffect extends ShaderEffect<'cinema'> {
  constructor(ctx: EffectContext) {
    super('cinema', ctx, FS);
  }

  render(f: EffectFrame): void {
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const inMs = this.reducedMotion ? 400 : 120;
    const env = envelope(t, D, inMs, 600);
    const bars = (p.barSize ?? 0.12) * easeOutCubic(env);
    // Grain re-seeds at 12 fps (static under reduced motion).
    const grainFrame = this.reducedMotion ? 0 : Math.floor(t / 83);
    this.program
      .use()
      .f('u_mono', env)
      .f('u_bars', bars)
      .f('u_grain', p.grain ?? 0.18)
      .f('u_frame', grainFrame)
      .f('u_res', f.inputs.width, f.inputs.height)
      .tex('u_video', 0, f.inputs.video);
    this.ctx.quad.draw();
    drawAccessory(this.sprites, f, 'suit', env);

    const titleAlpha = Math.min(ramp(t, 80, 220), 1 - ramp(t, D - 450, D));
    const title = p.title ?? 'ABSOLUTE CINEMA';
    const lines = title === 'ABSOLUTE CINEMA' ? ['ABSOLUTE', 'CINEMA'] : [title];
    lines.forEach((line, index) => {
      const sprite = this.sprites.text({ text: line, font: 'sans', weight: 900,
        fill: '#ffffff', stroke: '#111111', strokeWidth: 2,
        shadow: { color: 'rgba(0,0,0,0.8)', blur: 8 },
      });
      this.sprites.draw(sprite, { x: 0.5, y: lines.length === 1 ? 0.82 : 0.75 + index * 0.115,
        height: 0.11, maxWidth: 0.84, alpha: titleAlpha, outAspect: this.outAspect(f) });
    });
  }
}
