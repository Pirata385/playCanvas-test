/// <reference lib="webworker" />
import { generateWorld } from '../world/generate';
import { worldTransferables } from '../world/types';

export type WorldGenRequest = { type: 'generate'; seed: number };
export type WorldGenResponse =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; world: ReturnType<typeof generateWorld> };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorldGenRequest>) => {
  if (ev.data.type !== 'generate') return;
  const world = generateWorld(ev.data.seed, (stage, fraction) => {
    ctx.postMessage({ type: 'progress', stage, fraction } satisfies WorldGenResponse);
  });
  ctx.postMessage({ type: 'done', world } satisfies WorldGenResponse, worldTransferables(world));
};
