import { GLSL_COMMON, FULLSCREEN_VS, createProgram, fragment, type Program, type RenderTarget } from '../../engine/gl';
import { REAPPEAR_MS } from '../../session/session';
import type { Quality } from '../../shared/settings';
import type { DefinitionOf } from '../base';
import { clamp01, ramp } from '../easing';
import type { EffectContext, EffectFrame, EffectRenderer, EffectStart } from '../types';

/**
 * Dust Away.
 *
 * At trigger time the foreground (camera frame + person mask) is frozen into textures —
 * a short, documented artistic freeze. A seeded noise field decides when each pixel
 * releases; released pixels vanish from the composite and continue as GPU point
 * particles whose positions are computed analytically in the vertex shader (no
 * per-particle CPU state, no DOM). The background beneath is the captured empty room or
 * a virtual background; while VANISHED the live camera is never sampled.
 */
const RELEASE_GLSL = `
uniform float u_seed;
uniform float u_drift;
float releaseAt(vec2 uv) {
  float n = fbm(uv * vec2(6.0, 4.5) + vec2(u_seed * 0.0013, u_seed * 0.0007));
  float side = u_drift >= 0.0 ? 1.0 - uv.x : uv.x;
  return clamp((0.58 * n + 0.3 * side + 0.12 * uv.y - 0.08) / 0.84, 0.0, 1.0);
}`;

const COMPOSITE_FS = fragment(`
${RELEASE_GLSL}
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_bg;
uniform sampler2D u_fg;
uniform sampler2D u_fgMask;
uniform sampler2D u_live;
uniform float u_hasMask;
uniform float u_hasBg;
uniform float u_progress;
uniform float u_reverse;
uniform float u_ashTint;
uniform float u_toLive;
void main() {
  vec2 uv = img(v_uv);
  vec3 bg = u_hasBg > 0.5 ? texture(u_bg, uv).rgb : vec3(0.12, 0.13, 0.14);
  vec3 fg = texture(u_fg, uv).rgb;
  float m = u_hasMask > 0.5 ? smoothstep(0.35, 0.7, texture(u_fgMask, uv).r) : 1.0;
  float r = releaseAt(uv);
  float vis;
  float edge;
  if (u_reverse < 0.5) {
    vis = smoothstep(u_progress - 0.012, u_progress + 0.012, r);
    edge = vis * (1.0 - smoothstep(0.0, 0.06, r - u_progress));
  } else {
    vis = 1.0 - smoothstep(u_progress - 0.012, u_progress + 0.012, r);
    edge = vis * (1.0 - smoothstep(0.0, 0.06, u_progress - r));
  }
  vec3 hot = fg * vec3(1.15, 0.95, 0.75) + vec3(0.22, 0.1, 0.02);
  vec3 ash = vec3(luma(fg)) * vec3(0.9, 0.82, 0.72);
  vec3 f2 = mix(fg, mix(hot, ash, u_ashTint), edge * 0.85);
  vec3 col = mix(bg, f2, m * vis);
  col = mix(col, texture(u_live, uv).rgb, u_toLive);
  o = vec4(col, 1.0);
}`);

