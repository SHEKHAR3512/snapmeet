import { MemeAudio } from './audio';
import { adoptOutputTrack, adoptStream, endConsumers } from '../bridge/track-adapter';
import type { Command, Diagnostics, EngineEvent, EngineStatus, VisionState } from '../bridge/protocol';
import { BUILTIN_EFFECTS } from '../catalog/builtin';
import { parseDefinitions, type EffectDefinition } from '../catalog/schema';
import { MASK_ENHANCED } from '../effects/registry';
import { SnapCalibration } from '../gestures/calibration';
import { PoseDetector } from '../gestures/pose-detector';
import { PalmsDetector } from '../gestures/palms-detector';
import { SnapDetector, type SnapEvent } from '../gestures/snap-detector';
import { SessionMachine, type SessionSnapshot } from '../session/session';
import { CUSTOM_IMAGE_LIMITS } from '../shared/backgrounds';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import { MaskProcessor, personFraction } from '../vision/mask';
import type { BodyAnchor, FaceAnchor, VisionRuntime } from '../vision/types';
import { BackgroundStore, THUMB_H, THUMB_W, backgroundDrift, lumaThumb } from './background';
import { VideoPipeline, type FramePlan, type PipelineHost } from './pipeline';
import { AdaptiveQuality, QUALITY_PRESETS } from './quality';
import { MASK_FRESH_MS } from './renderer';
import { RateMeter, Samples } from './stats';

export interface EngineDeps {
  loadAudio?(id: string): Promise<ArrayBuffer>;
  loadVision(): Promise<VisionRuntime>;
  emit(ev: EngineEvent, transfer?: Transferable[]): void;
  /** Test hook: use <video>/captureStream instead of the breakout-box APIs. */
  forceFallbackIO?: boolean;
}

type FrameLike = VideoFrame | HTMLVideoElement;

const NOTICE_TEXT: Record<string, string> = {
  disabled: 'SnapMeet is turned off.',
  'not-live': 'Turn your camera on in Meet first.',
  busy: 'That effect is already running.',
  hidden: 'You are vanished — reappear first.',
  calibrating: 'Finish or stop snap calibration first.',
  'recovery-required': 'Press “Return to camera” to continue.',
  camera: 'No SnapMeet camera stream is active.',
  webgl: 'WebGL2 is unavailable, so visual effects are disabled. Your normal camera is still sent.',
  'vision-loading': 'Preparing person segmentation… try again in a moment.',
  'vision-failed': 'Person segmentation could not load, so this effect is unavailable.',
  'mask-warming': 'Finding you in the frame…',
  'no-person': 'No person detected in the frame.',
  background: 'Set up a background first (empty-room capture or a virtual background).',
  'background-stale': 'The captured room no longer matches this camera. Recapture it.',
};

/**
 * Engine: one per page. Owns the session state machine, pipelines, vision scheduling,
 * gestures and backgrounds. Shared by the Meet integration (MAIN world) and the
 * playground (extension page), so both exercise the same code path.
 */
export class Engine implements PipelineHost {
  readonly audio = new MemeAudio(message => { this.pushError(`Audio: ${message}`); this.notice('warn', 'sound', message); }, id => this.deps.loadAudio ? this.deps.loadAudio(id) : Promise.reject(new Error(`Could not load sound ${id}`)));
  private assetBase = new URL('.', location.href).href;
  settings: Settings = { ...DEFAULT_SETTINGS };
  private extensionVersion = '0.0.0';
  private defs = new Map<string, EffectDefinition>(BUILTIN_EFFECTS.map((d) => [d.id, d]));
  private configured = false;
  private configWaiters: Array<() => void> = [];
  readonly session = new SessionMachine({ reappearAfterMs: DEFAULT_SETTINGS.reappearAfterMs });
  readonly pipelines = new Set<VideoPipeline>();
  private primary: VideoPipeline | null = null;
  private passthroughTracks = new Set<MediaStreamTrack>();

  private vision: VisionRuntime | null = null;
  private visionState: VisionState = 'idle';
  private visionError: string | null = null;
  private visionPromise: Promise<void> | null = null;
  private visionFailedAt = 0;
  private handsError: string | null = null;
  private handsLoading = false;
  private handsRetryAt = 0;

