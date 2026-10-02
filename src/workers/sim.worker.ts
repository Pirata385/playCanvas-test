/// <reference lib="webworker" />
import { Ecosystem, SNAP_STRIDE } from '../sim/Ecosystem';
import type { SimRequest, SimResponse } from '../sim/protocol';
import { TICK_SECONDS } from '../sim/time';

/**
 * Hosts the ecosystem in its own thread. The simulation advances in fixed
 * ticks scaled by the requested time scale and streams compact snapshots
 * back to the renderer ~20 times per second.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const MAX_CREATURES = 1024;
const SNAPSHOT_INTERVAL = 50;
const STEP_BUDGET_MS = 10;

let eco: Ecosystem | null = null;
let timeScale = 1;
let acc = 0;
let last = performance.now();
let lastPost = 0;
let selected: number | null = null;
let lastEventSeq = 0;
let lastHistoryLen = -1;
let msPerTick = 0;
let tickCounter = 0;
let tickWindowStart = performance.now();
let ticksPerSecond = 0;

function post(msg: SimResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (eco && timeScale > 0) {
    acc += dt * timeScale;
    const t0 = performance.now();
    let n = 0;
    while (acc >= TICK_SECONDS) {
      eco.step();
      acc -= TICK_SECONDS;
      n++;
      if (performance.now() - t0 > STEP_BUDGET_MS) {
        acc = Math.min(acc, TICK_SECONDS * 4); // drop backlog rather than spiral
        break;
      }
    }
    if (n > 0) msPerTick = msPerTick * 0.9 + ((performance.now() - t0) / n) * 0.1;
    tickCounter += n;
  }
  if (now - tickWindowStart >= 1000) {
    ticksPerSecond = (tickCounter * 1000) / (now - tickWindowStart);
    tickCounter = 0;
    tickWindowStart = now;
  }
  if (eco && now - lastPost >= SNAPSHOT_INTERVAL) {
    lastPost = now;
    sendSnapshot();
  }
}

function sendSnapshot(): void {
  if (!eco) return;
  const buffer = new Float32Array(MAX_CREATURES * SNAP_STRIDE);
  const count = eco.snapshot(buffer);
  const events = eco.events.filter((e) => e.seq > lastEventSeq);
  if (events.length) lastEventSeq = events[events.length - 1].seq;
  const historyChanged = eco.history.length !== lastHistoryLen || eco.tick % 600 === 0;
  lastHistoryLen = eco.history.length;
  post(
    {
      type: 'snapshot',
      buffer,
      count,
      tick: eco.tick,
      time: eco.time,
      timeScale,
      weather: { ...eco.weather },
      populations: eco.populations.slice(),
      events,
      selected: selected !== null ? eco.detail(selected) : null,
      msPerTick,
      ticksPerSecond,
      foodLevel: eco.foodAverage(),
      stats: eco.stats,
      history: historyChanged ? eco.history : null
    },
    [buffer.buffer]
  );
}

ctx.onmessage = (ev: MessageEvent<SimRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init':
        eco = new Ecosystem(msg.nav);
        if (msg.save) eco.load(msg.save);
        lastEventSeq = msg.save ? msg.save.eventSeq : 0;
        lastHistoryLen = -1;
        acc = 0;
        post({ type: 'ready', tick: eco.tick });
        sendSnapshot();
        break;
      case 'timeScale':
        timeScale = Math.max(0, msg.value);
        break;
      case 'player':
        if (eco) eco.player = { x: msg.x, z: msg.z, speed: msg.speed };
        break;
      case 'scare':
        eco?.scare(msg.x, msg.z, msg.radius);
        break;
      case 'select':
        selected = msg.id;
        break;
      case 'save':
        if (eco) post({ type: 'saved', requestId: msg.requestId, save: eco.serialize() });
        break;
      case 'forceWeather':
        eco?.forceWeather();
        break;
      case 'advance':
        if (eco) {
          const n = Math.round(msg.seconds / TICK_SECONDS);
          for (let i = 0; i < n; i++) eco.step();
          sendSnapshot();
        }
        break;
      case 'load':
        if (eco) {
          eco.load(msg.save);
          lastEventSeq = msg.save.eventSeq;
          lastHistoryLen = -1;
          acc = 0;
          sendSnapshot();
        }
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

setInterval(loop, 8);
