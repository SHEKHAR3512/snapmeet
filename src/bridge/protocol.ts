import { z } from '../shared/zod';
import { SettingsSchema } from '../shared/settings';

/**
 * Isolated-world controller ⇄ MAIN-world engine protocol.
 *
 * The handshake uses window.postMessage once to hand over a private MessagePort; all
 * further traffic uses that port. The page shares the MAIN world, so this is a
 * collision-avoidance and validation boundary, not a trust boundary: commands are a
 * finite set of effect controls, payloads are schema-validated and size-limited, and
 * nothing here exposes fetch, file access, eval or extension APIs. Frames are never
 * sent over this channel (the only image payloads are a single background preview
 * and an optional user-chosen background image).
 */
export const PROTOCOL = 'snapmeet/1';
export const MAX_COMMAND_BYTES = 192 * 1024;

export const HELLO = 'snapmeet:hello';
export const MAIN_READY = 'snapmeet:main-ready';

const reqId = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const effectId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/);

export const CommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('config'),
      id: reqId,
      settings: SettingsSchema,
      assetBase: z.string().regex(/^chrome-extension:\/\/[a-p]{32}\/$/),
      extensionVersion: z.string().max(20),
      // Validated again in the engine with the full catalog schema.
      definitions: z.array(z.unknown()).max(200),
    })
    .strict(),
  z.object({ type: z.literal('trigger'), id: reqId, effectId }).strict(),
  z.object({ type: z.literal('reappear'), id: reqId }).strict(),
  z.object({ type: z.literal('reset'), id: reqId }).strict(),
  z.object({ type: z.literal('capture-background'), id: reqId }).strict(),
  z.object({ type: z.literal('clear-background'), id: reqId }).strict(),
  z.object({ type: z.literal('calibration'), id: reqId, action: z.enum(['start', 'stop']) }).strict(),
  z.object({ type: z.literal('vision-injected'), id: reqId, ok: z.boolean(), error: z.string().max(300).optional() }).strict(),
  z.object({ type: z.literal('get-diagnostics'), id: reqId }).strict(),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];

/** Custom background image: the ImageBitmap travels as a transferable alongside the command. */
export const CUSTOM_BACKGROUND = 'custom-background';

export type VisionState = 'idle' | 'loading' | 'ready' | 'failed';

export interface BackgroundStatus {
  mode: 'captured' | 'virtual' | 'custom';
  available: boolean;
  stale: boolean;
  /** Set when live non-person pixels drift from the captured room (camera moved / light changed). */
  drift: boolean;
  personVisible: boolean;
}

export interface EngineStatus {
  enabled: boolean;
  phase: string;
  effectPhase: string;
  activeEffectId: string | null;
  recoveryReason: string | null;
  pipelines: number;
  /** A native (unprocessed) camera track is live although SnapMeet is enabled. */
  needsReacquire: boolean;
  vision: VisionState;
  visionError: string | null;
  background: BackgroundStatus;
  webgl: 'ok' | 'unsupported' | 'lost';
  snap: { tracked: boolean; primed: boolean; coolingDown: boolean; closeness: number | null };
  calibration: { active: boolean; attempts: Array<{ ok: boolean; reason?: string }>; recommendedSensitivity: number | null };
}

export interface Diagnostics {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  quality: string;
  renderFps: number;
  segmentationHz: number;
  handsHz: number;
  /** Median / 95th percentile inference time (worker: round trip). */
  segmentationMs: number;
  segmentationMsP95: number;
  handsMs: number;
  handsMsP95: number;
  pipelineMsP50: number;
  pipelineMsP95: number;
  droppedFrames: number;
  frameSource: string;
  visionDelegate: string | null;
  segmenterLabels: string[];
  /** Fraction of the latest mask classified as person, or null without a mask. */
  personCoverage: number | null;
  errors: string[];
}

export type EngineEvent =
  | { type: 'status'; status: EngineStatus }
  | { type: 'diagnostics'; diagnostics: Diagnostics }
  | { type: 'ack'; id: number; ok: boolean; error?: string }
  | { type: 'need-vision' }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; code: string; message: string }
  | { type: 'gesture'; gesture: 'snap' | 'palms' | 'near-miss'; detail?: string }
  | { type: 'background-preview'; bitmap: ImageBitmap; personVisible: boolean };

/** Parses an untrusted command. Returns null (never throws) when invalid. */
export function parseCommand(data: unknown): Command | null {
  try {
    if (JSON.stringify(data).length > MAX_COMMAND_BYTES) return null;
  } catch {
    return null;
  }
  const r = CommandSchema.safeParse(data);
  return r.success ? r.data : null;
}

export function isHello(data: unknown): data is { kind: typeof HELLO; protocol: string } {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).kind === HELLO &&
    (data as Record<string, unknown>).protocol === PROTOCOL
  );
}
