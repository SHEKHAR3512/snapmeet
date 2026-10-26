import { FullscreenQuad, GLError, Program, createProgram, createTexture, fragment, uploadImage } from '../engine/gl';

/**
 * Text and simple 2D artwork rendered with Canvas 2D into textures, then drawn as
 * rotated/scaled quads. Fonts are system font stacks (no bundled brand fonts).
 */
export const FONT_STACKS = {
  display: '"Impact", "Haettenschweiler", "Arial Narrow Bold", "Arial Black", "Helvetica Neue", sans-serif',
  serif: '"Didot", "Bodoni 72", "Playfair Display", Georgia, "Times New Roman", serif',
  sans: '"Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif',
} as const;

export interface TextStyle {
  text: string;
  font: keyof typeof FONT_STACKS;
  weight?: number;
  /** Canvas pixel size of the glyphs; the on-screen size is set when drawing. */
  sizePx?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  letterSpacingEm?: number;
  shadow?: { color: string; blur: number };
  bubble?: { fill: string; radiusEm: number; padEm: number };
  italic?: boolean;
}

export interface Sprite {
  tex: WebGLTexture;
  /** width / height */
  aspect: number;
  /** Sprite height per unit of requested height (text: canvas height / font size; art: 1). */
  em: number;
}

export interface DrawOpts {
  holes?: Array<{ x: number; y: number; radius: number }>;
  /** Center in image space (0..1, y down). */
  x: number;
  y: number;
  /** Text: font size as a fraction of the output height. Art: full sprite height. */
  height: number;
  /** Optional cap on the width as a fraction of the output width (shrinks height to fit). */
  maxWidth?: number;
  alpha?: number;
  rotation?: number;
  /** Output width / height. */
  outAspect: number;
  /** Multiplies RGB (for tinting white artwork). */
  tint?: [number, number, number];
}

const SPRITE_VS = `#version 300 es
in vec2 a_pos;
uniform vec2 u_center;
uniform vec2 u_half;
uniform float u_rot;
uniform float u_outAspect;
out vec2 v_uv;
out vec2 v_image;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  vec2 p = a_pos * u_half;
  // rotate in a square space so rotation keeps proportions
  p.x *= u_outAspect;
  float c = cos(u_rot), s = sin(u_rot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p.x /= u_outAspect;
  gl_Position = vec4(u_center + p, 0.0, 1.0);
  v_image = vec2(gl_Position.x * 0.5 + 0.5, 0.5 - gl_Position.y * 0.5);
}`;

