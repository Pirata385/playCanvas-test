import type { Rng } from '../core/rng';
import { DAY_SECONDS } from './time';

export enum WeatherKind {
  Clear,
  Cloudy,
  Rain,
  Storm,
  Fog
}

export const WEATHER_NAMES = ['Clear', 'Cloudy', 'Rain', 'Thunderstorm', 'Fog'];

/** Continuous weather parameters consumed by rendering, audio and the ecosystem. */
export interface WeatherState {
  kind: WeatherKind;
  timeLeft: number;
  cloud: number;
  rain: number;
  fog: number;
  wind: number;
  windDir: number;
  /** Increments every lightning strike so clients can detect new flashes. */
  lightning: number;
}

const TARGETS: Record<WeatherKind, [cloud: number, rain: number, fog: number, wind: number]> = {
  [WeatherKind.Clear]: [0.12, 0, 0, 0.2],
  [WeatherKind.Cloudy]: [0.7, 0, 0.08, 0.45],
  [WeatherKind.Rain]: [0.88, 0.6, 0.18, 0.55],
  [WeatherKind.Storm]: [1, 1, 0.25, 0.95],
  [WeatherKind.Fog]: [0.45, 0, 0.95, 0.08]
};

const TRANSITIONS: Record<WeatherKind, Array<[WeatherKind, number]>> = {
  [WeatherKind.Clear]: [[WeatherKind.Clear, 0.35], [WeatherKind.Cloudy, 0.5], [WeatherKind.Fog, 0.15]],
  [WeatherKind.Cloudy]: [[WeatherKind.Clear, 0.35], [WeatherKind.Rain, 0.38], [WeatherKind.Storm, 0.12], [WeatherKind.Fog, 0.15]],
  [WeatherKind.Rain]: [[WeatherKind.Cloudy, 0.5], [WeatherKind.Storm, 0.25], [WeatherKind.Clear, 0.25]],
  [WeatherKind.Storm]: [[WeatherKind.Rain, 0.6], [WeatherKind.Cloudy, 0.4]],
  [WeatherKind.Fog]: [[WeatherKind.Clear, 0.6], [WeatherKind.Cloudy, 0.4]]
};

export function initialWeather(): WeatherState {
  return { kind: WeatherKind.Clear, timeLeft: DAY_SECONDS * 0.3, cloud: 0.12, rain: 0, fog: 0, wind: 0.2, windDir: 0.6, lightning: 0 };
}

/** Deterministic Markov weather: discrete regimes with smoothly blended parameters. */
export function stepWeather(w: WeatherState, rng: Rng, dt: number): void {
  w.timeLeft -= dt;
  if (w.timeLeft <= 0) {
    const roll = rng.next();
    let acc = 0;
    for (const [kind, p] of TRANSITIONS[w.kind]) {
      acc += p;
      if (roll < acc) {
        w.kind = kind;
        break;
      }
    }
    w.timeLeft = DAY_SECONDS * rng.range(0.12, 0.35);
  }
  const [tc, tr, tf, tw] = TARGETS[w.kind];
  const k = Math.min(1, dt / (DAY_SECONDS * 0.035));
  w.cloud += (tc - w.cloud) * k;
  // rain only builds once clouds are thick
  w.rain += (tr * Math.min(1, w.cloud / 0.8) - w.rain) * k;
  w.fog += (tf - w.fog) * k;
  w.wind += (tw - w.wind) * k;
  w.windDir += (rng.next() - 0.5) * 0.02 * dt;
  if (w.kind === WeatherKind.Storm && w.rain > 0.6 && rng.next() < 0.012 * dt * 10) w.lightning++;
}
