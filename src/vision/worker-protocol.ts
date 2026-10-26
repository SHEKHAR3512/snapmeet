import type { HandsSample } from '../gestures/landmarks';
import type { SegmentationOutput, VisionInfo, VisionRuntimeOptions } from './types';

export type ToWorker =
  | { type: 'init'; opts: VisionRuntimeOptions }
  | { type: 'segment'; id: number; frame: VideoFrame; ts: number }
  | { type: 'hands'; id: number; frame: VideoFrame; ts: number }
  | { type: 'ensure-hands'; id: number }
  | { type: 'close' };

export type FromWorker =
  | { type: 'ready'; info: VisionInfo }
  | { type: 'init-error'; error: string }
  | { type: 'result'; id: number; info: VisionInfo; seg?: SegmentationOutput | null; hands?: HandsSample | null }
  | { type: 'error'; id: number; error: string };
