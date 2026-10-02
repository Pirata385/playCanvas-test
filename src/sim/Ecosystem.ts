import { Rng } from '../core/rng';
import { angleDiff, clamp, TAU } from '../core/math';
import { WaterType, type NavData } from '../world/types';
import { Biome, BIOMES } from '../world/types';
import { GridPathfinder } from './pathfinding';
import { Anim, CState, PREDATORS_OF, SPECIES, SPECIES_COUNT, Species, STATE_LABELS } from './species';
import { DAY_SECONDS, TICK_SECONDS, hourOfDay, inHourWindow } from './time';
import { initialWeather, stepWeather, type WeatherState } from './Weather';

export type DeathCause = 'old age' | 'starvation' | 'dehydration' | 'predation';

export interface Creature {
  id: number;
  sp: Species;
  /** 0 = female, 1 = male */
  sex: 0 | 1;
  name: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  age: number;
  lifespan: number;
  hunger: number;
  thirst: number;
  energy: number;
  health: number;
  state: CState;
  acting: boolean;
  tx: number;
  tz: number;
  targetId: number;
  path: number[] | null;
  pathIdx: number;
  stuck: number;
  thinkT: number;
  timer: number;
  fleeX: number;
  fleeZ: number;
  pregnant: number;
  mateCD: number;
  huntCD: number;
  mother: number;
  gen: number;
  children: number;
  kills: number;
  born: number;
  cause: DeathCause | null;
  deathTime: number;
  meat: number;
}

export interface SimEvent {
  seq: number;
  time: number;
  kind: 'birth' | 'death' | 'hunt' | 'migration' | 'weather' | 'info';
  text: string;
  x?: number;
  z?: number;
}

export interface SimStats {
  births: number[];
  deaths: Record<DeathCause, number>;
  peak: number[];
}

export interface SimSave {
  version: 1;
  seed: number;
  tick: number;
  time: number;
  rng: number;
  nextId: number;
  eventSeq: number;
  creatures: Creature[];
  food: string;
  weather: WeatherState;
  stats: SimStats;
  history: number[][];
  events: SimEvent[];
}

export interface CreatureDetail {
  id: number;
  name: string;
  species: Species;
  sex: 0 | 1;
  state: string;
  ageDays: number;
  lifespanDays: number;
  mature: boolean;
  hunger: number;
  thirst: number;
  energy: number;
  health: number;
  pregnant: boolean;
  generation: number;
  children: number;
  kills: number;
  motherName: string | null;
  cause: DeathCause | null;
  x: number;
  z: number;
}

/** Floats per creature in the render snapshot. */
export const SNAP_STRIDE = 12;
// id, species, x, z, heading, speed, anim, growth, sex, health, state, ageFrac

const SYLLABLES = ['ka', 'lo', 'mi', 'ru', 'sa', 'te', 'vo', 'ni', 'pa', 'zu', 'fe', 'ri', 'do', 'ba', 'el', 'an', 'or', 'is', 'ta', 'ko', 'mu', 'li', 've', 'go'];
const DX4 = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ4 = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Deterministic agent-based ecosystem. Pure logic, no DOM or worker APIs, so it
 * can run inside the simulation worker as well as in unit tests.
 */
export class Ecosystem {
  readonly R: number;
  readonly cell: number;
  readonly size: number;
  tick = 0;
  time = 0;
  creatures: Creature[] = [];
  food: Float32Array;
  weather: WeatherState = initialWeather();
  stats: SimStats = { births: [0, 0, 0, 0], deaths: { 'old age': 0, starvation: 0, dehydration: 0, predation: 0 }, peak: [0, 0, 0, 0] };
  history: number[][] = [];
  events: SimEvent[] = [];
  populations = [0, 0, 0, 0];
  player = { x: -1000, z: -1000, speed: 0 };

  private rng: Rng;
  private nextId = 1;
  private eventSeq = 0;
  private byId = new Map<number, Creature>();
  private grid: Int32Array;
  private gridNext: Int32Array = new Int32Array(0);
  private readonly gridCell = 16;
  private readonly gridRes: number;
  private pathfinder: GridPathfinder;
  private pathBudget = 0;
  private lastWeatherKind = 0;

  constructor(readonly nav: NavData) {
    this.R = nav.res;
    this.cell = nav.cell;
    this.size = (nav.res - 1) * nav.cell;
    this.rng = new Rng(nav.seed).fork('ecosystem');
    this.food = new Float32Array(nav.foodCap);
    this.gridRes = Math.ceil(this.size / this.gridCell) + 1;
    this.grid = new Int32Array(this.gridRes * this.gridRes);
    // wading through rivers is allowed but discouraged
    this.pathfinder = new GridPathfinder(this.R, nav.walkable, (i) => (nav.waterType[i] === WaterType.River ? 3 : 0));
    this.populate();
  }

  // ------------------------------------------------------------------ setup