const PARTICLE_VS = `#version 300 es
${GLSL_COMMON}
${RELEASE_GLSL}
uniform sampler2D u_fg;
uniform sampler2D u_fgMask;
uniform vec2 u_grid;
uniform float u_time;
uniform float u_dissolve;
uniform float u_pointSize;
uniform float u_aspect;
uniform float u_ashTint;
out vec4 v_color;
void main() {
  float id = float(gl_VertexID);
  float cx = mod(id, u_grid.x);
  float cy = floor(id / u_grid.x);
  float h1 = hash12(vec2(id * 0.137, u_seed * 0.01 + 1.3));
  float h2 = hash12(vec2(id * 0.711 + 3.1, u_seed * 0.013));
  float h3 = hash12(vec2(h1 * 91.7, h2 * 37.3));
  vec2 origin = (vec2(cx, cy) + vec2(h1, h2)) / u_grid;
  float m = texture(u_fgMask, origin).r;
  float age = u_time - releaseAt(origin) * u_dissolve;
  float life = mix(0.7, 1.35, h3);
  if (m < 0.5 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_color = vec4(0.0);
    return;
  }
  float k = age / life;
  vec2 vel = vec2((u_drift * 0.9 + (h1 - 0.5) * 0.7) / u_aspect, -(0.18 + h2 * 0.3)) * mix(0.12, 0.32, h3);
  float grav = mix(-0.05, 0.08, h2);
  vec2 turb = (vec2(vnoise(origin * 14.0 + age * 1.7), vnoise(origin * 14.0 + 41.0 + age * 1.7)) - 0.5) * 0.09 * age;
  vec2 pos = origin + vel * age + vec2(turb.x / u_aspect, turb.y + grav * age * age);
  vec3 c = texture(u_fg, origin).rgb;
  vec3 ash = vec3(luma(c)) * vec3(0.92, 0.84, 0.74);
  c = mix(c, ash, clamp(k * 1.3, 0.0, 1.0) * u_ashTint + 0.1);
  v_color = vec4(c, pow(1.0 - k, 1.4));
  gl_PointSize = u_pointSize * mix(0.6, 1.5, h1) * (1.0 - 0.45 * k);
  gl_Position = vec4(pos.x * 2.0 - 1.0, 1.0 - pos.y * 2.0, 0.0, 1.0);
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 o;
void main() {
  float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));
  o = vec4(v_color.rgb, v_color.a * a);
}`;

export const PARTICLE_BUDGET: Record<Quality, number> = { low: 2000, medium: 6000, high: 12000 };
const MAX_GRID_VERTICES = 150_000;

/**
 * Particles are seeded on a jittered grid over the whole frame and culled where the
 * frozen mask has no person, so the grid is enlarged by 1/coverage to hit the budget.
 */
export function particleGrid(budget: number, coverage: number, aspect: number): { cols: number; rows: number } {
  const total = Math.min(MAX_GRID_VERTICES, budget / Math.max(0.05, Math.min(1, coverage)));
  const cols = Math.max(1, Math.round(Math.sqrt(total * aspect)));
  const rows = Math.max(1, Math.ceil(total / cols));
  return { cols, rows };
}

export class DustAwayEffect implements EffectRenderer {
  readonly template = 'dust-away' as const;
  private composite!: Program;
  private particles!: Program;
  private fgColor: RenderTarget | null = null;
  private fgMask: RenderTarget | null = null;
  private def!: DefinitionOf<'dust-away'>;
  private seed = 0;
  private grid = { cols: 1, rows: 1 };
  private hasFrozenMask = false;

  constructor(private ctx: EffectContext) {}

  load(): void {
    this.composite = createProgram(this.ctx.gl, FULLSCREEN_VS, COMPOSITE_FS);
    this.particles = createProgram(this.ctx.gl, PARTICLE_VS, PARTICLE_FS);
  }

  start(run: EffectStart): void {
    this.def = run.definition as DefinitionOf<'dust-away'>;
    this.seed = run.seed;
    const { width, height, video, mask, maskInfo } = run.inputs;
    this.fgColor ??= this.ctx.createTarget(width, height);
    this.fgMask ??= this.ctx.createTarget(width, height);
    this.fgColor.resize(width, height);
    this.fgMask.resize(width, height);
    this.fgColor.bind();
    this.ctx.copy(video);
    this.fgMask.bind();
    this.hasFrozenMask = mask !== null;
    if (mask) this.ctx.copy(mask);
    else this.ctx.gl.clear(this.ctx.gl.COLOR_BUFFER_BIT);
    this.ctx.bindScene();
    const scale = this.def.parameters.particleScale ?? 1;
    const budget = (run.reducedMotion ? 0.5 : 1) * PARTICLE_BUDGET[run.quality] * scale;
    this.grid = particleGrid(budget, maskInfo?.coverage ?? 0.3, width / height);
  }

