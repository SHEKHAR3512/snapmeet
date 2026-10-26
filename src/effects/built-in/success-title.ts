import { fragment } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeOutCubic, envelope, ramp } from '../easing';
import type { EffectContext, EffectFrame } from '../types';

const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform float u_amount;
void main() {
  vec2 uv = img(v_uv);
  vec3 c = texture(u_video, uv).rgb;
  vec3 graded = mix(vec3(luma(c)), c, 0.7) * vec3(1.06, 1.0, 0.9);
  float band = 1.0 - smoothstep(0.0, 0.22, abs(uv.y - 0.47));
  graded *= 1.0 - band * 0.25;
  float d = distance(uv, vec2(0.5));
  graded *= smoothstep(1.0, 0.35, d) * 0.35 + 0.65;
  o = vec4(mix(c, graded, u_amount), 1.0);
}`);

/** Mission Passed: original game-inspired success title (no brand fonts or logos). */
export class SuccessTitleEffect extends ShaderEffect<'success-title'> {
  constructor(ctx: EffectContext) {
    super('success-title', ctx, FS);
  }

  render(f: EffectFrame): void {
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const amount = envelope(t, D, 400, 500);
    this.program.use().f('u_amount', amount).tex('u_video', 0, f.inputs.video);
    this.ctx.quad.draw();

    const aspect = this.outAspect(f);
    const fadeOut = 1 - ramp(t, D - 500, D - 100);
    const titleIn = easeOutCubic(ramp(t, 150, 500));
    if (titleIn > 0) {
      const title = this.sprites.text({
        text: p.title ?? 'MISSION PASSED',
        font: 'display',
        fill: '#f6b23c',
        stroke: '#000000',
        strokeWidth: 12,
        letterSpacingEm: 0.03,
        shadow: { color: 'rgba(0,0,0,0.6)', blur: 10 },
      });
      const scale = this.reducedMotion ? 1 : 1.25 - 0.25 * titleIn;
      this.sprites.draw(title, {
        x: 0.5,
        y: 0.43,
        height: 0.1 * scale,
        maxWidth: 0.9,
        alpha: Math.min(titleIn, fadeOut),
        outAspect: aspect,
      });
    }
    const subIn = easeOutCubic(ramp(t, 750, 1050));
    if (subIn > 0) {
      const sub = this.sprites.text({
        text: p.subtitle ?? 'RESPECT +',
        font: 'display',
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 10,
        letterSpacingEm: 0.05,
      });
      this.sprites.draw(sub, { x: 0.5, y: 0.56, height: 0.06, maxWidth: 0.8, alpha: Math.min(subIn, fadeOut), outAspect: aspect });
    }
  }
}
