import { z } from './zod';

export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

export const BACKGROUND_MODES = ['captured', 'virtual', 'custom'] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

const idString = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * Persisted user preferences. Never contains live camera sessions, frames or meeting data.
 * Each field is validated independently during migration so one corrupt value cannot
 * reset the whole object.
 */
export const SettingsSchema = z.object({
  schemaVersion: z.literal(1),
  /** Route the Meet camera through SnapMeet. Off by default: the user must opt in. */
  enabled: z.boolean(),
  quality: z.enum(QUALITY_LEVELS),
  autoQuality: z.boolean(),
  reducedMotion: z.boolean(),
  /** Phase-zero proof: grayscale output plus a time-varying watermark. */
  proofMode: z.boolean(),
  selectedEffectId: idString,
  favorites: z.array(idString).max(64),
  backgroundMode: z.enum(BACKGROUND_MODES),
  virtualBackgroundId: idString,
  /** 0 = stay vanished until the user explicitly reappears. */
  reappearAfterMs: z.number().int().min(0).max(60_000),
  snapEnabled: z.boolean(),
  snapSensitivity: z.number().min(0).max(1),
  snapEffectId: idString,
  palmsEnabled: z.boolean(),
  poseEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  soundMonitor: z.boolean(),
  soundVolume: z.number().min(0).max(1),
  showDock: z.boolean(),
  dockCollapsed: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  enabled: false,
  quality: 'medium',
  autoQuality: true,
  reducedMotion: false,
  proofMode: false,
  selectedEffectId: 'dust-away',
  favorites: ['dust-away', 'absolute-cinema'],
  backgroundMode: 'virtual',
  virtualBackgroundId: 'studio-charcoal',
  reappearAfterMs: 5000,
  snapEnabled: true,
  snapSensitivity: 0.5,
  snapEffectId: 'dust-away',
  palmsEnabled: true,
  poseEnabled: true,
  soundEnabled: true,
  soundMonitor: true,
  soundVolume: 0.65,
  showDock: true,
  dockCollapsed: false,
};

export const SETTINGS_STORAGE_KEY = 'snapmeet.settings';

/** Field-by-field migration: invalid or missing fields fall back to defaults. */
export function migrateSettings(raw: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const source = raw as Record<string, unknown>;
    const shape = SettingsSchema.shape as Record<string, z.ZodType>;
    for (const key of Object.keys(shape)) {
      if (key === 'schemaVersion' || !(key in source)) continue;
      const parsed = shape[key]!.safeParse(source[key]);
      if (parsed.success) out[key] = parsed.data;
    }
  }
  out.schemaVersion = 1;
  return SettingsSchema.parse(out);
}

/** Validates a partial update coming from a UI surface. Unknown keys are rejected. */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  const parsed = SettingsSchema.partial().strict().parse(patch);
  return SettingsSchema.parse({ ...current, ...parsed, schemaVersion: 1 });
}
