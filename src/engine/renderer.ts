import type { BodyAnchor, FaceAnchor } from '../vision/types';
import type { EffectTemplate } from '../catalog/schema';
import { EFFECT_FACTORIES } from '../effects/registry';
import { SpriteRenderer } from '../effects/sprites';
import type { EffectContext, EffectRenderer, FrameInputs, MaskInfo } from '../effects/types';
import type { SessionSnapshot } from '../session/session';
import type { Quality } from '../shared/settings';
import {
  FULLSCREEN_VS,
  FullscreenQuad,
  GLError,
  RenderTarget,
  createProgram,
  createTexture,
  fragment,
  uploadImage,
  uploadR8,
  type Program,
} from './gl';

export interface MaskSnapshot {
  data: Uint8Array;
  width: number;
  height: number;
  version: number;
  at: number;
  info: Omit<MaskInfo, 'ageMs'>;
}

export interface BackgroundSnapshot {
  key: string;
  source: TexImageSource;
}

export interface RenderState {
  face?: FaceAnchor | null;
  body?: BodyAnchor | null;
  hands?: Array<{ x: number; y: number; radius: number }>;
  now: number;
  session: SessionSnapshot;
  mask: MaskSnapshot | null;
  background: BackgroundSnapshot | null;
  reducedMotion: boolean;
  quality: Quality;
  proof: boolean;
}

const COPY_FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
void main() { o = texture(u_src, v_uv); }`);

const PASSTHROUGH_FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
void main() { o = vec4(texture(u_src, img(v_uv)).rgb, 1.0); }`);

const PRESENT_FS = fragment(`
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_scene;
uniform float u_gray;
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  o = vec4(mix(c, vec3(luma(c)), u_gray), 1.0);
}`);

/** A mask older than this is not used for new effect starts. */
export const MASK_FRESH_MS = 600;

/**
 * Renders one pipeline's frames: camera texture → active effect (or passthrough) → scene
 * → present. Owns all GL resources for its context. Throws on failure; the pipeline
 * decides what to transmit instead.
 */
export class FrameRenderer {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private quad: FullscreenQuad;
  private scene: RenderTarget;
  private copyProgram: Program;
  private passthroughProgram: Program;
  private presentProgram: Program;
  private videoTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private bgTex: WebGLTexture;
  private blank: WebGLTexture;
  private maskVersion = -1;
  private bgKey: string | null = null;
  private effects = new Map<EffectTemplate, EffectRenderer>();
  private active: EffectRenderer | null = null;
  private activeRunId: number | null = null;
  private proofSprites: SpriteRenderer;
  private ctx: EffectContext;
  private lost = false;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new GLError('WebGL2 unavailable');
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.quad = new FullscreenQuad(gl);
    this.scene = new RenderTarget(gl, width, height);
    this.copyProgram = createProgram(gl, FULLSCREEN_VS, COPY_FS);
    this.passthroughProgram = createProgram(gl, FULLSCREEN_VS, PASSTHROUGH_FS);
    this.presentProgram = createProgram(gl, FULLSCREEN_VS, PRESENT_FS);
    this.videoTex = createTexture(gl);
    this.maskTex = createTexture(gl);
    this.bgTex = createTexture(gl);
    this.blank = createTexture(gl);
    this.proofSprites = new SpriteRenderer(gl, this.quad);
    this.ctx = {
      gl,
      quad: this.quad,
      blank: this.blank,
      copy: (src) => {
        this.copyProgram.use().tex('u_src', 0, src);
        this.quad.draw();
      },
      createTarget: (w, h) => new RenderTarget(gl, w, h),
      bindScene: () => this.scene.bind(),
    };
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  resize(width: number, height: number): void {
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.scene.resize(width, height);
  }