  private populate(): void {
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const def = SPECIES[s as Species];
      for (let n = 0; n < def.initial; n++) {
        const p = this.randomSpawnPoint(s as Species);
        if (!p) break;
        const c = this.spawn(s as Species, p[0], p[1], (n % 2) as 0 | 1, -1, 0);
        c.age = this.rng.range(0.15, 0.7) * def.lifespanDays * DAY_SECONDS;
        c.hunger = this.rng.range(0.1, 0.4);
        c.thirst = this.rng.range(0.1, 0.4);
      }
    }
    this.countPopulations();
    this.recordHistory();
  }

  private randomSpawnPoint(sp: Species): [number, number] | null {
    const nav = this.nav;
    for (let attempt = 0; attempt < 400; attempt++) {
      const i = this.rng.int(0, this.R * this.R - 1);
      if (!nav.walkable[i] || nav.waterType[i] !== WaterType.None) continue;
      const b = nav.biome[i] as Biome;
      if (b === Biome.Snow || b === Biome.Rock || b === Biome.Beach) continue;
      if (nav.waterDist[i] > 90) continue;
      // carnivores prefer forests, herbivores open ground
      const carn = SPECIES[sp].diet === 'carnivore';
      if (carn && b !== Biome.Forest && b !== Biome.Taiga && this.rng.chance(0.6)) continue;
      if (!carn && b !== Biome.Grassland && b !== Biome.Savanna && b !== Biome.Marsh && this.rng.chance(0.5)) continue;
      return [(i % this.R) * this.cell, ((i / this.R) | 0) * this.cell];
    }
    return null;
  }

  private makeName(): string {
    const n = this.rng.int(2, 3);
    let s = '';
    for (let i = 0; i < n; i++) s += this.rng.pick(SYLLABLES);
    return s[0].toUpperCase() + s.slice(1);
  }

  private spawn(sp: Species, x: number, z: number, sex: 0 | 1, mother: number, gen: number): Creature {
    const def = SPECIES[sp];
    const c: Creature = {
      id: this.nextId++, sp, sex, name: this.makeName(), x, z, heading: this.rng.range(0, TAU), speed: 0,
      age: 0, lifespan: def.lifespanDays * DAY_SECONDS * this.rng.range(0.85, 1.15),
      hunger: 0.2, thirst: 0.2, energy: 1, health: 1, state: CState.Idle, acting: false,
      tx: x, tz: z, targetId: -1, path: null, pathIdx: 0, stuck: 0,
      thinkT: this.rng.range(0, 0.5), timer: 0, fleeX: 0, fleeZ: 0, pregnant: 0,
      mateCD: def.mateCooldownDays * DAY_SECONDS * 0.3, huntCD: 0, mother, gen, children: 0, kills: 0,
      born: this.time, cause: null, deathTime: 0, meat: def.meat
    };
    this.creatures.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  // ------------------------------------------------------------------ helpers

  private idx(x: number, z: number): number {
    const ix = clamp(Math.round(x / this.cell), 0, this.R - 1);
    const iz = clamp(Math.round(z / this.cell), 0, this.R - 1);
    return iz * this.R + ix;
  }

  private walkableAt(x: number, z: number): boolean {
    if (x < 1 || z < 1 || x > this.size - 1 || z > this.size - 1) return false;
    return this.nav.walkable[this.idx(x, z)] === 1;
  }

  private log(kind: SimEvent['kind'], text: string, x?: number, z?: number): void {
    this.events.push({ seq: ++this.eventSeq, time: this.time, kind, text, x, z });
    if (this.events.length > 60) this.events.shift();
  }

  get hour(): number {
    return hourOfDay(this.time);
  }

  getCreature(id: number): Creature | undefined {
    return this.byId.get(id);
  }

  private growth(c: Creature): number {
    return 0.45 + 0.55 * Math.min(1, c.age / (SPECIES[c.sp].matureDays * DAY_SECONDS));
  }

  private isMature(c: Creature): boolean {
    return c.age >= SPECIES[c.sp].matureDays * DAY_SECONDS;
  }

  private rebuildGrid(): void {
    const n = this.creatures.length;
    if (this.gridNext.length < n) this.gridNext = new Int32Array(n * 2);
    this.grid.fill(-1);
    for (let i = 0; i < n; i++) {
      const c = this.creatures[i];
      const g = this.gridIndex(c.x, c.z);
      this.gridNext[i] = this.grid[g];
      this.grid[g] = i;
    }
  }

  private gridIndex(x: number, z: number): number {
    const gx = clamp(Math.floor(x / this.gridCell), 0, this.gridRes - 1);
    const gz = clamp(Math.floor(z / this.gridCell), 0, this.gridRes - 1);
    return gz * this.gridRes + gx;
  }

  /** Visit creatures within radius of (x, z). Return true from the callback to stop early. */
  private query(x: number, z: number, r: number, fn: (c: Creature, d2: number) => boolean | void): void {
    const g0x = clamp(Math.floor((x - r) / this.gridCell), 0, this.gridRes - 1);
    const g1x = clamp(Math.floor((x + r) / this.gridCell), 0, this.gridRes - 1);
    const g0z = clamp(Math.floor((z - r) / this.gridCell), 0, this.gridRes - 1);
    const g1z = clamp(Math.floor((z + r) / this.gridCell), 0, this.gridRes - 1);
    const r2 = r * r;
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        for (let i = this.grid[gz * this.gridRes + gx]; i >= 0; i = this.gridNext[i]) {
          const c = this.creatures[i];
          const dx = c.x - x;
          const dz = c.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2 && fn(c, d2) === true) return;
        }
      }
    }
  }

  // ------------------------------------------------------------------ main step

  step(): void {
    const dt = TICK_SECONDS;
    this.tick++;
    this.time += dt;
    this.pathBudget = 3;
    stepWeather(this.weather, this.rng, dt);
    if (this.weather.kind !== this.lastWeatherKind) {
      this.lastWeatherKind = this.weather.kind;
      const names = ['The sky clears', 'Clouds roll in', 'Rain begins to fall', 'A thunderstorm breaks', 'Fog settles over the island'];
      this.log('weather', names[this.weather.kind]);
    }
    if (this.tick % 10 === 0) this.growFood(dt * 10);
    this.rebuildGrid();

    const list = this.creatures;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.state === CState.Dead) continue;
      this.updateNeeds(c, dt);
      if ((c.state as CState) === CState.Dead) continue;
      c.thinkT -= dt;
      if (c.thinkT <= 0) {
        c.thinkT = 0.5;
        this.think(c);
      }
      this.act(c, dt);
    }

    // remove decayed corpses (keeps array order deterministic)
    if (this.tick % 10 === 0) {
      const keep: Creature[] = [];
      for (const c of list) {
        if (c.state === CState.Dead && (this.time - c.deathTime > 60 || c.meat <= 0 && this.time - c.deathTime > 8)) {
          this.byId.delete(c.id);
        } else keep.push(c);
      }
      this.creatures = keep;
    }
    if (this.tick % 20 === 0) this.countPopulations();
    if (this.tick % Math.round(DAY_SECONDS / 24 / TICK_SECONDS) === 0) this.recordHistory();
    if (this.tick % Math.round(DAY_SECONDS / 2 / TICK_SECONDS) === 0) this.migrate();
  }

  private countPopulations(): void {
    const p = [0, 0, 0, 0];
    for (const c of this.creatures) if (c.state !== CState.Dead) p[c.sp]++;
    this.populations = p;
    for (let s = 0; s < SPECIES_COUNT; s++) this.stats.peak[s] = Math.max(this.stats.peak[s], p[s]);
  }

  private recordHistory(): void {
    this.countPopulations();
    this.history.push(this.populations.slice());
    if (this.history.length > 240) this.history.shift();
  }

  private growFood(dt: number): void {
    const food = this.food;
    const cap = this.nav.foodCap;
    const biome = this.nav.biome;
    const rainBoost = 1 + this.weather.rain * 0.8;
    const k = (dt / DAY_SECONDS) * rainBoost;
    for (let i = 0; i < food.length; i++) {
      const c = cap[i];
      if (c <= 0 || food[i] >= c) continue;
      food[i] = Math.min(c, food[i] + BIOMES[biome[i] as Biome].foodRegen * 0.35 * c * k);
    }
  }

  private migrate(): void {
    for (let s = 0; s < SPECIES_COUNT; s++) {
      if (this.populations[s] >= 2) continue;
      const def = SPECIES[s as Species];
      const p = this.randomSpawnPoint(s as Species);
      if (!p) continue;
      for (let k = 0; k < 2; k++) {
        const c = this.spawn(s as Species, p[0] + k, p[1], k as 0 | 1, -1, 0);
        c.age = def.matureDays * DAY_SECONDS * 1.2;
      }
      this.log('migration', `A pair of ${def.plural.toLowerCase()} swam ashore`, p[0], p[1]);
    }
    this.countPopulations();
  }

  // ------------------------------------------------------------------ needs

  private updateNeeds(c: Creature, dt: number): void {
    const def = SPECIES[c.sp];
    const sleeping = c.state === CState.Sleep;
    const effort = sleeping ? 0.45 : c.speed > def.walkSpeed * 1.3 ? 1.6 : 1;
    const perDay = dt / DAY_SECONDS;
    c.age += dt;
    c.hunger = Math.min(1, c.hunger + def.hungerPerDay * perDay * effort);
    c.thirst = Math.min(1, c.thirst + def.thirstPerDay * perDay * effort * (1 - this.weather.rain * 0.3));
    if (sleeping) c.energy = Math.min(1, c.energy + perDay / 0.2);
    else c.energy = Math.max(0, c.energy - def.fatiguePerDay * perDay * (effort > 1 ? 1.8 : 1));
    if (c.hunger >= 1) c.health -= perDay / 0.5;
    if (c.thirst >= 1) c.health -= perDay / 0.35;
    if (c.hunger < 0.6 && c.thirst < 0.6) c.health = Math.min(1, c.health + perDay / 0.6);
    if (c.mateCD > 0) c.mateCD -= dt;
    if (c.huntCD > 0) c.huntCD -= dt;
    if (c.pregnant > 0) {
      c.pregnant -= dt;
      if (c.pregnant <= 0) this.giveBirth(c);
    }
    if (c.age >= c.lifespan) this.kill(c, 'old age');
    else if (c.health <= 0) this.kill(c, c.thirst >= 1 ? 'dehydration' : 'starvation');
  }

  private kill(c: Creature, cause: DeathCause): void {
    c.state = CState.Dead;
    c.cause = cause;
    c.deathTime = this.time;
    c.speed = 0;
    c.acting = false;
    c.path = null;
    c.meat = SPECIES[c.sp].meat * this.growth(c);
    this.stats.deaths[cause]++;
    if (cause !== 'predation') {
      const def = SPECIES[c.sp];
      this.log('death', `${c.name} the ${def.name.toLowerCase()} died of ${cause}`, c.x, c.z);
    }
  }

  private giveBirth(mother: Creature): void {
    const def = SPECIES[mother.sp];
    mother.pregnant = 0;
    if (this.populations[mother.sp] >= def.maxPop) return;
    const n = this.rng.int(def.litter[0], def.litter[1]);
    for (let k = 0; k < n; k++) {
      const a = this.rng.range(0, TAU);
      const x = mother.x + Math.cos(a) * 0.8;
      const z = mother.z + Math.sin(a) * 0.8;
      const baby = this.spawn(mother.sp, this.walkableAt(x, z) ? x : mother.x, this.walkableAt(x, z) ? z : mother.z,
        this.rng.chance(0.5) ? 1 : 0, mother.id, mother.gen + 1);
      baby.hunger = 0.1;
      baby.thirst = 0.1;
      mother.children++;
      this.stats.births[mother.sp]++;
      this.populations[mother.sp]++;
    }
    this.log('birth', `${mother.name} gave birth to ${n} ${n > 1 ? def.plural.toLowerCase() : def.name.toLowerCase()}`, mother.x, mother.z);
  }

  // ------------------------------------------------------------------ decision making

  private setState(c: Creature, s: CState): void {
    if (c.state === s) return;
    c.state = s;
    c.acting = false;
    c.path = null;
    c.timer = 0;
    c.targetId = -1;
    c.stuck = 0;
  }

  private findThreat(c: Creature): Creature | null {
    const preds = PREDATORS_OF[c.sp];
    if (!preds.length) return null;
    const def = SPECIES[c.sp];
    const r = def.sense * (c.state === CState.Sleep ? 0.35 : 1);
    let best: Creature | null = null;
    let bestD = Infinity;
    this.query(c.x, c.z, r, (o, d2) => {
      if (o.state === CState.Dead || o.state === CState.Sleep || !preds.includes(o.sp)) return;
      // a predator that is visibly feeding is less threatening
      if (o.state === CState.Eat && d2 > 64) return;
      if (d2 < bestD) {
        bestD = d2;
        best = o;
      }
    });
    return best;
  }

  private think(c: Creature): void {
    const def = SPECIES[c.sp];
    const herbivore = def.diet === 'herbivore';

    // 1. danger
    let threatX = NaN;
    let threatZ = NaN;
    const threat = this.findThreat(c);
    if (threat) {
      threatX = threat.x;
      threatZ = threat.z;
    } else if (herbivore) {
      const dx = this.player.x - c.x;
      const dz = this.player.z - c.z;
      const scare = this.player.speed > 4.5 ? 15 : this.player.speed > 0.5 ? 7 : 3.5;
      const r = c.sp === Species.Rabbit ? scare : scare * 1.3;
      if (dx * dx + dz * dz < r * r && c.state !== CState.Sleep) {
        threatX = this.player.x;
        threatZ = this.player.z;
      }
    }
    if (!Number.isNaN(threatX)) {
      this.setState(c, CState.Flee);
      c.fleeX = threatX;
      c.fleeZ = threatZ;
      c.timer = 3 + this.rng.next() * 2;
      return;
    }
    if (c.state === CState.Flee && c.timer > 0) return;

    // 2. ongoing activities that should not be interrupted
    if (c.state === CState.Sleep) {
      const window = inHourWindow(this.hour, def.sleepStart, def.sleepEnd);
      if ((c.energy >= 0.99 && !window) || c.thirst > 0.9 || c.hunger > 0.92) this.setState(c, CState.Idle);
      else return;
    }
    if (c.state === CState.Mate && c.acting) return;
    if (c.state === CState.Eat) {
      const carcass = this.byId.get(c.targetId);
      if (carcass && carcass.meat > 0 && c.hunger > 0.03) return;
      this.setState(c, CState.Idle);
    }
    if (c.state === CState.Hunt && c.targetId >= 0 && c.hunger > 0.15) return;

    // 3. needs, in priority order
    const thirsty = c.thirst > (c.state === CState.Drink ? 0.03 : 0.55);
    const hungry = c.hunger > (c.state === CState.Graze || c.state === CState.Hunt ? 0.08 : herbivore ? 0.5 : 0.4);
    const urgentThirst = c.thirst > 0.8;
    const urgentHunger = c.hunger > 0.8;
    if (urgentThirst || (thirsty && !urgentHunger)) {
      this.setState(c, CState.Drink);
      return;
    }
    if (hungry && (herbivore || c.huntCD <= 0)) {
      this.setState(c, herbivore ? CState.Graze : CState.Hunt);
      return;
    }
    const window = inHourWindow(this.hour, def.sleepStart, def.sleepEnd);
    if (c.energy < 0.2 || (window && c.energy < 0.97)) {
      this.setState(c, CState.Sleep);
      return;
    }
    if (this.isMature(c) && c.mateCD <= 0 && c.pregnant <= 0 && c.hunger < (herbivore ? 0.45 : 0.6) && c.thirst < 0.5
      && this.populations[c.sp] < def.maxPop) {
      this.setState(c, CState.Mate);
      return;
    }
    if (!this.isMature(c)) {
      const mom = this.byId.get(c.mother);
      if (mom && mom.state !== CState.Dead) {
        const d2 = (mom.x - c.x) ** 2 + (mom.z - c.z) ** 2;
        if (d2 > 36) {
          this.setState(c, CState.Follow);
          c.targetId = mom.id;
          return;
        }
      }
    }
    if (c.state === CState.Wander || c.state === CState.Idle) return;
    this.setState(c, CState.Idle);
    c.timer = this.rng.range(1, 4);
  }

  // ------------------------------------------------------------------ behaviours

  private act(c: Creature, dt: number): void {
    const def = SPECIES[c.sp];
    switch (c.state) {
      case CState.Idle: {
        c.speed = 0;
        c.timer -= dt;
        if (c.timer <= 0) this.pickWanderTarget(c, 25);
        break;
      }
      case CState.Wander: {
        if (this.moveTo(c, c.tx, c.tz, def.walkSpeed, dt, 1)) {
          this.setState(c, CState.Idle);
          c.timer = this.rng.range(2, 7);
        }
        break;
      }
      case CState.Follow: {
        const mom = this.byId.get(c.targetId);
        if (!mom || mom.state === CState.Dead) {
          this.setState(c, CState.Idle);
          break;
        }
        if (this.moveTo(c, mom.x, mom.z, def.walkSpeed * 1.4, dt, 2.5)) this.setState(c, CState.Idle);
        break;
      }
      case CState.Drink:
        this.actDrink(c, dt);
        break;
      case CState.Graze:
        this.actGraze(c, dt);
        break;
      case CState.Hunt:
        this.actHunt(c, dt);
        break;
      case CState.Eat: {
        c.speed = 0;
        c.acting = true;
        const carcass = this.byId.get(c.targetId);
        if (!carcass || carcass.meat <= 0) {
          this.setState(c, CState.Idle);
          break;
        }
        const bite = Math.min(carcass.meat, dt * 0.05);
        carcass.meat -= bite;
        c.hunger = Math.max(0, c.hunger - bite * 1.6);
        break;
      }
      case CState.Flee: {
        c.timer -= dt;
        const away = Math.atan2(c.x - c.fleeX, c.z - c.fleeZ);
        // adrenaline burst during the first moments of an escape
        const burst = c.timer > 2.5 ? 1.2 : 1;
        const speed = def.runSpeed * burst * (0.55 + 0.45 * c.energy) * (0.6 + 0.4 * c.health) * this.ageSpeed(c);
        this.steer(c, away, speed, dt);
        if (c.timer <= 0) this.setState(c, CState.Idle);
        break;
      }
      case CState.Sleep:
        c.speed = 0;
        c.acting = true;
        break;
      case CState.Mate:
        this.actMate(c, dt);
        break;
      case CState.Dead:
        break;
    }
  }

  private ageSpeed(c: Creature): number {
    const lifeFrac = c.age / c.lifespan;
    const juvenile = this.isMature(c) ? 1 : 0.75;
    return juvenile * (lifeFrac > 0.8 ? 0.8 : 1);
  }

  private pickWanderTarget(c: Creature, radius: number): void {
    for (let k = 0; k < 8; k++) {
      const a = this.rng.range(0, TAU);
      const r = this.rng.range(radius * 0.3, radius);
      const x = c.x + Math.sin(a) * r;
      const z = c.z + Math.cos(a) * r;
      if (!this.walkableAt(x, z)) continue;
      // avoid wandering into barren high ground
      const b = this.nav.biome[this.idx(x, z)];
      if ((b === Biome.Snow || b === Biome.Rock) && this.rng.chance(0.8)) continue;
      this.setState(c, CState.Wander);
      c.tx = x;
      c.tz = z;
      return;
    }
    c.timer = 1;
  }

  private actDrink(c: Creature, dt: number): void {
    const def = SPECIES[c.sp];
    const i = this.idx(c.x, c.z);
    const wd = this.nav.waterDist[i];
    if (wd === 0) {
      c.speed = 0;
      c.acting = true;
      c.thirst = Math.max(0, c.thirst - dt * 0.12);
      if (c.thirst <= 0.02) this.setState(c, CState.Idle);
      return;
    }
    if (wd === 65535) {
      // stranded: roam and hope for the best
      if (c.path === null) this.pickWanderTarget(c, 40);
      return;
    }
    // descend the water distance field
    const R = this.R;
    const cx = i % R;
    const cz = (i / R) | 0;
    let best = i;
    let bestD = wd;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX4[k];
      const nz = cz + DZ4[k];
      if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
      const n = nz * R + nx;
      if (this.nav.waterDist[n] < bestD) {
        bestD = this.nav.waterDist[n];
        best = n;
      }
    }
    const tx = (best % R) * this.cell;
    const tz = ((best / R) | 0) * this.cell;
    const urgency = c.thirst > 0.85 ? 1.6 : 1.1;
    this.steer(c, Math.atan2(tx - c.x, tz - c.z), def.walkSpeed * urgency, dt);
  }

  private actGraze(c: Creature, dt: number): void {
    const def = SPECIES[c.sp];
    if (c.acting) {
      c.speed = 0;
      const i = this.idx(c.x, c.z);
      const bite = Math.min(this.food[i], dt * (c.sp === Species.Deer ? 0.05 : 0.035));
      this.food[i] -= bite;
      c.hunger = Math.max(0, c.hunger - bite * def.nutrition * 1.8);
      if (c.hunger <= 0.03) this.setState(c, CState.Idle);
      else if (this.food[i] < 0.05) c.acting = false;
      return;
    }
    if (c.targetId === -1) {
      // sample candidate patches, pick the most rewarding
      let best = -1;
      let bestScore = -Infinity;
      for (let k = 0; k < 14; k++) {
        const a = this.rng.range(0, TAU);
        const r = k === 0 ? 0 : this.rng.range(2, def.sense);
        const x = c.x + Math.sin(a) * r;
        const z = c.z + Math.cos(a) * r;
        if (!this.walkableAt(x, z)) continue;
        const i = this.idx(x, z);
        const score = this.food[i] - r * 0.012;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0 || this.food[best] < 0.12) {
        // nothing nearby: travel further
        const a = this.rng.range(0, TAU);
        c.tx = clamp(c.x + Math.sin(a) * 40, 2, this.size - 2);
        c.tz = clamp(c.z + Math.cos(a) * 40, 2, this.size - 2);
        c.targetId = -2;
      } else {
        c.tx = (best % this.R) * this.cell;
        c.tz = ((best / this.R) | 0) * this.cell;
        c.targetId = best;
      }
    }
    if (this.moveTo(c, c.tx, c.tz, def.walkSpeed, dt, 0.9)) {
      if (c.targetId >= 0) c.acting = true;
      c.targetId = -1;
    }
  }

  private actHunt(c: Creature, dt: number): void {
    const def = SPECIES[c.sp];
    let prey = c.targetId >= 0 ? this.byId.get(c.targetId) : undefined;
    if (prey && (prey.state === CState.Dead || (prey.x - c.x) ** 2 + (prey.z - c.z) ** 2 > (def.sense * 1.4) ** 2)) {
      prey = undefined;
      c.targetId = -1;
    }
    if (!prey) {
      let best: Creature | null = null;
      let bestScore = Infinity;
      this.query(c.x, c.z, def.sense, (o, d2) => {
        if (o.state === CState.Dead || !def.prey.includes(o.sp)) return;
        if (c.sp === Species.Wolf && o.sp === Species.Rabbit && c.hunger < 0.55) return;
        let score = Math.sqrt(d2);
        if (!this.isMature(o)) score *= 0.6;
        if (o.state === CState.Sleep || o.state === CState.Drink) score *= 0.6;
        if (o.sp === Species.Deer && c.sp === Species.Wolf) score *= 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = o;
        }
      });
      if (best) {
        prey = best;
        c.targetId = (best as Creature).id;
        c.timer = 0;
      }
    }
    if (!prey) {
      // prowl: long wander legs while searching
      if (c.path === null && (c.tx - c.x) ** 2 + (c.tz - c.z) ** 2 < 4) {
        for (let k = 0; k < 6; k++) {
          const a = this.rng.range(0, TAU);
          const x = c.x + Math.sin(a) * 45;
          const z = c.z + Math.cos(a) * 45;
          if (this.walkableAt(x, z)) {
            c.tx = x;
            c.tz = z;
            break;
          }
        }
      }
      this.moveTo(c, c.tx, c.tz, def.walkSpeed * 1.2, dt, 1.5);
      return;
    }
    c.timer += dt;
    if (c.timer > def.chaseSeconds) {
      // exhausted, give up for a while
      this.setState(c, CState.Idle);
      c.timer = 4;
      c.huntCD = 25;
      return;
    }
    const dx = prey.x - c.x;
    const dz = prey.z - c.z;
    const d = Math.hypot(dx, dz);
    const reach = SPECIES[c.sp].radius + SPECIES[prey.sp].radius + 0.35;
    if (d < reach) {
      this.kill(prey, 'predation');
      c.kills++;
      this.log('hunt', `${c.name} the ${def.name.toLowerCase()} caught ${prey.name} the ${SPECIES[prey.sp].name.toLowerCase()}`, c.x, c.z);
      this.setState(c, CState.Eat);
      c.targetId = prey.id;
      return;
    }
    // stalk slowly when far and unseen, sprint when close
    const stalking = d > 12 && prey.state !== CState.Flee;
    const tiring = 1 - 0.15 * (c.timer / def.chaseSeconds);
    const speed = (stalking ? def.walkSpeed * 1.3 : def.runSpeed * tiring) * (0.6 + 0.4 * c.energy) * this.ageSpeed(c);
    // lead the target slightly
    const lead = prey.state === CState.Flee ? 0.4 : 0;
    const ax = prey.x + Math.sin(prey.heading) * prey.speed * lead;
    const az = prey.z + Math.cos(prey.heading) * prey.speed * lead;
    this.steer(c, Math.atan2(ax - c.x, az - c.z), speed, dt);
  }

  private actMate(c: Creature, dt: number): void {
    const def = SPECIES[c.sp];
    if (c.acting) {
      c.speed = 0;
      c.timer -= dt;
      if (c.timer <= 0) {
        const partner = this.byId.get(c.targetId);
        if (c.sex === 0 && partner && partner.state !== CState.Dead) c.pregnant = def.gestationDays * DAY_SECONDS;
        c.mateCD = def.mateCooldownDays * DAY_SECONDS;
        this.setState(c, CState.Idle);
        c.timer = 2;
      }
      return;
    }
    let partner = c.targetId >= 0 ? this.byId.get(c.targetId) : undefined;
    if (partner && partner.state !== CState.Mate) partner = undefined;
    if (!partner) {
      let best: Creature | null = null;
      let bestD = Infinity;
      this.query(c.x, c.z, def.sense * (def.diet === 'carnivore' ? 4 : 3), (o, d2) => {
        if (o === c || o.sp !== c.sp || o.sex === c.sex || !this.isAvailableMate(o)) return;
        if (o.state === CState.Mate && o.targetId >= 0 && o.targetId !== c.id) return;
        if (d2 < bestD) {
          bestD = d2;
          best = o;
        }
      });
      if (best) {
        partner = best as Creature;
        // invite the partner to court as well
        this.setState(partner, CState.Mate);
        partner.targetId = c.id;
        c.targetId = partner.id;
      }
    }
    if (!partner) {
      c.timer += dt;
      if (c.timer > 30) {
        // nobody around – give up for now
        c.mateCD = DAY_SECONDS * 0.15;
        this.setState(c, CState.Idle);
        return;
      }
      if ((c.tx - c.x) ** 2 + (c.tz - c.z) ** 2 < 4 || c.timer < dt * 1.5) {
        const a = this.rng.range(0, TAU);
        c.tx = clamp(c.x + Math.sin(a) * 35, 2, this.size - 2);
        c.tz = clamp(c.z + Math.cos(a) * 35, 2, this.size - 2);
      }
      this.moveTo(c, c.tx, c.tz, def.walkSpeed * 1.2, dt, 1.5);
      return;
    }
    const d = Math.hypot(partner.x - c.x, partner.z - c.z);
    if (d < SPECIES[c.sp].radius * 2 + 0.6) {
      for (const m of [c, partner]) {
        m.acting = true;
        m.timer = 3;
        m.speed = 0;
        m.targetId = m === c ? partner.id : c.id;
      }
      c.heading = Math.atan2(partner.x - c.x, partner.z - c.z);
      partner.heading = c.heading + Math.PI;
      return;
    }
    this.moveTo(c, partner.x, partner.z, def.walkSpeed * 1.3, dt, 0.5);
  }

  private isAvailableMate(o: Creature): boolean {
    if (o.state === CState.Mate) return !o.acting;
    if (o.state === CState.Dead || o.state === CState.Sleep || o.state === CState.Flee || o.state === CState.Eat) return false;
    if (o.state === CState.Hunt && o.targetId >= 0) return false;
    return this.isMature(o) && o.mateCD <= 0 && o.pregnant <= 0 && o.hunger < 0.7 && o.thirst < 0.7;
  }

  // ------------------------------------------------------------------ locomotion

  /**
   * Walk towards a point, using A* when the direct route is blocked.
   * Returns true when within `arrive` metres.
   */
  private moveTo(c: Creature, x: number, z: number, speed: number, dt: number, arrive: number): boolean {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz <= arrive * arrive) {
      c.speed = 0;
      c.path = null;
      return true;
    }
    let wx = x;
    let wz = z;
    if (c.path) {
      while (c.pathIdx < c.path.length) {
        const n = c.path[c.pathIdx];
        const px = (n % this.R) * this.cell;
        const pz = ((n / this.R) | 0) * this.cell;
        if ((px - c.x) ** 2 + (pz - c.z) ** 2 < 1.6) c.pathIdx++;
        else {
          wx = px;
          wz = pz;
          break;
        }
      }
      if (c.pathIdx >= c.path.length) c.path = null;
    } else if (c.stuck > 1.2 && this.pathBudget > 0) {
      this.pathBudget--;
      c.stuck = 0;
      const goal = this.nearestWalkable(this.idx(x, z));
      const path = goal >= 0 ? this.pathfinder.find(this.idx(c.x, c.z), goal, 5000) : null;
      if (path && path.length) {
        c.path = path;
        c.pathIdx = 0;
      } else {
        // unreachable: abandon this goal
        c.tx = c.x;
        c.tz = c.z;
        return true;
      }
    }
    this.steer(c, Math.atan2(wx - c.x, wz - c.z), speed, dt);
    return false;
  }

  private nearestWalkable(i: number): number {
    if (this.nav.walkable[i]) return i;
    const R = this.R;
    const cx = i % R;
    const cz = (i / R) | 0;
    for (let r = 1; r < 6; r++) {
      for (let oz = -r; oz <= r; oz++) {
        for (let ox = -r; ox <= r; ox++) {
          const nx = cx + ox;
          const nz = cz + oz;
          if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
          if (this.nav.walkable[nz * R + nx]) return nz * R + nx;
        }
      }
    }
    return -1;
  }

  /** Turn towards a heading and advance, sliding around obstacles. */
  private steer(c: Creature, desired: number, speed: number, dt: number): void {
    const turnRate = 5;
    const diff = angleDiff(c.heading, desired);
    c.heading += clamp(diff, -turnRate * dt, turnRate * dt);
    const inRiver = this.nav.waterType[this.idx(c.x, c.z)] === WaterType.River;
    const target = speed * (inRiver ? 0.55 : 1) * (Math.abs(diff) > 1.5 ? 0.4 : 1);
    c.speed += (target - c.speed) * Math.min(1, dt * 4);
    c.acting = false;
    const step = c.speed * dt;
    const offsets = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4];
    for (const o of offsets) {
      const h = c.heading + o;
      const nx = c.x + Math.sin(h) * step;
      const nz = c.z + Math.cos(h) * step;
      const lookX = c.x + Math.sin(h) * Math.max(1.2, step * 3);
      const lookZ = c.z + Math.cos(h) * Math.max(1.2, step * 3);
      if (this.walkableAt(nx, nz) && this.walkableAt(lookX, lookZ)) {
        c.x = nx;
        c.z = nz;
        if (o !== 0) {
          c.heading += o * 0.3;
          c.stuck += dt * 0.5;
        } else c.stuck = Math.max(0, c.stuck - dt);
        return;
      }
    }
    c.stuck += dt * 2;
    c.heading += Math.PI * 0.5 * (this.rng.next() < 0.5 ? 1 : -1);
    c.speed *= 0.5;
  }

  // ------------------------------------------------------------------ external interaction

  /** Startle herbivores around a point (e.g. a thrown stone landing). */
  scare(x: number, z: number, radius: number): void {
    this.rebuildGrid();
    this.query(x, z, radius, (c) => {
      if (c.state === CState.Dead || SPECIES[c.sp].diet !== 'herbivore') return;
      this.setState(c, CState.Flee);
      c.fleeX = x;
      c.fleeZ = z;
      c.timer = 4;
    });
  }

  // ------------------------------------------------------------------ output

  snapshot(out: Float32Array): number {
    let n = 0;
    for (const c of this.creatures) {
      const o = n * SNAP_STRIDE;
      if (o + SNAP_STRIDE > out.length) break;
      let anim = Anim.Move;
      if (c.state === CState.Dead) anim = Anim.Dead;
      else if (c.state === CState.Sleep) anim = Anim.Sleep;
      else if (c.acting && (c.state === CState.Graze || c.state === CState.Eat)) anim = Anim.Eat;
      else if (c.acting && c.state === CState.Drink) anim = Anim.Drink;
      else if (c.acting && c.state === CState.Mate) anim = Anim.Mate;
      out[o] = c.id;
      out[o + 1] = c.sp;
      out[o + 2] = c.x;
      out[o + 3] = c.z;
      out[o + 4] = c.heading;
      out[o + 5] = c.speed;
      out[o + 6] = anim;
      out[o + 7] = this.growth(c);
      out[o + 8] = c.sex;
      out[o + 9] = c.health;
      out[o + 10] = c.state;
      out[o + 11] = c.state === CState.Dead ? this.time - c.deathTime : c.age / c.lifespan;
      n++;
    }
    return n;
  }

  detail(id: number): CreatureDetail | null {
    const c = this.byId.get(id);
    if (!c) return null;
    const def = SPECIES[c.sp];
    const mom = this.byId.get(c.mother);
    return {
      id: c.id, name: c.name, species: c.sp, sex: c.sex, state: STATE_LABELS[c.state],
      ageDays: c.age / DAY_SECONDS, lifespanDays: c.lifespan / DAY_SECONDS,
      mature: c.age >= def.matureDays * DAY_SECONDS,
      hunger: c.hunger, thirst: c.thirst, energy: c.energy, health: Math.max(0, c.health),
      pregnant: c.pregnant > 0, generation: c.gen, children: c.children, kills: c.kills,
      motherName: mom ? mom.name : null, cause: c.cause, x: c.x, z: c.z
    };
  }

  foodAverage(): number {
    let sum = 0;
    let cap = 0;
    for (let i = 0; i < this.food.length; i += 7) {
      sum += this.food[i];
      cap += this.nav.foodCap[i];
    }
    return cap > 0 ? sum / cap : 0;
  }

  // ------------------------------------------------------------------ persistence

  serialize(): SimSave {
    const q = new Uint8Array(this.food.buffer.slice(0));
    let bin = '';
    for (let i = 0; i < q.length; i += 0x8000) bin += String.fromCharCode(...q.subarray(i, i + 0x8000));
    return {
      version: 1,
      seed: this.nav.seed,
      tick: this.tick,
      time: this.time,
      rng: this.rng.state,
      nextId: this.nextId,
      eventSeq: this.eventSeq,
      creatures: this.creatures.map((c) => ({ ...c, path: c.path ? c.path.slice() : null })),
      food: btoa(bin),
      weather: { ...this.weather },
      stats: structuredClone(this.stats),
      history: this.history.map((h) => h.slice()),
      events: this.events.slice()
    };
  }

  load(s: SimSave): void {
    if (s.seed !== this.nav.seed) throw new Error('Save belongs to a different world seed');
    this.tick = s.tick;
    this.time = s.time;
    this.rng.state = s.rng;
    this.nextId = s.nextId;
    this.eventSeq = s.eventSeq;
    this.creatures = s.creatures.map((c) => ({ ...c, path: c.path ? c.path.slice() : null }));
    this.byId = new Map(this.creatures.map((c) => [c.id, c]));
    const bin = atob(s.food);
    const bytes = new Uint8Array(this.food.length * 4);
    for (let i = 0; i < bytes.length && i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.food.set(new Float32Array(bytes.buffer));
    this.weather = { ...s.weather };
    this.lastWeatherKind = this.weather.kind;
    this.stats = structuredClone(s.stats);
    this.history = s.history.map((h) => h.slice());
    this.events = s.events.slice();
    this.countPopulations();
  }
}
