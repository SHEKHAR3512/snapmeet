import type { HandsSample } from '../gestures/landmarks';
import type { SegmentationOutput, VisionInfo, VisionRuntime, VisionRuntimeOptions } from './types';
import type { FromWorker, ToWorker } from './worker-protocol';

/** Wraps a vision worker as a VisionRuntime. Rejects everything if the worker dies. */
export function createWorkerRuntime(worker: Worker, opts: VisionRuntimeOptions, initTimeoutMs = 25_000): Promise<VisionRuntime> {
  return new Promise((resolve, reject) => {
    let info: VisionInfo | null = null;
    let nextId = 1;
    let dead: string | null = null;
    const pending = new Map<number, { resolve: (m: Extract<FromWorker, { type: 'result' }>) => void; reject: (e: Error) => void }>();
    const post = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

    const fail = (error: string) => {
      dead ??= error;
      for (const p of pending.values()) p.reject(new Error(error));
      pending.clear();
      reject(new Error(error));
    };
    const timer = setTimeout(() => {
      fail('vision worker init timed out');
      worker.terminate();
    }, initTimeoutMs);

    worker.onerror = (e) => {
      e.preventDefault();
      clearTimeout(timer);
      fail(`vision worker error: ${e.message || 'failed to load'}`);
    };
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'ready') {
        clearTimeout(timer);
        info = m.info;
        resolve(runtime);
      } else if (m.type === 'init-error') {
        clearTimeout(timer);
        worker.terminate();
        fail(m.error);
      } else if (m.type === 'result' || m.type === 'error') {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (!p) return;
        if (m.type === 'error') p.reject(new Error(m.error));
        else {
          Object.assign(info!, m.info);
          p.resolve(m);
        }
      }
    };

    const request = (build: (id: number) => [ToWorker, Transferable[]], onDeadFrame?: VideoFrame) => {
      if (dead) {
        onDeadFrame?.close();
        return Promise.reject(new Error(dead));
      }
      const id = nextId++;
      return new Promise<Extract<FromWorker, { type: 'result' }>>((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        const [msg, transfer] = build(id);
        try { post(msg, transfer); } catch (error) {
          pending.delete(id); onDeadFrame?.close(); rej(error as Error);
        }
      });
    };

    const runtime: VisionRuntime = {
      mode: 'worker',
      get info() {
        return info!;
      },
      async segment(frame, ts): Promise<SegmentationOutput | null> {
        const r = await request((id) => [{ type: 'segment', id, frame, ts }, [frame]], frame);
        return r.seg ?? null;
      },
      async ensureHands() {
        await request((id) => [{ type: 'ensure-hands', id }, []]);
      },
      async detectHands(frame, ts): Promise<HandsSample | null> {
        const r = await request((id) => [{ type: 'hands', id, frame, ts }, [frame]], frame);
        return r.hands ?? null;
      },
      close() {
        fail('closed');
        post({ type: 'close' });
        setTimeout(() => worker.terminate(), 500);
      },
    };

    post({ type: 'init', opts });
  });
}

/** Separate workers prevent face/segmentation inference from delaying a snap frame. */
export async function createSplitWorkerRuntime(makeWorker: () => Worker, opts: VisionRuntimeOptions): Promise<VisionRuntime> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => createWorkerRuntime(makeWorker(), { ...opts, taskMode: 'scene' })),
    Promise.resolve().then(() => createWorkerRuntime(makeWorker(), { ...opts, taskMode: 'hands' })),
  ]);
  const scene = results[0]!, hands = results[1]!;
  if (scene.status !== 'fulfilled' || hands.status !== 'fulfilled') {
    for (const result of results) if (result.status === 'fulfilled') result.value.close();
    throw new Error(results.filter(r => r.status === 'rejected').map(r => r.reason).join('; '));
  }
  return {
    mode: 'worker',
    get info() { return { ...scene.value.info, handsLoaded: hands.value.info.handsLoaded }; },
    segment: (frame, ts) => scene.value.segment(frame, ts),
    ensureHands: () => hands.value.ensureHands(),
    detectHands: (frame, ts) => hands.value.detectHands(frame, ts),
    close() { scene.value.close(); hands.value.close(); },
  };
}
