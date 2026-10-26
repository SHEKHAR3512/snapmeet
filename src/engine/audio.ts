import { MEME_CUES } from '../catalog/meme-cues';
import { adoptStream } from '../bridge/track-adapter';

const SOUND_IDS = ['dust-away', 'absolute-cinema', 'aura-9999', 'serial-drama', 'aayein', 'emotional-damage', 'this-is-fine', 'mission-passed', 'main-character', 'plot-twist'];

/** A single local sound bus mixed into each microphone acquired by Meet. */
export class MemeAudio {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private base = '';
  private volume = 0.65;
  private enabled = false;
  private monitor = true;
  private monitorGain: GainNode | null = null;
  private error: string | null = null;
  private ready = new Map<string, AudioBuffer>();
  private outputs = new Set<MediaStreamTrack>();
  private mixed = new WeakSet<MediaStreamTrack>();
  private attached = new WeakMap<MediaStreamTrack, MediaStreamTrack>();
  constructor(private report: (message: string) => void, private loadAsset?: (id: string) => Promise<ArrayBuffer>) {
    const unlock = () => { if (this.enabled) void this.unlock().catch(() => {}); };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('pagehide', () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      this.stop(); void this.context?.close();
    }, { once: true });
  }

  get status() {
    return { state: this.context?.state ?? 'idle', ready: this.ready.size,
      outputs: [...this.outputs].filter(t => t.readyState === 'live').length,
      transmitting: [...this.outputs].some(t => t.readyState === 'live' && t.enabled),
      error: this.error, monitor: this.monitor };
  }
  duration(id: string, fallback: number): number {
    return MEME_CUES[id]?.visualMs ?? fallback;
  }
  owns(track: MediaStreamTrack): boolean { return this.mixed.has(track); }
  async unlock(): Promise<void> {
    const ctx = this.init();
    if (ctx.state === 'running') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ctx.resume(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Click anywhere in the page to enable meme audio.')), 1500);
      })]);
      if (ctx.state !== 'running') throw new Error('Click anywhere in the page to enable meme audio.');
    } finally { clearTimeout(timer); }
  }

  configure(base: string, enabled: boolean, volume: number, monitor = true): void {
    if (base !== this.base) { this.base = base; this.buffers.clear(); this.ready.clear(); }
    this.enabled = enabled;
    this.volume = volume;
    this.monitor = monitor;
    if (this.monitorGain) this.monitorGain.gain.value = monitor ? 0.55 : 0;
    if (this.bus) this.bus.gain.value = enabled ? volume : 0;
    if (!enabled) this.stop();
    else this.preload();
  }
  private init(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.bus = this.context.createGain();
      this.bus.gain.value = this.enabled ? this.volume : 0;
      // Only meme clips go to speakers. The microphone never connects here.
      this.monitorGain = this.context.createGain();
      this.monitorGain.gain.value = this.monitor ? 0.55 : 0;
      this.bus.connect(this.monitorGain);
      this.monitorGain.connect(this.context.destination);
    }
    return this.context;
  }
  private load(id: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(id);
    if (!pending) {
      const ctx = this.init();
      pending = (async () => {
        let bytes: ArrayBuffer;
        try {
          const response = await fetch(`${this.base}audio/${id}.mp3`, { signal: AbortSignal.timeout(4000) });
          if (!response.ok) throw new Error(`Sound ${id} could not load (${response.status})`);
          bytes = await response.arrayBuffer();
        } catch (error) {
          if (!this.loadAsset) throw error;
          bytes = await this.loadAsset(id);
        }
        const buffer = await ctx.decodeAudioData(bytes);
        this.ready.set(id, buffer);
        return buffer;
      })();
      this.buffers.set(id, pending);
      void pending.catch(() => this.buffers.delete(id));
    }
    return pending;
  }
  preload(): void {
    if (!this.base || !this.enabled) return;
    for (const id of SOUND_IDS) void this.load(id).catch(error => {
      this.error = String((error as Error).message);
      this.report(this.error);
    });
  }
  stop(): void {
    this.generation++;
    try { this.source?.stop(); } catch { /* already ended */ }
    this.source?.disconnect(); this.source = null;
  }
  async play(id: string, durationMs: number): Promise<void> {
    this.stop();
    if (!this.enabled || !this.base || !SOUND_IDS.includes(id)) return;
    const generation = this.generation;
    this.error = null;
    try {
      const ctx = this.init();
      await this.unlock();
      const buffer = await this.load(id);
      if (generation !== this.generation || !this.enabled) return;
      const cue = MEME_CUES[id];
      const offset = (cue?.audioOffsetMs ?? 0) / 1000;
      const duration = Math.min(buffer.duration - offset, (cue?.audioMs ?? durationMs) / 1000);
      if (duration <= 0) return;
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const fade = ctx.createGain();
      source.connect(fade); fade.connect(this.bus!);
      const start = ctx.currentTime + 0.01;
      fade.gain.setValueAtTime(1, start);
      // Fade musical tails without clipping the first syllable or the initial impact.
      if (duration > 1) {
        fade.gain.setValueAtTime(1, start + duration - 0.12);
        fade.gain.linearRampToValueAtTime(0, start + duration);
      }
      source.start(start, offset, duration);
      source.onended = () => { source.disconnect(); fade.disconnect(); if (this.source === source) this.source = null; };
      this.source = source;
    } catch (error) { this.error = String((error as Error).message); this.report(this.error); }
  }

  async attach(stream: MediaStream): Promise<MediaStream> {
    const tracks = stream.getAudioTracks();
    if (!tracks.length) return stream;
    const ctx = this.init();
    // Never return a silent microphone backed by a suspended audio context.
    await this.unlock();
    const mixed = tracks.map(real => {
      if (this.mixed.has(real)) return real;
      const existing = this.attached.get(real);
      if (existing?.readyState === 'live') return existing;
      const input = ctx.createMediaStreamSource(new MediaStream([real]));
      const destination = ctx.createMediaStreamDestination();
      const soundGate = ctx.createGain();
      soundGate.gain.value = real.enabled ? 1 : 0;
      input.connect(destination); this.bus!.connect(soundGate); soundGate.connect(destination);
      const consumers = new Set<MediaStreamTrack>();
      const native = MediaStreamTrack.prototype;
      const enabled = Object.getOwnPropertyDescriptor(native, 'enabled')!;
      let closed = false;
      let watchSource: ReturnType<typeof setInterval> | undefined;
      const cleanup = () => {
        if (closed) return;
        closed = true; clearInterval(watchSource);
        input.disconnect(); this.bus?.disconnect(soundGate); soundGate.disconnect(); real.stop();
      };
      const adopt = (track: MediaStreamTrack): MediaStreamTrack => {
        consumers.add(track);
        this.outputs.add(track); this.mixed.add(track);
        const def = (name: string, value: unknown) => Object.defineProperty(track, name, { configurable: true, value });
        def('stop', () => {
          native.stop.call(track); consumers.delete(track); this.outputs.delete(track);
          if (!consumers.size) cleanup();
          else real.enabled = [...consumers].some(t => t.enabled);
        });
        def('clone', () => { const clone = native.clone.call(track); return track.readyState === 'live' ? adopt(clone) : clone; });
        def('getSettings', () => ({ ...real.getSettings(), ...native.getSettings.call(track), deviceId: real.getSettings().deviceId }));
        def('getCapabilities', () => real.getCapabilities());
        def('getConstraints', () => real.getConstraints());
        def('applyConstraints', (constraints?: MediaTrackConstraints) => real.applyConstraints(constraints));
        Object.defineProperty(track, 'label', { configurable: true, get: () => real.label });
        Object.defineProperty(track, 'enabled', {
          configurable: true, get: () => enabled.get!.call(track) as boolean,
          set: (value: boolean) => { enabled.set!.call(track, value); real.enabled = [...consumers].some(t => t.enabled); },
        });
        return track;
      };
      const end = () => {
        for (const track of consumers) { native.stop.call(track); track.dispatchEvent(new Event('ended')); }
        for (const track of consumers) this.outputs.delete(track);
        consumers.clear(); cleanup();
      };
      real.addEventListener('ended', end, { once: true });
      // Meet may retain the pre-mixer source reference and mute/stop that track.
      // Native stop() does not dispatch 'ended', so also watch its actual state.
      watchSource = setInterval(() => {
        soundGate.gain.value = real.enabled && real.readyState === 'live' ? 1 : 0;
        if (real.readyState === 'ended') end();
      }, 80);
      const output = destination.stream.getAudioTracks()[0]!;
      output.enabled = real.enabled;
      this.attached.set(real, output);
      return adopt(output);
    });
    const output = new MediaStream([...stream.getVideoTracks(), ...mixed]);
    return adoptStream(output);
  }
}
