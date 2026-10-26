import { fragment, type RenderTarget } from '../../engine/gl';
import { ShaderEffect } from '../base';
import { easeOutBack, ramp } from '../easing';
import type { EffectContext, EffectFrame, EffectStart } from '../types';

const FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_frozen;
uniform sampler2D u_video;
uniform float u_live;
uniform float u_zoom;
uniform float u_desat;
void main() {
  vec2 uv = img(v_uv);
  vec2 s = 0.5 + (uv - 0.5) / u_zoom;
  vec3 frozen = texture(u_frozen, s).rgb;
  frozen = mix(frozen, vec3(luma(frozen)), u_desat) * vec3(1.02, 1.0, 1.06);
  vec3 live = texture(u_video, uv).rgb;
  o = vec4(mix(frozen, live, u_live), 1.0);
}`);

/** Aayein?: freeze frame, bobbing question marks around the head, confused caption. */
export class ConfusedFreezeEffect extends ShaderEffect<'confused-freeze'> {
  private frozen: RenderTarget | null = null;
  private head: [number, number] = [0.5, 0.35];

  constructor(ctx: EffectContext) {
    super('confused-freeze', ctx, FS);
  }

  protected override onStart(run: EffectStart): void {
    const { width, height } = run.inputs;
    this.frozen ??= this.ctx.createTarget(width, height);
    this.frozen.resize(width, height);
    this.frozen.bind();
    this.ctx.copy(run.inputs.video);
    this.ctx.bindScene();
    this.head = run.inputs.maskInfo?.head ?? [0.5, 0.35];
  }

  render(f: EffectFrame): void {
    const p = this.def.parameters;
    const D = this.durationOf(f);
    const t = f.elapsed;
    const live = ramp(t, D - 350, D);
    const zoom = this.reducedMotion ? 1.02 : 1 + 0.06 * ramp(t, 0, D);
    this.program
      .use()
      .f('u_live', live)
      .f('u_zoom', zoom)
      .f('u_desat', 0.3)
      .tex('u_frozen', 0, this.frozen?.tex ?? f.inputs.video)
      .tex('u_video', 1, f.inputs.video);
    this.ctx.quad.draw();

    const aspect = this.outAspect(f);
    const fade = 1 - live;
    const count = p.questionMarks ?? 5;
    const q = this.sprites.text({
      text: '?',
      font: 'display',
      fill: '#ffd84d',
      stroke: '#1b1300',
      strokeWidth: 12,
    });
    const [hx, hy] = this.head;
    for (let i = 0; i < count; i++) {
      const appear = 120 + i * 110;
      const s = easeOutBack(ramp(t, appear, appear + 260));
      if (s <= 0) continue;
      const angle = -Math.PI * 0.95 + (Math.PI * 0.9 * i) / Math.max(1, count - 1);
      const radius = 0.2 + 0.03 * (i % 2);
      const bob = this.reducedMotion ? 0 : Math.sin(t / 260 + i * 1.7) * 0.012;
      const x = Math.min(0.95, Math.max(0.05, hx + (Math.cos(angle) * radius) / aspect));
      const y = Math.min(0.9, Math.max(0.08, hy + Math.sin(angle) * radius * 0.8 + bob));
      const rot = this.reducedMotion ? 0 : Math.sin(t / 400 + i) * 0.18;
      this.sprites.draw(q, { x, y, height: 0.08 * s * (i % 2 ? 0.8 : 1), rotation: rot, alpha: fade, outAspect: aspect });
    }

    const capAlpha = Math.min(ramp(t, 300, 550), fade);
    if (capAlpha > 0) {
      const caption = this.sprites.text({
        text: p.caption ?? 'Aayein?',
        font: 'sans',
        weight: 800,
        fill: '#111111',
        bubble: { fill: '#ffffff', radiusEm: 0.45, padEm: 0.35 },
      });
      this.sprites.draw(caption, { x: 0.5, y: 0.84, height: 0.06, maxWidth: 0.8, alpha: capAlpha, outAspect: aspect });
    }
  }

  override dispose(): void {
    this.frozen?.dispose();
    this.frozen = null;
    super.dispose();
  }
}
