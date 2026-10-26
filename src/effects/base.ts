import type { EffectDefinition, EffectTemplate } from '../catalog/schema';
import { FULLSCREEN_VS, createProgram, type Program } from '../engine/gl';
import { SpriteRenderer } from './sprites';
import type { EffectContext, EffectFrame, EffectRenderer, EffectStart } from './types';

export type DefinitionOf<T extends EffectTemplate> = Extract<EffectDefinition, { template: T }>;

/** A fullscreen shader pass plus text sprites, which covers most templates. */
export abstract class ShaderEffect<T extends EffectTemplate> implements EffectRenderer {
  protected program!: Program;
  protected sprites!: SpriteRenderer;
  protected def!: DefinitionOf<T>;
  protected seed = 0;
  protected reducedMotion = false;

  constructor(
    readonly template: T,
    protected ctx: EffectContext,
    private fragmentSource: string,
  ) {}

  load(): void {
    this.program = createProgram(this.ctx.gl, FULLSCREEN_VS, this.fragmentSource);
    this.sprites = new SpriteRenderer(this.ctx.gl, this.ctx.quad);
  }

  start(run: EffectStart): void {
    this.def = run.definition as DefinitionOf<T>;
    this.seed = run.seed;
    this.reducedMotion = run.reducedMotion;
    this.onStart(run);
  }

  protected onStart(_run: EffectStart): void {}

  abstract render(frame: EffectFrame): void;

  cancel(): void {}

  dispose(): void {
    this.program?.dispose();
    this.sprites?.dispose();
  }

  protected outAspect(f: EffectFrame): number {
    return f.inputs.width / f.inputs.height;
  }

  protected durationOf(f: EffectFrame): number {
    return f.phaseDurationMs ?? this.def.durationMs;
  }
}