  private body: { anchor: BodyAnchor; at: number } | null = null;
  private trackedHands: { at: number; holes: Array<{ x: number; y: number; radius: number }> } | null = null;
  private face: { anchor: FaceAnchor; at: number } | null = null;
  private mask = new MaskProcessor();
  private snap = new SnapDetector({ sensitivity: DEFAULT_SETTINGS.snapSensitivity, aspect: 16 / 9 });
  private poses = new PoseDetector();
  private palms = new PalmsDetector({ aspect: 16 / 9 });
  private calibration = new SnapCalibration(DEFAULT_SETTINGS.snapSensitivity);
  private bg = new BackgroundStore();
  private quality = new AdaptiveQuality(DEFAULT_SETTINGS.quality);
  private segBusy = false;
  private handBusy = false;
  private inferenceEpoch = 0;
  private thumbCanvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  private lastSegAt = -Infinity;
  private lastHandAt = -Infinity;
  private lastDriftAt = -Infinity;
  private pendingCapture = false;
  private pendingTrigger: { id: string; until: number } | null = null;
  private lastPersonFraction: number | null = null;

  private renderRate = new RateMeter();
  private segRate = new RateMeter();
  private handRate = new RateMeter();
  private segMs = new Samples(90);
  private handMs = new Samples(90);
  private frameMs = new Samples(180);
  private errors: string[] = [];
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapFeedbackKey = '';

  constructor(private deps: EngineDeps) {
    this.session.subscribe(s => {
      if (!s.effect || s.phase !== 'LIVE') this.audio.stop();
      this.markDirty();
    });
  }

  // ───────────────────────── configuration ─────────────────────────

  configure(settings: Settings, rawDefinitions: unknown[], extensionVersion: string): void {
    const prev = this.settings;
    this.settings = settings;
    if (prev.enabled !== settings.enabled || prev.poseEnabled !== settings.poseEnabled || prev.snapEnabled !== settings.snapEnabled || prev.palmsEnabled !== settings.palmsEnabled) {
      this.inferenceEpoch++; this.snap.reset(); this.palms.reset(); this.poses.reset();
    }
    this.audio.configure(this.assetBase, settings.enabled && settings.soundEnabled, settings.soundVolume, settings.soundMonitor);
    this.extensionVersion = extensionVersion;
    const defs = parseDefinitions(rawDefinitions, extensionVersion);
    if (defs.length) this.defs = new Map(defs.map((d) => [d.id, d]));
    this.session.setReappearAfter(settings.reappearAfterMs);
    this.session.setEnabled(settings.enabled);
    this.snap.configure({ sensitivity: settings.snapSensitivity });
    if (prev.quality !== settings.quality || prev.autoQuality !== settings.autoQuality || !this.configured) {
      this.quality.setCeiling(settings.quality, settings.autoQuality);
    }
    if (prev.enabled && !settings.enabled) this.session.reset(performance.now());
    if (!this.configured) {
      this.configured = true;
      for (const w of this.configWaiters.splice(0)) w();
    }
    if (this.primary?.state === 'live') this.maybeLoadVision();
    this.markDirty();
  }

