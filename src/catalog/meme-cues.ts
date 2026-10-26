/** Explicit edit timelines, in milliseconds. Music variants use short excerpts;
 * spoken reactions and the GTA completion sting retain their whole reaction. */
export interface MemeCue { visualMs: number; audioMs: number; audioOffsetMs: number; captionMs: number; }
export const MEME_CUES: Readonly<Record<string, MemeCue>> = {
  'dust-away': { visualMs: 3600, audioMs: 5500, audioOffsetMs: 0, captionMs: 0 },
  'absolute-cinema': { visualMs: 6000, audioMs: 5700, audioOffsetMs: 0, captionMs: 120 },
  'aura-9999': { visualMs: 5000, audioMs: 4700, audioOffsetMs: 0, captionMs: 150 },
  'serial-drama': { visualMs: 4200, audioMs: 3900, audioOffsetMs: 0, captionMs: 1200 },
  'aayein': { visualMs: 1800, audioMs: 700, audioOffsetMs: 0, captionMs: 0 },
  'emotional-damage': { visualMs: 3800, audioMs: 3450, audioOffsetMs: 0, captionMs: 80 },
  'this-is-fine': { visualMs: 6200, audioMs: 5800, audioOffsetMs: 0, captionMs: 400 },
  'mission-passed': { visualMs: 8200, audioMs: 7600, audioOffsetMs: 0, captionMs: 250 },
  'main-character': { visualMs: 6000, audioMs: 5600, audioOffsetMs: 0, captionMs: 150 },
  'plot-twist': { visualMs: 5600, audioMs: 5250, audioOffsetMs: 0, captionMs: 950 },
};