  render(frame: TexImageSource, state: RenderState): void {
    if (this.isLost) throw new GLError('WebGL context lost');
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    uploadImage(gl, this.videoTex, frame);

    if (state.mask && state.mask.version !== this.maskVersion) {
      uploadR8(gl, this.maskTex, state.mask.width, state.mask.height, state.mask.data);
      this.maskVersion = state.mask.version;
    }
    if (state.background && state.background.key !== this.bgKey) {
      uploadImage(gl, this.bgTex, state.background.source);
      this.bgKey = state.background.key;
    }

    const inputs: FrameInputs = {
      face: state.face,
      body: state.body,
      hands: state.hands,
      video: this.videoTex,
      mask: state.mask ? this.maskTex : null,
      maskInfo: state.mask ? { ...state.mask.info, ageMs: state.now - state.mask.at } : null,
      background: state.background ? this.bgTex : null,
      width: w,
      height: h,
    };

    this.scene.bind();
    this.syncEffect(state, inputs);
    const s = state.session;
    if (this.active && s.effect) {
      this.active.render({
        now: state.now,
        elapsed: state.now - s.effect.startedAt,
        phase: s.effectPhase,
        phaseElapsed: state.now - s.effectPhaseStartedAt,
        phaseDurationMs: s.effectPhaseDurationMs,
        inputs,
        reducedMotion: state.reducedMotion,
        quality: state.quality,
      });
    } else {
      this.passthroughProgram.use().tex('u_src', 0, this.videoTex);
      this.quad.draw();
    }

    if (state.proof) this.drawProofWatermark(state.now, w / h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.presentProgram
      .use()
      .f('u_gray', state.proof ? 1 : 0)
      .tex('u_scene', 0, this.scene.tex);
    this.quad.draw();
    const err = gl.getError();
    if (err !== gl.NO_ERROR && err !== gl.CONTEXT_LOST_WEBGL) throw new GLError(`WebGL error 0x${err.toString(16)}`);
  }

  private syncEffect(state: RenderState, inputs: FrameInputs): void {
    const eff = state.session.effect;
    const runId = eff?.runId ?? null;
    if (runId === this.activeRunId) return;
    this.active?.cancel();
    this.active = null;
    this.activeRunId = runId;
    if (!eff) return;
    let inst = this.effects.get(eff.template);
    if (!inst) {
      inst = EFFECT_FACTORIES[eff.template](this.ctx);
      inst.load();
      this.effects.set(eff.template, inst);
    }
    inst.start({
      definition: eff.definition,
      seed: eff.seed,
      inputs,
      quality: state.quality,
      reducedMotion: state.reducedMotion,
    });
    this.scene.bind();
    this.active = inst;
  }

  private drawProofWatermark(now: number, outAspect: number): void {
    const d = new Date();
    const stamp = `${d.toLocaleTimeString('en-GB', { hour12: false })}.${Math.floor(d.getMilliseconds() / 100)}`;
    const label = this.proofSprites.text({
      text: `SNAPMEET PROOF ${stamp}`,
      font: 'sans',
      weight: 800,
      sizePx: 64,
      fill: '#ffffff',
      bubble: { fill: 'rgba(0,0,0,0.65)', radiusEm: 0.2, padEm: 0.25 },
    });
    this.proofSprites.draw(label, { x: 0.5, y: 0.08, height: 0.04, maxWidth: 0.9, outAspect });
    const bar = this.proofSprites.art('proof-bar', 8, 8, (c) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 8, 8);
    });
    const x = 0.05 + 0.9 * ((now / 2500) % 1);
    this.proofSprites.draw(bar, { x, y: 0.95, height: 0.025, outAspect });
    if (this.proofSprites.size > 64) this.proofSprites.clear();
  }

  dispose(): void {
    for (const e of this.effects.values()) e.dispose();
    this.effects.clear();
    this.active = null;
    this.proofSprites.dispose();
    this.copyProgram.dispose();
    this.passthroughProgram.dispose();
    this.presentProgram.dispose();
    this.scene.dispose();
    this.quad.dispose();
    for (const t of [this.videoTex, this.maskTex, this.bgTex, this.blank]) this.gl.deleteTexture(t);
    // Release the context promptly instead of waiting for GC.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