  /** Resolves once configuration arrived or the timeout elapsed (fail-open to native camera). */
  whenConfigured(timeoutMs: number): Promise<void> {
    if (this.configured) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.configWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  // ───────────────────────── stream attachment ─────────────────────────

  /** Wraps a real camera stream: processed video track + untouched original audio tracks. */
  attachStream(real: MediaStream): MediaStream {
    const [video, ...extraVideo] = real.getVideoTracks();
    if (!video) return real;
    const p = new VideoPipeline(video, this, this.quality.current, { forceFallbackIO: this.deps.forceFallbackIO });
    adoptOutputTrack(p.output.track, p, {
      released: (pp) => pp.stop('released'),
      enabledChanged: (pp) => {
        const off = pp.allConsumersDisabled;
        if (pp.source.readyState === 'live') pp.source.enabled = !off;
        this.markDirty();
      },
    });
    this.pipelines.add(p);
    this.inferenceEpoch++;
    this.face = null; this.body = null; this.trackedHands = null;
    this.primary = p;
    this.session.cameraStarting();
    p.source.addEventListener('ended', () => p.stop('source-ended'));
    p.start();
    const out = adoptStream(new MediaStream([p.output.track, ...extraVideo, ...real.getAudioTracks()]));
    this.markDirty();
    return out;
  }

  /** Records native camera tracks handed out while disabled (for reacquire guidance). */
  notePassthrough(stream: MediaStream): void {
    for (const t of stream.getVideoTracks()) this.passthroughTracks.add(t);
    this.markDirty();
  }

  // ───────────────────────── PipelineHost ─────────────────────────

  prepare(p: VideoPipeline, frame: FrameLike, width: number, height: number, now: number): FramePlan {
    if (p.allConsumersDisabled) return { kind: 'paused' };
    const q = this.quality.current;
    if (p === this.primary) {
      this.snap.configure({ aspect: width / Math.max(1, height) });
      this.palms.configure({ aspect: width / Math.max(1, height) });
      this.session.tick(now);
      if (this.settings.enabled) {
        this.runInference(frame, now);
        if (this.pendingCapture) this.captureFrom(p, frame, width, height);
        this.checkDrift(frame, now);
        this.retryPendingTrigger(now);
      }
    }
    const s = this.session.snapshot;
    if (s.phase === 'RECOVERY_REQUIRED') return { kind: 'safe', quality: q };
    const m = this.mask.snapshot;
    return {
      kind: 'render',
      quality: q,
      lockSize: s.effectPhase !== 'IDLE',
      state: {
        now,
        body: this.body && now - this.body.at < 450 ? this.body.anchor : null,
        hands: this.trackedHands && now - this.trackedHands.at < 200 ? this.trackedHands.holes : [],
        face: this.face && now - this.face.at < 350 ? this.face.anchor : null,
        session: s,
        mask: m && now - m.at < 1500 ? m : null,
        background: this.settings.enabled
          ? this.bg.snapshotFor(this.settings.backgroundMode, this.settings.virtualBackgroundId, p)
          : null,
        reducedMotion: this.settings.reducedMotion,
        quality: q,
        proof: this.settings.enabled && this.settings.proofMode,
      },
    };
  }

  onRendered(p: VideoPipeline, costMs: number, now: number): void {
    if (p !== this.primary) return;
    this.renderRate.tick(now);
    this.frameMs.push(costMs);
    if (this.settings.autoQuality && this.frameMs.mean() > 0) {
      const fps = p.source.getSettings().frameRate || 30;
      const changed = this.quality.observe(
        this.frameMs.percentile(95),
        (1000 / fps) * 0.85,
        now,
        this.session.snapshot.effectPhase !== 'IDLE',
      );
      if (changed) {
        this.frameMs.clear();
        this.notice('info', 'quality', `Quality adjusted to ${changed} to keep video smooth.`);
      }
    }
    const fb = this.snap.lastFeedback;
    const key = `${fb.tracked}|${fb.primed}|${fb.coolingDown}|${fb.closeness === null ? '-' : Math.round(fb.closeness * 10)}`;
    if (key !== this.lastSnapFeedbackKey) {
      this.lastSnapFeedbackKey = key;
      this.markDirty();
    }
  }

  onRenderFailure(p: VideoPipeline, error: unknown, now: number): 'safe' | 'passthrough' {
    const msg = `Renderer: ${String((error as Error)?.message ?? error)}`;
    if (this.errors[this.errors.length - 1] !== msg) this.pushError(msg);
    if (p === this.primary) this.session.fail(now, 'renderer-failed');
    this.markDirty();
    return this.session.snapshot.phase === 'RECOVERY_REQUIRED' ? 'safe' : 'passthrough';
  }

  onFirstFrame(p: VideoPipeline): void {
    const aspect = p.sourceWidth / p.sourceHeight || 16 / 9;
    this.snap.configure({ aspect });
    this.palms.configure({ aspect });
    if (p === this.primary) this.session.cameraLive(performance.now());
    this.maybeLoadVision();
    this.audio.preload();
    this.markDirty();
  }

  onStopped(p: VideoPipeline, reason: string): void {
    this.inferenceEpoch++;
    this.pipelines.delete(p);
    if (reason === 'source-ended') endConsumers(p);
    if (this.primary === p) {
      this.primary = [...this.pipelines].reverse().find((x) => x.state !== 'stopped') ?? null;
    }
    if (!this.primary) {
      this.session.cameraStopped(performance.now());
      this.face = null; this.body = null; this.trackedHands = null;
      this.mask.reset();
      this.snap.reset();
      this.palms.reset();
      this.poses.reset();
      this.calibration.stop();
      this.pendingTrigger = null;
      this.pendingCapture = false;
    }
    this.markDirty();
  }

  // ───────────────────────── commands ─────────────────────────

  handleCommand(cmd: Command): { ok: boolean; error?: string } {
    const now = performance.now();
    switch (cmd.type) {
      case 'config':
        this.assetBase = cmd.assetBase;
        this.configure(cmd.settings, cmd.definitions, cmd.extensionVersion);
        return { ok: true };
      case 'trigger':
        return this.trigger(cmd.effectId, 'manual');
      case 'reappear':
        return { ok: this.session.reappear(now) };
      case 'reset':
        this.inferenceEpoch++;
        this.poses.reset(); this.palms.reset();
        this.pendingTrigger = null;
        this.snap.reset();
        this.session.reset(now);
        return { ok: true };
      case 'capture-background':
        if (!this.primary || this.primary.state !== 'live') return { ok: false, error: NOTICE_TEXT['not-live'] };
        this.pendingCapture = true;
        this.maybeLoadVision(true);
        return { ok: true };
      case 'clear-background':
        this.bg.clearCaptured();
        this.markDirty();
        return { ok: true };
      case 'calibration':
        this.inferenceEpoch++; this.poses.reset(); this.palms.reset();
        if (cmd.action === 'start') {
          if (!this.session.startCalibration()) return { ok: false, error: 'Calibration needs a live camera and no active effect.' };
          this.calibration.start(this.settings.snapSensitivity);
          this.snap.reset();
          this.maybeLoadVision(true);
        } else {
          this.calibration.stop();
          this.session.stopCalibration();
        }
        this.markDirty();
        return { ok: true };
      case 'vision-injected':
        // Informational: the loader awaits the registration event itself.
        if (!cmd.ok) this.failVision(cmd.error ?? 'injection failed');
        return { ok: true };
      case 'get-diagnostics':
        this.deps.emit({ type: 'diagnostics', diagnostics: this.diagnostics() });
        return { ok: true };
    }
  }

  setCustomBackground(bitmap: unknown): { ok: boolean; error?: string } {
    if (!(bitmap instanceof ImageBitmap)) return { ok: false, error: 'Not an image' };
    const max = CUSTOM_IMAGE_LIMITS.maxDimension;
    if (bitmap.width < 16 || bitmap.height < 16 || bitmap.width > max || bitmap.height > max) {
      bitmap.close();
      return { ok: false, error: 'Image dimensions are out of range' };
    }
    this.bg.setCustom(bitmap);
    this.markDirty();
    return { ok: true };
  }

  trigger(effectId: string, source: 'manual' | 'snap' | 'palms'): { ok: boolean; error?: string } {
    const original = this.defs.get(effectId);
    const def = original ? { ...original, durationMs: this.audio.duration(effectId, original.durationMs) } : undefined;
    if (!def) return { ok: false, error: `Unknown effect ${effectId}` };
    const now = performance.now();
    const found: { missing: string | null } = { missing: null };
    const r = this.session.trigger(def, now, () => (found.missing = this.missingRequirement(def, now)));
    if (r.ok) {
      void this.audio.play(def.id, def.durationMs);
      this.pendingTrigger = null;

      return { ok: true };
    }
    const code: string = r.reason === 'missing-requirement' ? (found.missing ?? 'camera') : r.reason;
    if (code === 'mask-warming' || code === 'vision-loading') {
      this.pendingTrigger = { id: effectId, until: now + (code === 'vision-loading' ? 15_000 : 1500) };
    }
    const text = NOTICE_TEXT[code] ?? code;
    if (source === 'manual' || code === 'background') {
      this.notice(code === 'mask-warming' ? 'info' : 'warn', code === 'background' || code === 'background-stale' ? 'needs-setup' : code, text);
    }
    return { ok: false, error: text };
  }

  private missingRequirement(def: EffectDefinition, now: number): string | null {
    const p = this.primary;
    if (!p || p.state !== 'live') return 'camera';
    if (p.webgl !== 'ok') return 'webgl';
    if (def.requires.includes('background') && !this.bg.available(this.settings.backgroundMode, p)) {
      return this.settings.backgroundMode === 'captured' && this.bg.captured ? 'background-stale' : 'background';
    }
    if (def.requires.includes('person-mask')) {
      if (this.visionState === 'failed') return 'vision-failed';
      if (this.visionState !== 'ready') {
        this.maybeLoadVision(true);
        return 'vision-loading';
      }
      const m = this.mask.snapshot;
      if (!m || now - m.at > MASK_FRESH_MS) return 'mask-warming';
      if (m.info.coverage < 0.01) return 'no-person';
    }
    return null;
  }

  private retryPendingTrigger(now: number): void {
    const pt = this.pendingTrigger;
    if (!pt) return;
    if (now > pt.until) {
      this.pendingTrigger = null;
      return;
    }
    const m = this.mask.snapshot;
    if (this.visionState === 'ready' && m && now - m.at <= MASK_FRESH_MS) {
      this.pendingTrigger = null;
      this.trigger(pt.id, 'manual');
    }
  }

  // ───────────────────────── vision ─────────────────────────

  private visionWanted(): boolean {
    if (!this.settings.enabled) return false;
    const s = this.settings;
    const needsMask = (id: string) => {
      const d = this.defs.get(id);
      return !!d && (d.requires.includes('person-mask') || MASK_ENHANCED.has(d.template));
    };
    return s.poseEnabled || s.snapEnabled || s.palmsEnabled || needsMask(s.selectedEffectId) || this.defs.has(s.selectedEffectId) || s.backgroundMode === 'captured';
  }

  private maybeLoadVision(force = false): void {
    if (!force && !this.visionWanted()) return;
    if (!this.primary || this.visionPromise) {
      if (this.visionState === 'ready') this.maybeLoadHands();
      return;
    }
    if (this.visionState === 'failed' && performance.now() - this.visionFailedAt < 30_000) return;
    this.visionState = 'loading';
    this.visionError = null;
    this.markDirty();
    this.visionPromise = this.deps
      .loadVision()
      .then((v) => {
        this.vision = v;
        this.visionState = 'ready';
        // Model warm-up stalls must not count against the quality budget.
        this.frameMs.clear();
        this.quality.resetTimers();
        this.maybeLoadHands();
        this.markDirty();
      })
      .catch((e) => {
        this.visionPromise = null;
        this.failVision(String((e as Error)?.message ?? e));
      });
  }

  private maybeLoadHands(): void {
    const v = this.vision;
    if (!v || v.info.handsLoaded || this.handsLoading || performance.now() < this.handsRetryAt) return;
    if (!(this.settings.poseEnabled || this.settings.snapEnabled || this.settings.palmsEnabled || this.calibration.snapshot.active)) return;
    this.handsLoading = true;
    v.ensureHands().then(
      () => { this.handsLoading = false; this.handsError = null; this.markDirty(); },
      (e) => {
        this.handsLoading = false; this.handsRetryAt = performance.now() + 3000;
        this.handsError = String((e as Error)?.message ?? e);
        this.pushError(`Hand tracking: ${this.handsError}`);
        this.markDirty();
      },
    );
  }

  private failVision(error: string): void {
    this.visionState = 'failed';
    this.visionError = error;
    this.visionFailedAt = performance.now();
    this.pushError(`Vision: ${error}`);
    this.notice('error', 'vision-failed', 'Person segmentation failed to load. Mask-based effects are unavailable; other effects still work.');
    this.markDirty();
  }

  private segmentationNeeded(s: SessionSnapshot): boolean {
    if (this.pendingCapture || this.pendingTrigger) return true;
    if (s.phase === 'LIVE' && (s.effectPhase === 'IDLE' || s.effectPhase === 'PLAYING')) return true;
    if (s.phase === 'CALIBRATING') return false;
    switch (s.effectPhase) {
      case 'DISINTEGRATING':
        return false;
      case 'VANISHED':
      case 'REAPPEARING':
        return true;
      case 'PLAYING':
        return s.effect ? MASK_ENHANCED.has(s.effect.template) : false;
      case 'IDLE': {
        const ids = [this.settings.selectedEffectId];
        if (this.settings.snapEnabled) ids.push(this.settings.snapEffectId);
        return (
          ids.some((id) => {
            const d = this.defs.get(id);
            return !!d && (d.requires.includes('person-mask') || MASK_ENHANCED.has(d.template));
          }) ||
          (this.settings.backgroundMode === 'captured' && !!this.bg.captured)
        );
      }
    }
  }

  private handsNeeded(s: SessionSnapshot): boolean {
    if (!this.vision?.info.handsLoaded) return false;
    if (s.phase === 'CALIBRATING') return true;
    return (this.settings.poseEnabled || this.settings.snapEnabled || this.settings.palmsEnabled) && s.phase === 'LIVE';
  }

  /**
   * Submits at most one in-flight request per model; frames arriving while a model is busy
   * are simply not submitted (no queue). Results update the shared mask / gesture state
   * and are used by the following frames.
   */
  private runInference(frame: FrameLike, now: number): void {
    if (this.visionState === 'failed') this.maybeLoadVision();
    this.maybeLoadHands();
    const v = this.vision;
    if (!v || this.visionState !== 'ready') return;
    const epoch = this.inferenceEpoch;
    const s = this.session.snapshot;
    const preset = QUALITY_PRESETS[this.quality.current];
    const segInterval = s.effectPhase === 'VANISHED' ? 200 : Math.max(100, preset.segIntervalMs);
    if (!this.handBusy && this.handsNeeded(s) && now - this.lastHandAt >= 30) {
      this.lastHandAt = now;
      this.handBusy = true;
      const t0 = performance.now();
      v.detectHands(toVideoFrame(frame, now), now)
        .then((sample) => {
          if (this.vision !== v || epoch !== this.inferenceEpoch || !this.settings.enabled) return;
          this.handMs.push(performance.now() - t0);
          this.handRate.tick(performance.now());
          if (sample) this.onHands(sample);
        })
        .catch((e) => this.onInferenceError(v, e))
        .finally(() => (this.handBusy = false));
    }
    if (!this.segBusy && this.segmentationNeeded(s) && now - this.lastSegAt >= segInterval) {
      this.lastSegAt = now;
      this.segBusy = true;
      const t0 = performance.now();
      v.segment(toVideoFrame(frame, now), now)
        .then((out) => {
          if (this.vision !== v || epoch !== this.inferenceEpoch || !this.settings.enabled) return;
          this.segMs.push(performance.now() - t0);
          this.segRate.tick(performance.now());
          if (out) {
            this.body = out.body ? { anchor: out.body, at: now } : null;
            if (out.face && this.face && now - this.face.at < 250) {
              const previous = this.face.anchor, next = out.face;
              const blend = (a: number, b: number) => a + (b - a) * 0.65;
              const pair = (a: [number, number], b: [number, number]): [number, number] => [blend(a[0], b[0]), blend(a[1], b[1])];
              this.face = { at: now, anchor: { eyes: pair(previous.eyes, next.eyes), chin: pair(previous.chin, next.chin), forehead: pair(previous.forehead, next.forehead), width: blend(previous.width, next.width), height: blend(previous.height, next.height), rotation: blend(previous.rotation, next.rotation) } };
            } else this.face = out.face ? { anchor: out.face, at: now } : null;
            this.mask.update(out.confidence, out.width, out.height, now);
            this.lastPersonFraction = personFraction(out.confidence);
          }
        })
        .catch((e) => this.onInferenceError(v, e))
        .finally(() => (this.segBusy = false));
    }
  }

  private onInferenceError(v: VisionRuntime, e: unknown): void {
    if (this.vision !== v) return;
    this.vision = null;
    this.visionPromise = null;
    try {
      v.close();
    } catch {
      // ignore
    }
    this.failVision(`inference error: ${String((e as Error)?.message ?? e)}`);
  }

  private onHands(sample: { t: number; hands: Parameters<SnapDetector['push']>[0]['hands'] }): void {
    const aspectRatio = this.primary ? this.primary.sourceWidth / this.primary.sourceHeight : 16 / 9;
    this.trackedHands = { at: sample.t, holes: sample.hands.filter(h => h.landmarks.length >= 21).map(h => {
      const wrist = h.landmarks[0]!, middle = h.landmarks[9]!;
      return { x: middle.x, y: middle.y,
        radius: Math.hypot((middle.x - wrist.x) * aspectRatio, middle.y - wrist.y) * 1.25 };
    }) };
    if (this.calibration.snapshot.active) {
      for (const ev of this.snap.push(sample)) this.onSnapEvent(ev);
      return;
    }
    for (const ev of this.snap.push(sample)) if (this.settings.snapEnabled && this.session.snapshot.effectPhase === 'IDLE') this.onSnapEvent(ev);
    if (this.settings.poseEnabled && this.settings.snapEnabled && this.snap.reservesPose(sample.t)) {
      this.poses.reset();
      return;
    }
    if (this.settings.poseEnabled) {
      const aspect = this.primary ? this.primary.sourceWidth / this.primary.sourceHeight : 16 / 9;
      const id = this.poses.push(sample, aspect);
      if (id === 'absolute-cinema' && this.session.snapshot.effectPhase === 'VANISHED') this.session.reappear(performance.now());
      if (id && this.session.snapshot.effectPhase === 'IDLE' && (id !== 'absolute-cinema' || this.settings.palmsEnabled)) {
        this.deps.emit({ type: 'gesture', gesture: 'pose', detail: this.defs.get(id)?.title ?? id });
        this.trigger(id, 'palms');
      }
    }
    if (!this.settings.poseEnabled && this.settings.palmsEnabled && this.session.snapshot.phase === 'LIVE' && this.palms.push(sample)) {
      const cinema = [...this.defs.values()].find((d) => d.template === 'cinema');
      this.deps.emit({ type: 'gesture', gesture: 'palms' });
      if (this.session.snapshot.effectPhase === 'VANISHED') this.session.reappear(performance.now());
      else if (cinema && this.session.snapshot.effectPhase === 'IDLE') this.trigger(cinema.id, 'palms');
    }
  }

  private onSnapEvent(ev: SnapEvent): void {
    if (this.calibration.snapshot.active) {
      if (this.calibration.record(ev)) {
        if (!this.calibration.snapshot.active) this.session.stopCalibration();
        this.markDirty();
      }
      this.deps.emit({ type: 'gesture', gesture: ev.type, detail: ev.type === 'near-miss' ? ev.reason : undefined });
      return;
    }
    this.deps.emit({ type: 'gesture', gesture: ev.type, detail: ev.type === 'near-miss' ? ev.reason : undefined });
    if (ev.type === 'snap' && this.settings.snapEnabled) this.trigger(this.settings.snapEffectId, 'snap');
  }

  // ───────────────────────── backgrounds ─────────────────────────

  private captureFrom(p: VideoPipeline, frame: FrameLike, w: number, h: number): void {
    this.pendingCapture = false;
    const copy = frame instanceof VideoFrame ? frame.clone() : frame;
    const thumbCtx = this.thumbCanvas.getContext('2d', { willReadFrequently: true });
    let thumb: Float32Array = new Float32Array(THUMB_W * THUMB_H);
    if (thumbCtx) {
      thumbCtx.drawImage(frame, 0, 0, THUMB_W, THUMB_H);
      thumb = lumaThumb(thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H).data);
    }
    // Segmentation ran this frame when vision is ready (pendingCapture forces it).
    const fraction = this.visionState === 'ready' ? this.lastPersonFraction : null;
    createImageBitmap(copy)
      .then(async (bitmap) => {
        this.bg.setCaptured({ bitmap, width: w, height: h, deviceId: p.deviceId, personFraction: fraction, thumb });
        const preview = await createImageBitmap(bitmap, { resizeWidth: 320, resizeQuality: 'medium' });
        const personVisible = fraction !== null && fraction > 0.02;
        this.deps.emit({ type: 'background-preview', bitmap: preview, personVisible }, [preview]);
        this.markDirty();
      })
      .catch((e) => this.notice('error', 'capture-failed', `Background capture failed: ${String(e)}`))
      .finally(() => {
        if (copy instanceof VideoFrame) copy.close();
      });
  }

