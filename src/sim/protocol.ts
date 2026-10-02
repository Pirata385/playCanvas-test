import type { NavData } from '../world/types';
import type { CreatureDetail, SimEvent, SimSave, SimStats } from './Ecosystem';
import type { WeatherState } from './Weather';

export type SimRequest =
  | { type: 'init'; nav: NavData; save?: SimSave }
  | { type: 'timeScale'; value: number }
  | { type: 'player'; x: number; z: number; speed: number }
  | { type: 'scare'; x: number; z: number; radius: number }
  | { type: 'select'; id: number | null }
  | { type: 'save'; requestId: number }
  | { type: 'load'; save: SimSave };

export interface SimSnapshot {
  type: 'snapshot';
  buffer: Float32Array;
  count: number;
  tick: number;
  time: number;
  timeScale: number;
  weather: WeatherState;
  populations: number[];
  events: SimEvent[];
  selected: CreatureDetail | null;
  /** Average wall-clock milliseconds per simulation tick. */
  msPerTick: number;
  ticksPerSecond: number;
  foodLevel: number;
  stats: SimStats;
  history: number[][] | null;
}

export type SimResponse =
  | { type: 'ready'; tick: number }
  | SimSnapshot
  | { type: 'saved'; requestId: number; save: SimSave }
  | { type: 'error'; message: string };