const SPRITE_FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform float u_alpha;
uniform vec3 u_tint;
in vec2 v_image;
uniform vec3 u_holeA;
uniform vec3 u_holeB;
uniform float u_aspect;
void main() {
  vec4 c = texture(u_tex, v_uv);
  float visible = 1.0;
  if (u_holeA.z > 0.0) visible *= smoothstep(u_holeA.z * 0.8, u_holeA.z, length((v_image - u_holeA.xy) * vec2(u_aspect, 1.0)));
  if (u_holeB.z > 0.0) visible *= smoothstep(u_holeB.z * 0.8, u_holeB.z, length((v_image - u_holeB.xy) * vec2(u_aspect, 1.0)));
  o = vec4(c.rgb * u_tint, c.a * u_alpha * visible);
}`);

export class SpriteRenderer {
  private program: Program;
  private cache = new Map<string, Sprite>();

  constructor(
    private gl: WebGL2RenderingContext,
    private quad: FullscreenQuad,
  ) {
    this.program = createProgram(gl, SPRITE_VS, SPRITE_FS);
  }

  text(style: TextStyle): Sprite {
    const key = JSON.stringify(style);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const canvas = renderTextCanvas(style);
    const tex = createTexture(this.gl);
    uploadImage(this.gl, tex, canvas);
    const sprite = { tex, aspect: canvas.width / canvas.height, em: canvas.height / (style.sizePx ?? 160) };
    this.cache.set(key, sprite);
    return sprite;
  }

  /** Arbitrary Canvas 2D artwork, cached under `key`. */
  art(key: string, w: number, h: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): Sprite {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new GLError('2D context unavailable');
    paint(ctx);
    const tex = createTexture(this.gl);
    uploadImage(this.gl, tex, canvas);
    const sprite = { tex, aspect: w / h, em: 1 };
    this.cache.set(key, sprite);
    return sprite;
  }

  draw(sprite: Sprite, o: DrawOpts): void {
    const gl = this.gl;
    let halfH = o.height * sprite.em;
    let halfW = (halfH * sprite.aspect) / o.outAspect;
    if (o.maxWidth !== undefined && halfW > o.maxWidth) {
      halfH *= o.maxWidth / halfW;
      halfW = o.maxWidth;
    }
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const t = o.tint ?? [1, 1, 1];
    this.program
      .use()
      .f('u_center', o.x * 2 - 1, 1 - o.y * 2)
      .f('u_half', halfW, halfH)
      .f('u_rot', o.rotation ?? 0)
      .f('u_outAspect', o.outAspect)
      .f('u_holeA', o.holes?.[0]?.x ?? 0, o.holes?.[0]?.y ?? 0, o.holes?.[0]?.radius ?? 0)
      .f('u_holeB', o.holes?.[1]?.x ?? 0, o.holes?.[1]?.y ?? 0, o.holes?.[1]?.radius ?? 0)
      .f('u_aspect', o.outAspect)
      .f('u_alpha', o.alpha ?? 1)
      .f('u_tint', t[0], t[1], t[2])
      .tex('u_tex', 0, sprite.tex);
    this.quad.draw();
    gl.disable(gl.BLEND);
  }

  get size(): number {
    return this.cache.size;
  }

  /** Frees cached textures (for sprites whose text changes continuously). */
  clear(): void {
    for (const s of this.cache.values()) this.gl.deleteTexture(s.tex);
    this.cache.clear();
  }

  dispose(): void {
    this.clear();
    this.program.dispose();
  }
}

export function renderTextCanvas(style: TextStyle): OffscreenCanvas {
  const size = style.sizePx ?? 160;
  const font = `${style.italic ? 'italic ' : ''}${style.weight ?? 800} ${size}px ${FONT_STACKS[style.font]}`;
  const probe = new OffscreenCanvas(8, 8).getContext('2d');
  if (!probe) throw new GLError('2D context unavailable');
  probe.font = font;
  probe.letterSpacing = `${(style.letterSpacingEm ?? 0) * size}px`;
  const m = probe.measureText(style.text);
  const stroke = style.stroke ? (style.strokeWidth ?? size * 0.08) : 0;
  const shadow = style.shadow ? style.shadow.blur * 2 : 0;
  const pad = (style.bubble ? style.bubble.padEm * size : 0) + stroke + shadow + size * 0.06;
  const textW = Math.ceil(m.width);
  const textH = Math.ceil(size * 1.18);
  const w = Math.min(4096, textW + pad * 2);
  const h = Math.min(1024, textH + pad * 2);
  const canvas = new OffscreenCanvas(Math.max(2, Math.ceil(w)), Math.max(2, Math.ceil(h)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new GLError('2D context unavailable');
  if (style.bubble) {
    const inset = shadow + size * 0.03;
    ctx.fillStyle = style.bubble.fill;
    ctx.beginPath();
    ctx.roundRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, style.bubble.radiusEm * size);
    ctx.fill();
  }
  ctx.font = font;
  ctx.letterSpacing = `${(style.letterSpacingEm ?? 0) * size}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const cx = canvas.width / 2 + ((style.letterSpacingEm ?? 0) * size) / 2;
  const cy = canvas.height / 2 + size * 0.04;
  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur;
  }
  if (style.stroke) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = stroke * 2;
    ctx.strokeText(style.text, cx, cy);
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(style.text, cx, cy);
  return canvas;
}