  render(f: EffectFrame): void {
    const { inputs } = f;
    const p = this.def.parameters;
    const gl = this.ctx.gl;
    const aspect = inputs.width / inputs.height;
    const drift = p.drift ?? 0.6;
    const ashTint = p.ashTint ?? 0.35;
    const dissolveMs = p.dissolveMs ?? 1600;
    const bg = inputs.background;

    if (f.phase === 'VANISHED' || !this.fgColor || !this.fgMask) {
      this.drawComposite(f, { progress: 2, reverse: 0, fg: this.ctx.blank, mask: null, toLive: 0, drift, ashTint, bg });
      return;
    }

    if (f.phase === 'DISINTEGRATING') {
      const t = f.phaseElapsed / 1000;
      const progress = clamp01(f.phaseElapsed / dissolveMs) * 1.04;
      this.drawComposite(f, {
        progress,
        reverse: 0,
        fg: this.fgColor.tex,
        mask: this.hasFrozenMask ? this.fgMask.tex : null,
        toLive: 0,
        drift,
        ashTint,
        bg,
      });
      if (!this.hasFrozenMask) return;
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.particles
        .use()
        .f('u_seed', this.seed)
        .f('u_drift', drift)
        .f('u_grid', this.grid.cols, this.grid.rows)
        .f('u_time', t)
        .f('u_dissolve', dissolveMs / 1000)
        .f('u_pointSize', Math.max(1.5, (inputs.height / 720) * 2.6))
        .f('u_aspect', aspect)
        .f('u_ashTint', ashTint)
        .tex('u_fg', 0, this.fgColor.tex)
        .tex('u_fgMask', 1, this.fgMask.tex);
      gl.drawArrays(gl.POINTS, 0, this.grid.cols * this.grid.rows);
      gl.disable(gl.BLEND);
      return;
    }

    if (f.phase === 'REAPPEARING') {
      const dissolvePart = REAPPEAR_MS - 300;
      this.drawComposite(f, {
        progress: clamp01(f.phaseElapsed / dissolvePart) * 1.04,
        reverse: 1,
        fg: inputs.video,
        mask: inputs.mask,
        toLive: ramp(f.phaseElapsed, dissolvePart, REAPPEAR_MS),
        drift,
        ashTint,
        bg,
      });
    }
  }

  private drawComposite(
    f: EffectFrame,
    o: {
      progress: number;
      reverse: number;
      fg: WebGLTexture;
      mask: WebGLTexture | null;
      toLive: number;
      drift: number;
      ashTint: number;
      bg: WebGLTexture | null;
    },
  ): void {
    // While hidden, the live camera texture is only bound for the reappear crossfade.
    const live = f.phase === 'REAPPEARING' ? f.inputs.video : this.ctx.blank;
    this.composite
      .use()
      .f('u_seed', this.seed)
      .f('u_drift', o.drift)
      .f('u_hasMask', o.mask ? 1 : 0)
      .f('u_hasBg', o.bg ? 1 : 0)
      .f('u_progress', o.progress)
      .f('u_reverse', o.reverse)
      .f('u_ashTint', o.ashTint)
      .f('u_toLive', o.toLive)
      .tex('u_bg', 0, o.bg ?? this.ctx.blank)
      .tex('u_fg', 1, o.fg)
      .tex('u_fgMask', 2, o.mask ?? this.ctx.blank)
      .tex('u_live', 3, live);
    this.ctx.quad.draw();
  }

  cancel(): void {}

  dispose(): void {
    this.composite?.dispose();
    this.particles?.dispose();
    this.fgColor?.dispose();
    this.fgMask?.dispose();
    this.fgColor = this.fgMask = null;
  }
}
