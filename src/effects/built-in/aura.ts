import { fragment } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeOutBack, easeOutCubic, envelope, ramp } from '../easing';
import type { EffectContext, EffectFrame } from '../types';

const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform sampler2D u_mask;
uniform float u_hasMask;
uniform float u_amount;
uniform float u_time;
uniform float u_hue;
uniform float u_aspect;
uniform float u_motion;
void main() {
  vec2 uv = img(v_uv);
  vec3 c = texture(u_video, uv).rgb;
  float glow;
  float m = 0.0;
  if (u_hasMask > 0.5) {
    m = smoothstep(0.35, 0.7, texture(u_mask, uv).r);
    float dil = 0.0;
    for (int i = 0; i < 16; i++) {
      float a = float(i) / 16.0 * 6.2831853;
      vec2 dir = vec2(cos(a) / u_aspect, sin(a));
      dil = max(dil, texture(u_mask, uv + dir * 0.018).r * 1.0);
      dil = max(dil, texture(u_mask, uv + dir * 0.036).r * 0.75);
      dil = max(dil, texture(u_mask, uv + dir * 0.06).r * 0.45);
    }
    glow = clamp(dil - m, 0.0, 1.0);
  } else {
    vec2 e = abs(uv - 0.5) * 2.0;
    glow = smoothstep(0.7, 1.0, max(e.x, e.y)) * 0.8;
  }
  float flow = fbm(vec2(uv.x * 9.0, uv.y * 6.0 + u_time * 1.4 * u_motion));
  glow *= 0.55 + 0.9 * flow;
  vec3 tint = hsv2rgb(vec3(u_hue / 360.0 + 0.04 * sin(u_time * 1.7 * u_motion), 0.75, 1.0));
  vec3 col = c * mix(1.0, mix(0.72, 1.0, m), u_amount);
  col += tint * glow * 1.5 * u_amount;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`);

/** Aura +N: animated outline glow around the person mask (frame-edge glow without a mask) and a counting score. */
export class AuraEffect extends ShaderEffect<'aura'> {
  constructor(ctx: EffectContext) {
    super('aura', ctx, FS);
  }

  render(f: EffectFrame): void {
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const amount = envelope(t, D, this.reducedMotion ? 700 : 400, 600);
    const hasMask = f.inputs.mask !== null;
    this.program
      .use()
      .f('u_hasMask', hasMask ? 1 : 0)
      .f('u_amount', amount)
      .f('u_time', t / 1000)
      .f('u_hue', p.hue ?? 275)
      .f('u_aspect', f.inputs.width / f.inputs.height)
      .f('u_motion', this.reducedMotion ? 0.3 : 1)
      .tex('u_video', 0, f.inputs.video)
      .tex('u_mask', 1, f.inputs.mask ?? this.ctx.blank);
    this.ctx.quad.draw();

    const target = p.score ?? 9999;
    // Count in ~16 steps to bound the number of text textures.
    const progress = easeOutCubic(ramp(t, 200, 1500));
    const value = Math.round((Math.round(progress * 16) / 16) * target);
    const pop = this.reducedMotion ? 1 : 0.85 + 0.15 * easeOutBack(ramp(t, 1500, 1800));
    const textAlpha = Math.min(ramp(t, 150, 450), 1 - ramp(t, D - 500, D - 100));
    if (textAlpha <= 0) return;
    const hue = p.hue ?? 275;
    const score = this.sprites.text({
      text: `+${value.toLocaleString('en-US')}`,
      font: 'display',
      fill: `hsl(${hue} 90% 72%)`,
      stroke: '#14081f',
      strokeWidth: 12,
      shadow: { color: `hsl(${hue} 100% 60%)`, blur: 22 },
    });
    const label = this.sprites.text({
      text: p.label ?? 'AURA',
      font: 'display',
      fill: '#ffffff',
      stroke: '#14081f',
      strokeWidth: 10,
      letterSpacingEm: 0.08,
    });
    const aspect = this.outAspect(f);
    // Above the head when there is room, otherwise along the bottom of the frame.
    const top = f.inputs.maskInfo?.bbox[1] ?? 0.2;
    const above = top > 0.3;
    const scoreY = above ? top - 0.17 : 0.78;
    this.sprites.draw(score, { x: 0.5, y: scoreY, height: 0.11 * pop, maxWidth: 0.7, alpha: textAlpha, outAspect: aspect });
    this.sprites.draw(label, { x: 0.5, y: scoreY + 0.1, height: 0.05, maxWidth: 0.7, alpha: textAlpha, outAspect: aspect });
  }
}
