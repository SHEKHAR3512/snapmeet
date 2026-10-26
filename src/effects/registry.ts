import type { EffectTemplate } from '../catalog/schema';
import { AuraEffect } from './built-in/aura';
import { CinemaEffect } from './built-in/cinema';
import { ConfusedFreezeEffect } from './built-in/confused-freeze';
import { DramaticZoomEffect } from './built-in/dramatic-zoom';
import { DustAwayEffect } from './built-in/dust-away';
import { IllustratedFireEffect } from './built-in/illustrated-fire';
import { ImpactCaptionEffect } from './built-in/impact-caption';
import { SuccessTitleEffect } from './built-in/success-title';
import type { EffectFactory } from './types';

/**
 * Bundled rendering templates. Catalog entries (bundled or imported data packs) can only
 * select one of these; new templates require a packaged extension update.
 */
export const EFFECT_FACTORIES: Record<EffectTemplate, EffectFactory> = {
  'dust-away': (ctx) => new DustAwayEffect(ctx),
  cinema: (ctx) => new CinemaEffect(ctx),
  aura: (ctx) => new AuraEffect(ctx),
  'dramatic-zoom': (ctx) => new DramaticZoomEffect(ctx),
  'confused-freeze': (ctx) => new ConfusedFreezeEffect(ctx),
  'impact-caption': (ctx) => new ImpactCaptionEffect(ctx),
  'illustrated-fire': (ctx) => new IllustratedFireEffect(ctx),
  'success-title': (ctx) => new SuccessTitleEffect(ctx),
};

/** Templates whose look benefits from (but does not require) a fresh person mask. */
export const MASK_ENHANCED: ReadonlySet<EffectTemplate> = new Set([
  'dust-away',
  'aura',
  'dramatic-zoom',
  'confused-freeze',
  'illustrated-fire',
]);