  private checkDrift(frame: FrameLike, now: number): void {
    const c = this.bg.captured;
    const s = this.session.snapshot;
    if (!c || this.settings.backgroundMode !== 'captured' || s.effectPhase !== 'IDLE' || now - this.lastDriftAt < 2000) return;
    this.lastDriftAt = now;
    const ctx = this.thumbCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(frame, 0, 0, THUMB_W, THUMB_H);
    const m = this.mask.snapshot;
    const d = backgroundDrift(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data, c.thumb, m && now - m.at < 1500 ? m : null);
    if (d === null) return;
    const drift = this.bg.drift ? d > 0.06 : d > 0.1;
    if (drift !== this.bg.drift) {
      this.bg.drift = drift;
      this.markDirty();
    }
  }

  // ───────────────────────── status ─────────────────────────

  status(): EngineStatus {
    for (const t of this.passthroughTracks) if (t.readyState === 'ended') this.passthroughTracks.delete(t);
    const s = this.session.snapshot;
    const p = this.primary;
    const fb = this.snap.lastFeedback;
    const cal = this.calibration.snapshot;
    return {
      enabled: this.settings.enabled,
      phase: s.phase,
      effectPhase: s.effectPhase,
      activeEffectId: s.effect?.effectId ?? null,
      recoveryReason: s.recoveryReason,
      pipelines: this.pipelines.size,
      needsReacquire: this.settings.enabled && this.passthroughTracks.size > 0,
      vision: this.visionState,
      visionError: this.visionError ?? this.handsError,
      background: {
        mode: this.settings.backgroundMode,
        available: this.bg.available(this.settings.backgroundMode, p),
        stale: this.bg.isStale(p),
        drift: this.bg.drift,
        personVisible: (this.bg.captured?.personFraction ?? 0) > 0.02,
      },
      webgl: p?.webgl ?? 'ok',
      snap: { ...fb },
      calibration: { active: cal.active, attempts: [...cal.attempts], recommendedSensitivity: cal.recommendedSensitivity },
    };
  }

