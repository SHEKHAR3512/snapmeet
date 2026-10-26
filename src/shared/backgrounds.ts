/**
 * Bundled virtual backgrounds, painted procedurally (original artwork, no image files).
 * The same painters render full-size backgrounds in the engine and thumbnails in the UI.
 */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VirtualBackground {
  id: string;
  title: string;
  paint(ctx: Ctx, w: number, h: number): void;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const VIRTUAL_BACKGROUNDS: VirtualBackground[] = [
  {
    id: 'studio-charcoal',
    title: 'Studio charcoal',
    paint(ctx, w, h) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.4, h * 0.05, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      g.addColorStop(0, '#4a4f57');
      g.addColorStop(1, '#141619');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sunset-glow',
    title: 'Sunset glow',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ff9f5a');
      g.addColorStop(0.55, '#c8456c');
      g.addColorStop(1, '#3a1d4c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255, 236, 200, 0.55)';
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.42, h * 0.14, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'mint-room',
    title: 'Mint room',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#e3f4ec');
      g.addColorStop(0.68, '#b4dccd');
      g.addColorStop(0.68, '#8fc3b1');
      g.addColorStop(1, '#79ad9b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(w * 0.08, h * 0.12, w * 0.22, h * 0.36);
    },
  },
  {
    id: 'night-city',
    title: 'Night bokeh',
    paint(ctx, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0b1230');
      g.addColorStop(1, '#1d2a52');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const rnd = seeded(42);
      const colors = ['255,196,92', '255,120,160', '120,190,255', '255,240,210'];
      for (let i = 0; i < 46; i++) {
        const r = h * (0.02 + rnd() * 0.07);
        ctx.fillStyle = `rgba(${colors[i % colors.length]},${0.12 + rnd() * 0.3})`;
        ctx.beginPath();
        ctx.arc(rnd() * w, h * (0.15 + rnd() * 0.7), r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'paper-white',
    title: 'Paper white',
    paint(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, '#f4f2ed');
      g.addColorStop(1, '#d9d5cc');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'chroma-green',
    title: 'Chroma green',
    paint(ctx, w, h) {
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(0, 0, w, h);
    },
  },
];

export function findVirtualBackground(id: string): VirtualBackground {
  return VIRTUAL_BACKGROUNDS.find((b) => b.id === id) ?? VIRTUAL_BACKGROUNDS[0]!;
}

export const CUSTOM_IMAGE_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxDimension: 4096,
  types: ['image/png', 'image/jpeg', 'image/webp'],
  /** Decoded images are downscaled so the longest side is at most this. */
  targetMaxSide: 1920,
} as const;
