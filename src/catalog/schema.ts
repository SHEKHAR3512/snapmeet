import { z } from '../shared/zod';
import { SEMVER_RE, compareSemver } from '../shared/semver';

/**
 * Effect catalog schema. Definitions are pure data: they can only select one of the
 * bundled rendering templates and tune its bounded parameters. No code, shader source,
 * markup or remote asset URLs are accepted.
 */
export const EFFECT_TEMPLATES = [
  'dust-away',
  'cinema',
  'aura',
  'dramatic-zoom',
  'confused-freeze',
  'impact-caption',
  'illustrated-fire',
  'success-title',
] as const;
export type EffectTemplate = (typeof EFFECT_TEMPLATES)[number];

/** Assets the extension ships (all procedurally generated or original). */
export const BUILTIN_ASSET_IDS = [
  'fx-dust-particles',
  'fx-film-grain',
  'fx-aura-glow',
  'fx-question-marks',
  'fx-procedural-flames',
  'fx-impact-vignette',
] as const;

export const REGIONS = ['IN', 'US', 'GLOBAL'] as const;
export type Region = (typeof REGIONS)[number];

// Rejects markup-ish characters and control characters in captions/titles.
// eslint-disable-next-line no-control-regex
const MAX_SAFE_TEXT = /^[^<>{}\\`\u0000-\u001f]*$/;
const text = (max: number) => z.string().min(1).max(max).regex(MAX_SAFE_TEXT, 'Unsupported characters');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/);
const semver = z.string().regex(SEMVER_RE, 'Expected MAJOR.MINOR.PATCH');
const unit = z.number().min(0).max(1);

const common = {
  id: slug,
  schemaVersion: z.literal(1),
  title: text(48),
  description: text(160).optional(),
  regions: z.array(z.enum(REGIONS)).min(1).max(3),
  languages: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/)).min(1).max(8),
  tags: z.array(z.string().regex(/^[a-z0-9-]{1,24}$/)).max(12),
  durationMs: z.number().int().min(500).max(15_000),
  requires: z.array(z.enum(['person-mask', 'background'])).max(2),
  minExtensionVersion: semver,
  assetIds: z.array(z.enum(BUILTIN_ASSET_IDS)).max(8),
  addedAt: isoDate,
  reviewedAt: isoDate.optional(),
  /** "trending" is only displayed when a source was checked recently (see catalog/labels). */
  badge: z.enum(['new', 'trending']).optional(),
  sources: z
    .array(z.object({ url: z.url({ protocol: /^https$/ }).max(300), checkedAt: isoDate }).strict())
    .max(10)
    .optional(),
  attributionIds: z.array(slug).max(8),
};

const DustParams = z
  .object({
    particleScale: z.number().min(0.25).max(2),
    dissolveMs: z.number().int().min(1000).max(2500),
    drift: z.number().min(-1).max(1),
    ashTint: unit,
  })
  .partial()
  .strict();
const CinemaParams = z
  .object({ title: text(32), barSize: z.number().min(0.05).max(0.2), grain: z.number().min(0).max(0.4) })
  .partial()
  .strict();
const AuraParams = z
  .object({ label: text(24), score: z.number().int().min(1).max(999_999), hue: z.number().min(0).max(360) })
  .partial()
  .strict();
const DramaParams = z
  .object({
    caption: text(40),
    punches: z.number().int().min(1).max(3),
    tint: z.boolean(),
    maxZoom: z.number().min(1.1).max(1.6),
  })
  .partial()
  .strict();
const ConfusedParams = z
  .object({ caption: text(32), questionMarks: z.number().int().min(1).max(8) })
  .partial()
  .strict();
const ImpactParams = z
  .object({ caption: text(32), shake: unit, hue: z.number().min(0).max(360) })
  .partial()
  .strict();
const FireParams = z.object({ caption: text(40), intensity: z.number().min(0.2).max(1) }).partial().strict();
const SuccessParams = z.object({ title: text(28), subtitle: text(28) }).partial().strict();

const def = <T extends EffectTemplate, P extends z.ZodType>(template: T, parameters: P) =>
  z.object({ ...common, template: z.literal(template), parameters }).strict();

export const EffectDefinitionSchema = z
  .discriminatedUnion('template', [
    def('dust-away', DustParams),
    def('cinema', CinemaParams),
    def('aura', AuraParams),
    def('dramatic-zoom', DramaParams),
    def('confused-freeze', ConfusedParams),
    def('impact-caption', ImpactParams),
    def('illustrated-fire', FireParams),
    def('success-title', SuccessParams),
  ])
  .superRefine((d, ctx) => {
    if (d.template === 'dust-away') {
      for (const req of ['person-mask', 'background'] as const) {
        if (!d.requires.includes(req)) {
          ctx.addIssue({ code: 'custom', path: ['requires'], message: `dust-away must require ${req}` });
        }
      }
    }
  });

export type EffectDefinition = z.infer<typeof EffectDefinitionSchema>;
export type ParamsOf<T extends EffectTemplate> = Extract<EffectDefinition, { template: T }>['parameters'];

export const AttributionSchema = z
  .object({
    id: slug,
    kind: z.enum(['original', 'licensed']),
    author: text(80),
    license: text(80),
    url: z.url({ protocol: /^https$/ }).max(300).optional(),
    notes: text(240).optional(),
  })
  .strict();
export type Attribution = z.infer<typeof AttributionSchema>;

export const PACK_MAX_BYTES = 256 * 1024;

export const EffectPackSchema = z
  .object({
    packId: slug,
    packVersion: semver,
    schemaVersion: z.literal(1),
    title: text(64),
    minExtensionVersion: semver,
    effects: z.array(EffectDefinitionSchema).min(1).max(50),
    attributions: z.array(AttributionSchema).max(50),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const ids = new Set<string>();
    const attributionIds = new Set(pack.attributions.map((a) => a.id));
    pack.effects.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: 'custom', path: ['effects', i, 'id'], message: `Duplicate id ${e.id}` });
      ids.add(e.id);
      for (const a of e.attributionIds) {
        if (!attributionIds.has(a)) {
          ctx.addIssue({ code: 'custom', path: ['effects', i, 'attributionIds'], message: `Unknown attribution ${a}` });
        }
      }
    });
  });
export type EffectPack = z.infer<typeof EffectPackSchema>;

export type PackValidation =
  | { ok: true; pack: EffectPack; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Validates an untrusted pack. Accepts the raw JSON text so the byte limit is enforced
 * before parsing. Never throws.
 */
export function validatePackText(json: string, extensionVersion: string): PackValidation {
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > PACK_MAX_BYTES) return { ok: false, errors: [`Pack is ${bytes} bytes; limit is ${PACK_MAX_BYTES}`] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  return validatePack(raw, extensionVersion);
}

export function validatePack(raw: unknown, extensionVersion: string): PackValidation {
  const parsed = EffectPackSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const pack = parsed.data;
  if (compareSemver(pack.minExtensionVersion, extensionVersion) > 0) {
    return { ok: false, errors: [`Pack requires SnapMeet ${pack.minExtensionVersion}; installed ${extensionVersion}`] };
  }
  const warnings: string[] = [];
  for (const e of pack.effects) {
    if (compareSemver(e.minExtensionVersion, extensionVersion) > 0) {
      warnings.push(`${e.id} requires ${e.minExtensionVersion} and will be hidden`);
    }
    if (e.badge === 'trending' && !e.sources?.length) {
      warnings.push(`${e.id} is marked trending without sources; it will be labelled New at most`);
    }
  }
  return { ok: true, pack, warnings };
}

/** Validates a single definition (used at the MAIN-world boundary). */
export function parseDefinitions(raw: unknown, extensionVersion: string): EffectDefinition[] {
  if (!Array.isArray(raw) || raw.length > 200) return [];
  const out: EffectDefinition[] = [];
  for (const item of raw) {
    const r = EffectDefinitionSchema.safeParse(item);
    if (r.success && compareSemver(r.data.minExtensionVersion, extensionVersion) <= 0) out.push(r.data);
  }
  return out;
}
