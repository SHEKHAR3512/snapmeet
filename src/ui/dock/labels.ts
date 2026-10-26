import type { EngineStatus } from '../../bridge/protocol';

export type Tone = 'idle' | 'live' | 'busy' | 'alert';

export function phaseLabel(s: EngineStatus | null, connected: boolean): { text: string; tone: Tone } {
  if (!connected || !s) return { text: 'Connecting…', tone: 'idle' };
  if (!s.enabled) return { text: 'Off', tone: 'idle' };
  if (s.phase === 'RECOVERY_REQUIRED') return { text: 'Paused for privacy', tone: 'alert' };
  switch (s.effectPhase) {
    case 'DISINTEGRATING':
      return { text: 'Dusting…', tone: 'busy' };
    case 'VANISHED':
      return { text: 'Vanished', tone: 'busy' };
    case 'REAPPEARING':
      return { text: 'Reappearing…', tone: 'busy' };
    case 'PLAYING':
      return { text: 'Effect playing', tone: 'busy' };
  }
  switch (s.phase) {
    case 'LIVE':
      return { text: 'Live', tone: 'live' };
    case 'CALIBRATING':
      return { text: 'Calibrating', tone: 'busy' };
    case 'LOADING':
      return { text: 'Starting camera…', tone: 'busy' };
    case 'CAMERA_OFF':
      return { text: 'Camera off', tone: 'idle' };
    default:
      return { text: 'Waiting for camera', tone: 'idle' };
  }
}

export const REGION_LABEL: Record<string, string> = { IN: 'India', US: 'USA', GLOBAL: 'Global' };

export const SHORTCUTS = [
  { keys: 'Alt+Shift+S', action: 'Trigger selected effect' },
  { keys: 'Alt+Shift+A', action: 'Reappear / return to camera' },
  { keys: 'Alt+Shift+X', action: 'Reset effects' },
  { keys: 'Alt+Shift+M', action: 'Show / hide controls' },
] as const;
