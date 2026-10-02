import type { WorldData } from './types';
import type { WorldGenRequest, WorldGenResponse } from '../workers/worldgen.worker';

/** Runs procedural generation off the main thread so the UI stays responsive. */
export function generateWorldAsync(seed: number, onProgress: (stage: string, f: number) => void): Promise<WorldData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/worldgen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorldGenResponse>) => {
      const msg = ev.data;
      if (msg.type === 'progress') onProgress(msg.stage, msg.fraction);
      else {
        worker.terminate();
        resolve(msg.world);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ type: 'generate', seed } satisfies WorldGenRequest);
  });
}