  diagnostics(): Diagnostics {
    const now = performance.now();
    const p = this.primary;
    return {
      sourceWidth: p?.sourceWidth ?? 0,
      sourceHeight: p?.sourceHeight ?? 0,
      outputWidth: p?.outWidth ?? 0,
      outputHeight: p?.outHeight ?? 0,
      quality: this.quality.current,
      renderFps: round1(this.renderRate.rate(now)),
      segmentationHz: round1(this.segRate.rate(now)),
      handsHz: round1(this.handRate.rate(now)),
      segmentationMs: round1(this.segMs.percentile(50)),
      segmentationMsP95: round1(this.segMs.percentile(95)),
      handsMs: round1(this.handMs.percentile(50)),
      handsMsP95: round1(this.handMs.percentile(95)),
      pipelineMsP50: round1(this.frameMs.percentile(50)),
      pipelineMsP95: round1(this.frameMs.percentile(95)),
      droppedFrames: p?.output.dropped ?? 0,
      frameSource: p ? `${p.frameSource.kind} → ${p.output.kind}` : 'none',
      visionDelegate: this.vision ? `${this.vision.info.delegate}, ${this.vision.mode}` : null,
      segmenterLabels: this.vision ? [...this.vision.info.segmenterLabels, `person mask: ${this.vision.info.personMaskRule}`] : [],
      personCoverage: this.mask.snapshot ? Math.round(this.mask.snapshot.info.coverage * 1000) / 1000 : null,
      audio: this.audio.status,
      errors: [...this.errors],
    };
  }

  /** Read-only counters for automated tests (no frames, devices or meeting data). */
  debugCounters(): { pipelines: number; liveSources: number; consumers: number; phase: string; effectPhase: string } {
    let live = 0;
    let consumers = 0;
    for (const p of this.pipelines) {
      if (p.source.readyState === 'live') live++;
      consumers += p.consumers.size;
    }
    const s = this.session.snapshot;
    return { pipelines: this.pipelines.size, liveSources: live, consumers, phase: s.phase, effectPhase: s.effectPhase };
  }

  private notice(level: 'info' | 'warn' | 'error', code: string, message: string): void {
    this.deps.emit({ type: 'notice', level, code, message });
  }

  private pushError(msg: string): void {
    this.errors.push(msg.slice(0, 300));
    if (this.errors.length > 10) this.errors.shift();
  }

  /** Coalesces status emissions (also used after the controller connects). */
  markDirty(): void {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.deps.emit({ type: 'status', status: this.status() });
    }, 50);
  }
}

/** A VideoFrame the vision runtime can own (and transfer to its worker). */
function toVideoFrame(frame: FrameLike, now: number): VideoFrame {
  return frame instanceof VideoFrame ? frame.clone() : new VideoFrame(frame, { timestamp: Math.round(now * 1000) });
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

