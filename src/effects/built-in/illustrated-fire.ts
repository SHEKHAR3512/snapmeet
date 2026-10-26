import { drawAccessory } from '../accessories';
import { fragment } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeOutBack, envelope, ramp } from '../easing';
import type { EffectContext, EffectFrame, EffectStart } from '../types';

/** Original procedural flame illustration: layered noise with a hand-picked palette. */
const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_video;
uniform float u_time;
uniform float u_amount;
uniform float u_intensity;
uniform float u_aspect;

vec3 firePalette(float x) {
  vec3 a = vec3(0.45, 0.04, 0.02);
  vec3 b = vec3(0.95, 0.35, 0.05);
  vec3 c = vec3(1.0, 0.78, 0.25);
  vec3 d = vec3(1.0, 0.97, 0.8);
  return x < 0.4 ? mix(a, b, x / 0.4) : x < 0.75 ? mix(b, c, (x - 0.4) / 0.35) : mix(c, d, (x - 0.75) / 0.25);
}

float flame(float along, float depth, float height, float t, float seed) {
  float n = fbm(vec2(along * 7.0 + seed, depth * 4.0 - t * 2.1));
  float tongues = 0.65 + 0.35 * sin(along * 23.0 + t * 1.3 + seed) * fbm(vec2(along * 3.0, t * 0.4));
  float h = max(0.0001, height * tongues);
  return clamp((h - depth) / h + (n - 0.5) * 0.9, 0.0, 1.0);
}

void main() {
  vec2 uv = img(v_uv);
  vec3 c = texture(u_video, uv).rgb;
  float k = u_amount * u_intensity;
  // warm cast and a smoky top
  c *= mix(vec3(1.0), vec3(1.08, 0.93, 0.78), k);
  c = mix(c, vec3(0.18, 0.13, 0.1), smoothstep(0.35, 0.0, uv.y) * 0.35 * k);
  float bottom = flame(uv.x * u_aspect, 1.0 - uv.y, 0.32 * k, u_time, 0.0);
  float left = flame(uv.y, uv.x * u_aspect, 0.22 * k, u_time, 11.0) * smoothstep(0.0, 0.5, uv.y);
  float right = flame(uv.y, (1.0 - uv.x) * u_aspect, 0.22 * k, u_time, 23.0) * smoothstep(0.0, 0.5, uv.y);
  float f = max(bottom, max(left, right));
  float alpha = smoothstep(0.05, 0.35, f);
  vec3 fire = firePalette(clamp(f * 1.1, 0.0, 1.0));
  // ink outline for an illustrated look
  float edge = smoothstep(0.05, 0.12, f) - smoothstep(0.12, 0.2, f);
  fire = mix(fire, vec3(0.25, 0.05, 0.02), edge * 0.6);
  o = vec4(mix(c, fire, alpha * min(1.0, k * 1.6)), 1.0);
}`);

/** This Is Fine: original procedural flames around the frame plus a calm speech bubble. */
export class IllustratedFireEffect extends ShaderEffect<'illustrated-fire'> {
  private head: [number, number] = [0.5, 0.35];

  constructor(ctx: EffectContext) {
    super('illustrated-fire', ctx, FS);
  }

  protected override onStart(run: EffectStart): void {
    this.head = run.inputs.face?.eyes ?? run.inputs.maskInfo?.head ?? [0.5, 0.35];
  }

  render(f: EffectFrame): void {
    if (f.inputs.face) this.head = f.inputs.face.eyes;
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const amount = envelope(t, D, 700, 700);
    const aspect = this.outAspect(f);
    this.program
      .use()
      .f('u_time', (t / 1000) * (this.reducedMotion ? 0.35 : 1))
      .f('u_amount', amount)
      .f('u_intensity', p.intensity ?? 0.8)
      .f('u_aspect', aspect)
      .tex('u_video', 0, f.inputs.video);
    this.ctx.quad.draw();
    drawAccessory(this.sprites, f, 'hat', amount);

    const pop = this.reducedMotion ? ramp(t, 350, 650) : easeOutBack(ramp(t, 350, 650));
    const alpha = Math.min(ramp(t, 350, 500), 1 - ramp(t, D - 600, D - 200));
    if (alpha > 0 && pop > 0) {
      const bubble = this.sprites.text({
        text: p.caption ?? 'This is fine.',
        font: 'sans',
        weight: 700,
        fill: '#1a1a1a',
        bubble: { fill: '#fffdf5', radiusEm: 0.5, padEm: 0.4 },
      });
      const x = Math.min(0.78, Math.max(0.22, this.head[0] + 0.2));
      const y = Math.min(0.5, Math.max(0.1, this.head[1] - 0.14));
      this.sprites.draw(bubble, { x, y, height: 0.055 * pop, maxWidth: 0.55, alpha, outAspect: aspect });
    }
  }
}
