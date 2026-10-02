import type { NavData } from '../world/types';
import type { SimSave } from './Ecosystem';
import type { SimRequest, SimResponse, SimSnapshot } from './protocol';

/** Main-thread proxy for the ecosystem worker. */
export class SimClient {
  private worker: Worker;
  private saveRequests = new Map<number, (s: SimSave) => void>();
  private nextRequest = 1;
  latest: SimSnapshot | null = null;
  onSnapshot: (s: SimSnapshot) => void = () => {};
  onError: (msg: string) => void = (m) => console.error('[sim]', m);
  readonly ready: Promise<void>;

  constructor(nav: NavData, save?: SimSave) {
    this.worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' });
    let resolveReady: () => void = () => {};
    this.ready = new Promise((r) => (resolveReady = r));
    this.worker.onmessage = (ev: MessageEvent<SimResponse>) => {
      const msg = ev.data;
      switch (msg.type) {
        case 'ready':
          resolveReady();
          break;
        case 'snapshot':
          this.latest = msg;
          this.onSnapshot(msg);
          break;
        case 'saved':
          this.saveRequests.get(msg.requestId)?.(msg.save);
          this.saveRequests.delete(msg.requestId);
          break;
        case 'error':
          this.onError(msg.message);
          break;
      }
    };
    this.send({ type: 'init', nav, save }, [nav.heights.buffer, nav.walkable.buffer, nav.waterDist.buffer, nav.waterType.buffer, nav.foodCap.buffer, nav.biome.buffer]);
  }

  private send(msg: SimRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  setTimeScale(v: number): void {
    this.send({ type: 'timeScale', value: v });
  }

  setPlayer(x: number, z: number, speed: number): void {
    this.send({ type: 'player', x, z, speed });
  }

  scare(x: number, z: number, radius: number): void {
    this.send({ type: 'scare', x, z, radius });
  }

  select(id: number | null): void {
    this.send({ type: 'select', id });
  }

  save(): Promise<SimSave> {
    const requestId = this.nextRequest++;
    return new Promise((resolve) => {
      this.saveRequests.set(requestId, resolve);
      this.send({ type: 'save', requestId });
    });
  }

  load(save: SimSave): void {
    this.send({ type: 'load', save });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
