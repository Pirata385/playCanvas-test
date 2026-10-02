import { Rng, hash2 } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/math';
import { MinHeap } from '../core/heap';
import { Noise2D } from './noise';
import {
  BIOMES, Biome, SOLID_VEG, VegType, VEG_STRIDE, WaterType, WORLD_CELL, WORLD_RES, WORLD_SIZE,
  type WorldData
} from './types';

export type ProgressFn = (stage: string, fraction: number) => void;

const NEIGH8_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGH8_DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const NEIGH8_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Pure, deterministic island generator. Runs inside a Web Worker in the game,
 * and directly in unit tests. Same seed => bit-identical output.
 */
export function generateWorld(seed: number, progress: ProgressFn = () => {}): WorldData {
  const t0 = performance.now();
  const R = WORLD_RES;
  const N = R * R;
  const cell = WORLD_CELL;
  const rng = new Rng(seed);
  const nHeight = new Noise2D(rng.fork('height').next() * 2 ** 32);
  const nWarp = new Noise2D(rng.fork('warp').next() * 2 ** 32);
  const nRidge = new Noise2D(rng.fork('ridge').next() * 2 ** 32);
  const nMask = new Noise2D(rng.fork('mask').next() * 2 ** 32);
  const nMoist = new Noise2D(rng.fork('moist').next() * 2 ** 32);
  const nDetail = new Noise2D(rng.fork('detail').next() * 2 ** 32);

  // ---------------------------------------------------------------- elevation
  progress('Shaping terrain', 0.05);
  const h = new Float32Array(N);
  const offX = rng.range(-50, 50);
  const offZ = rng.range(-50, 50);
  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const nx = (x / (R - 1)) * 2 - 1;
      const nz = (z / (R - 1)) * 2 - 1;
      const wx = nx + 0.22 * nWarp.fbm(nx * 1.4 + offX, nz * 1.4 + offZ, 3);
      const wz = nz + 0.22 * nWarp.fbm(nx * 1.4 - offZ + 9.1, nz * 1.4 + offX - 3.7, 3);
      const d = Math.sqrt(wx * wx + wz * wz);
      const coast = 1 - smoothstep(0.42, 1.0, d);
      const cone = clamp(1 - d, 0, 1);
      const base = nHeight.fbm(nx * 2.3 + offX, nz * 2.3 + offZ, 5);
      const ridge = nRidge.ridged(nx * 1.7 + offZ, nz * 1.7 - offX, 4);
      const mMask = smoothstep(0.25, 0.8, cone) * smoothstep(-0.3, 0.4, nMask.fbm(nx * 1.3 + offX, nz * 1.3, 2));
      const e = coast * 0.5 - 0.3 + cone * 0.42 + base * 0.11 + ridge * mMask * 0.28;
      h[z * R + x] = e > 0 ? Math.pow(e, 1.6) * 105 : Math.max(-20, e * 34);
    }
  }

  // ---------------------------------------------------------------- lake basins
  progress('Carving lakes', 0.15);
  const lakeRng = rng.fork('lakes');
  const lakeSites: Array<[number, number]> = [];
  const wantLakes = lakeRng.int(3, 5);
  for (let attempt = 0; attempt < 300 && lakeSites.length < wantLakes; attempt++) {
    const lx = lakeRng.int(40, R - 41);
    const lz = lakeRng.int(40, R - 41);
    const hh = h[lz * R + lx];
    if (hh < 5 || hh > 36) continue;
    if (lakeSites.some(([sx, sz]) => Math.hypot(sx - lx, sz - lz) < 35)) continue;
    lakeSites.push([lx, lz]);
    const radius = lakeRng.range(6, 11); // in samples
    const depth = lakeRng.range(5, 9);
    const r2 = radius * 1.4;
    for (let z = Math.max(0, Math.floor(lz - r2)); z <= Math.min(R - 1, Math.ceil(lz + r2)); z++) {
      for (let x = Math.max(0, Math.floor(lx - r2)); x <= Math.min(R - 1, Math.ceil(lx + r2)); x++) {
        const wob = 1 + 0.25 * nDetail.noise(x * 0.15, z * 0.15);
        const dist = Math.hypot(x - lx, z - lz) / (radius * wob);
        if (dist >= 1.4) continue;
        const f = 1 - smoothstep(0, 1.4, dist);
        h[z * R + x] -= depth * f * f * (3 - 2 * f);
      }
    }
  }

  // ---------------------------------------------------------------- depression filling
  progress('Filling depressions', 0.25);
  const filled = priorityFlood(h, R, 0, null);
  const waterType = new Uint8Array(N);
  const waterLevel = new Float32Array(N).fill(-1000);
  const lakeCandidate = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (filled[i] <= 0) {
      waterType[i] = WaterType.Ocean;
      waterLevel[i] = 0;
    } else if (filled[i] - h[i] > 0.15) {
      lakeCandidate[i] = 1;
    }
  }
  // Connected lake components: small pits are filled in, larger ones become lakes.
  let lakeCount = 0;
  const comp = new Int32Array(N).fill(-1);
  const stack: number[] = [];
  const members: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!lakeCandidate[i] || comp[i] >= 0) continue;
    members.length = 0;
    stack.push(i);
    comp[i] = i;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      const cx = c % R;
      const cz = (c / R) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + NEIGH8_DX[k];
        const nz = cz + NEIGH8_DZ[k];
        if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
        const n = nz * R + nx;
        if (lakeCandidate[n] && comp[n] < 0) {
          comp[n] = i;
          stack.push(n);
        }
      }
    }
    if (members.length < 14) {
      for (const m of members) h[m] = filled[m] + 0.02;
    } else {
      lakeCount++;
      for (const m of members) {
        waterType[m] = WaterType.Lake;
        waterLevel[m] = filled[m];
      }
    }
  }

  // ---------------------------------------------------------------- moisture
  progress('Simulating rainfall', 0.35);
  const moisture = new Float32Array(N);
  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const nx = x / (R - 1);
      const nz = z / (R - 1);
      const i = z * R + x;
      moisture[i] = clamp(0.5 + 0.55 * nMoist.fbm(nx * 3 + offX, nz * 3 + offZ, 4) + Math.max(0, h[i]) * 0.003, 0, 1);
    }
  }

  // ---------------------------------------------------------------- drainage & rivers
  progress('Routing rivers', 0.45);
  const receiver = new Int32Array(N).fill(-1);
  const order: number[] = [];
  const fe = priorityFlood(h, R, 1e-3, { receiver, order });
  const acc = new Float32Array(N);
  for (let i = 0; i < N; i++) acc[i] = waterType[i] === WaterType.Ocean ? 0 : 1 + moisture[i] * 2;
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k];
    const r = receiver[c];
    if (r >= 0 && waterType[c] !== WaterType.Ocean) acc[r] += acc[c];
  }
  const landAcc: number[] = [];
  for (let i = 0; i < N; i++) if (waterType[i] === WaterType.None) landAcc.push(acc[i]);
  landAcc.sort((a, b) => a - b);
  const threshold = Math.max(160, landAcc[Math.floor(landAcc.length * 0.982)] ?? 160);
  let riverSamples = 0;
  const isRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (waterType[i] !== WaterType.None || acc[i] < threshold) continue;
    isRiver[i] = 1;
  }
  // widen large rivers
  for (let i = 0; i < N; i++) {
    if (!isRiver[i] || acc[i] < threshold * 5) continue;
    const x = i % R;
    const z = (i / R) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + NEIGH8_DX[k];
      const nz = z + NEIGH8_DZ[k];
      if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
      const n = nz * R + nx;
      if (waterType[n] === WaterType.None && !isRiver[n]) isRiver[n] = 2;
    }
  }
  for (let i = 0; i < N; i++) {
    if (!isRiver[i]) continue;
    const main = isRiver[i] === 1;
    const strength = main ? Math.min(1.6, Math.sqrt(acc[i] / threshold) * 0.5) : 0.4;
    const level = Math.max(0.12, fe[i] - 0.2);
    const depth = 0.7 + strength;
    waterType[i] = WaterType.River;
    waterLevel[i] = level;
    h[i] = Math.min(h[i], level - depth);
    riverSamples++;
  }
  // Lower banks so rivers sit in shallow valleys.
  for (let i = 0; i < N; i++) {
    if (waterType[i] !== WaterType.River) continue;
    const x = i % R;
    const z = (i / R) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + NEIGH8_DX[k];
      const nz = z + NEIGH8_DZ[k];
      if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
      const n = nz * R + nx;
      if (waterType[n] !== WaterType.None) continue;
      const target = waterLevel[i] + 0.35 + Math.max(0, h[n] - waterLevel[i]) * 0.45;
      if (h[n] > target) h[n] = target;
    }
  }

  // ---------------------------------------------------------------- distance fields
  progress('Measuring distances', 0.55);
  const oceanDist = distanceField(R, cell, (i) => waterType[i] === WaterType.Ocean);
  const freshDist = distanceField(R, cell, (i) => waterType[i] === WaterType.Lake || waterType[i] === WaterType.River);
  for (let i = 0; i < N; i++) moisture[i] = clamp(moisture[i] + 0.4 * Math.exp(-freshDist[i] / 22), 0, 1);

  // ---------------------------------------------------------------- slope & normals
  const slope = new Float32Array(N);
  const normals = new Float32Array(N * 3);
  let maxHeight = -Infinity;
  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const i = z * R + x;
      const hl = h[z * R + Math.max(0, x - 1)];
      const hr = h[z * R + Math.min(R - 1, x + 1)];
      const hd = h[Math.max(0, z - 1) * R + x];
      const hu = h[Math.min(R - 1, z + 1) * R + x];
      const dx = (hr - hl) / (2 * cell);
      const dz = (hu - hd) / (2 * cell);
      slope[i] = Math.sqrt(dx * dx + dz * dz);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      normals[i * 3] = -dx * inv;
      normals[i * 3 + 1] = inv;
      normals[i * 3 + 2] = -dz * inv;
      if (h[i] > maxHeight) maxHeight = h[i];
    }
  }

  // ---------------------------------------------------------------- biomes
  progress('Painting biomes', 0.65);
  const biome = new Uint8Array(N);
  let land = 0;
  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const i = z * R + x;
      const hh = h[i];
      const wt = waterType[i];
      const n1 = nDetail.noise(x * 0.08, z * 0.08);
      let b: Biome;
      if (wt === WaterType.Ocean) b = Biome.Ocean;
      else if (wt !== WaterType.None) b = Biome.Lakebed;
      else {
        land++;
        const m = moisture[i];
        const temp = 1 - hh / 80 + n1 * 0.06;
        if (hh < 1.6 + n1 * 0.8 && oceanDist[i] < 14) b = Biome.Beach;
        else if (hh > 66 + n1 * 5) b = Biome.Snow;
        else if (slope[i] > 1.1 || hh > 54 + n1 * 6) b = Biome.Rock;
        else if (m > 0.66 && hh < 12 && freshDist[i] < 26) b = Biome.Marsh;
        else if (temp < 0.6 && m > 0.32) b = Biome.Taiga;
        else if (m > 0.57) b = Biome.Forest;
        else if (m < 0.36) b = Biome.Savanna;
        else b = Biome.Grassland;
      }
      biome[i] = b;
    }
  }

  // ---------------------------------------------------------------- vertex colours & map
  progress('Colouring', 0.72);
  const colors = new Uint8Array(N * 4);
  const mapPixels = new Uint8ClampedArray(N * 4);
  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const i = z * R + x;
      const b = biome[i] as Biome;
      let [r, g, bl] = BIOMES[b].color;
      const v = 0.9 + 0.2 * hash2(x, z, seed) + 0.08 * nDetail.noise(x * 0.25, z * 0.25);
      if (b === Biome.Ocean) {
        const dd = clamp(-h[i] / 18, 0, 1);
        r = lerp(0.74, 0.32, dd); g = lerp(0.68, 0.36, dd); bl = lerp(0.48, 0.32, dd);
      } else if (b !== Biome.Rock && b !== Biome.Snow && b !== Biome.Beach && b !== Biome.Lakebed) {
        // blend to rock on steep slopes, damp earth near water
        const rockT = smoothstep(0.55, 1.0, slope[i]);
        r = lerp(r, 0.47, rockT); g = lerp(g, 0.45, rockT); bl = lerp(bl, 0.42, rockT);
        const wet = Math.exp(-freshDist[i] / 6) * 0.5;
        r = lerp(r, 0.36, wet); g = lerp(g, 0.34, wet); bl = lerp(bl, 0.22, wet);
      }
      colors[i * 4] = clamp(r * v * 255, 0, 255);
      colors[i * 4 + 1] = clamp(g * v * 255, 0, 255);
      colors[i * 4 + 2] = clamp(bl * v * 255, 0, 255);
      colors[i * 4 + 3] = 255;

      // minimap: hill-shaded biome colour, water tinted blue
      const shade = clamp(0.75 + (normals[i * 3] - normals[i * 3 + 2]) * 0.9, 0.45, 1.25);
      let mr = r * shade, mg = g * shade, mb = bl * shade;
      if (waterType[i] === WaterType.Ocean) {
        const dd = clamp(-h[i] / 20, 0, 1);
        mr = lerp(0.25, 0.08, dd); mg = lerp(0.55, 0.22, dd); mb = lerp(0.72, 0.45, dd);
      } else if (waterType[i] !== WaterType.None) {
        mr = 0.22; mg = 0.5; mb = 0.75;
      }
      mapPixels[i * 4] = mr * 255;
      mapPixels[i * 4 + 1] = mg * 255;
      mapPixels[i * 4 + 2] = mb * 255;
      mapPixels[i * 4 + 3] = 255;
    }
  }

  // ---------------------------------------------------------------- vegetation
  progress('Planting vegetation', 0.88);
  const vegetation = placeVegetation(seed, h, slope, biome, waterType, freshDist, R, cell);

  // ---------------------------------------------------------------- navigation
  progress('Building navigation grid', 0.8);
  const walkable = new Uint8Array(N);
  const foodCap = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const wtp = waterType[i];
    const ok = (wtp === WaterType.None || wtp === WaterType.River) && h[i] > -0.5 && slope[i] < 1.15;
    walkable[i] = ok ? 1 : 0;
    foodCap[i] = ok && wtp === WaterType.None ? BIOMES[biome[i] as Biome].foodCap * (0.75 + 0.5 * hash2(i, 7, seed)) : 0;
  }
  // tree trunks and boulders are obstacles for creatures
  for (let v = 0; v < vegetation.length; v += VEG_STRIDE) {
    if (!SOLID_VEG.has(vegetation[v] as VegType)) continue;
    walkable[Math.round(vegetation[v + 3] / cell) * R + Math.round(vegetation[v + 1] / cell)] = 0;
  }
  const waterDist = new Uint16Array(N).fill(65535);
  {
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let z = 0; z < R; z++) {
      for (let x = 0; x < R; x++) {
        const i = z * R + x;
        if (!walkable[i]) continue;
        let drink = waterType[i] === WaterType.River;
        for (let k = 0; k < 4 && !drink; k++) {
          const nx = x + NEIGH8_DX[k];
          const nz = z + NEIGH8_DZ[k];
          if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
          const wtn = waterType[nz * R + nx];
          if (wtn === WaterType.Lake || wtn === WaterType.River) drink = true;
        }
        if (drink) {
          waterDist[i] = 0;
          queue[qt++] = i;
        }
      }
    }
    while (qh < qt) {
      const c = queue[qh++];
      const cx = c % R;
      const cz = (c / R) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NEIGH8_DX[k];
        const nz = cz + NEIGH8_DZ[k];
        if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
        const n = nz * R + nx;
        if (!walkable[n] || waterDist[n] !== 65535) continue;
        waterDist[n] = waterDist[c] + 1;
        queue[qt++] = n;
      }
    }
  }

  // ---------------------------------------------------------------- spawn point
  const spawn = findSpawn(h, slope, biome, walkable, waterDist, R, cell);

  progress('Done', 1);
  return {
    seed,
    res: R,
    cell,
    size: WORLD_SIZE,
    heights: h,
    normals,
    colors,
    slope,
    waterLevel,
    waterType,
    biome,
    moisture,
    walkable,
    waterDist,
    oceanDist,
    freshDist,
    foodCap,
    vegetation,
    mapPixels,
    spawn,
    stats: {
      landFraction: land / N,
      lakes: lakeCount,
      riverSamples,
      maxHeight,
      vegetation: vegetation.length / VEG_STRIDE,
      genMs: performance.now() - t0
    }
  };
}

/**
 * Priority-flood depression filling (Barnes et al.). With epsilon > 0 every
 * sample gets a strictly downhill path to the border, and `receiver` records
 * that drainage tree (the sample each one flows into).
 */
function priorityFlood(
  h: Float32Array,
  R: number,
  epsilon: number,
  out: { receiver: Int32Array; order: number[] } | null
): Float32Array {
  const N = R * R;
  const f = new Float32Array(N);
  const closed = new Uint8Array(N);
  const heap = new MinHeap(N);
  for (let i = 0; i < N; i++) {
    const x = i % R;
    const z = (i / R) | 0;
    if (x === 0 || z === 0 || x === R - 1 || z === R - 1) {
      f[i] = h[i];
      closed[i] = 1;
      heap.push(i, f[i]);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    out?.order.push(c);
    const cx = c % R;
    const cz = (c / R) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NEIGH8_DX[k];
      const nz = cz + NEIGH8_DZ[k];
      if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
      const n = nz * R + nx;
      if (closed[n]) continue;
      closed[n] = 1;
      f[n] = Math.max(h[n], f[c] + epsilon);
      if (out) out.receiver[n] = c;
      heap.push(n, f[n]);
    }
  }
  return f;
}

/** Multi-source Dijkstra distance (metres) on the 8-connected grid. */
function distanceField(R: number, cell: number, isSource: (i: number) => boolean): Float32Array {
  const N = R * R;
  const d = new Float32Array(N).fill(1e9);
  const heap = new MinHeap(N);
  for (let i = 0; i < N; i++) {
    if (isSource(i)) {
      d[i] = 0;
      heap.push(i, 0);
    }
  }
  while (heap.size > 0) {
    const key = heap.peekKey();
    const c = heap.pop();
    if (key > d[c]) continue;
    const cx = c % R;
    const cz = (c / R) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NEIGH8_DX[k];
      const nz = cz + NEIGH8_DZ[k];
      if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
      const n = nz * R + nx;
      const nd = d[c] + NEIGH8_COST[k] * cell;
      if (nd < d[n]) {
        d[n] = nd;
        heap.push(n, nd);
      }
    }
  }
  return d;
}

/** Per-biome vegetation probabilities for a candidate point. */
const VEG_TABLE: Partial<Record<Biome, Array<[VegType, number]>>> = {
  [Biome.Grassland]: [[VegType.Grass, 0.34], [VegType.Flower, 0.09], [VegType.Bush, 0.03], [VegType.Oak, 0.018], [VegType.Rock, 0.01]],
  [Biome.Forest]: [[VegType.Oak, 0.13], [VegType.Birch, 0.06], [VegType.Bush, 0.07], [VegType.Grass, 0.12], [VegType.Flower, 0.02], [VegType.Rock, 0.01], [VegType.Boulder, 0.004]],
  [Biome.Taiga]: [[VegType.Pine, 0.19], [VegType.Rock, 0.03], [VegType.Bush, 0.03], [VegType.Grass, 0.05], [VegType.Boulder, 0.006]],
  [Biome.Savanna]: [[VegType.Acacia, 0.014], [VegType.Grass, 0.26], [VegType.Bush, 0.02], [VegType.Rock, 0.012]],
  [Biome.Marsh]: [[VegType.Reed, 0.42], [VegType.Grass, 0.1], [VegType.Birch, 0.015], [VegType.Flower, 0.03]],
  [Biome.Beach]: [[VegType.Palm, 0.022], [VegType.Rock, 0.012]],
  [Biome.Rock]: [[VegType.Rock, 0.06], [VegType.Boulder, 0.03], [VegType.Pine, 0.012]],
  [Biome.Snow]: [[VegType.Boulder, 0.006]]
};

const VEG_SCALE: Record<VegType, [number, number]> = {
  [VegType.Oak]: [0.8, 1.35],
  [VegType.Pine]: [0.8, 1.5],
  [VegType.Palm]: [0.85, 1.2],
  [VegType.Birch]: [0.8, 1.2],
  [VegType.Acacia]: [0.9, 1.3],
  [VegType.Bush]: [0.7, 1.3],
  [VegType.Rock]: [0.5, 1.4],
  [VegType.Boulder]: [1.0, 2.2],
  [VegType.Grass]: [0.7, 1.3],
  [VegType.Reed]: [0.8, 1.3],
  [VegType.Flower]: [0.7, 1.2]
};

function placeVegetation(
  seed: number, h: Float32Array, slope: Float32Array, biome: Uint8Array, waterType: Uint8Array,
  freshDist: Float32Array, R: number, cell: number
): Float32Array {
  const rng = new Rng(seed).fork('vegetation');
  const spacing = 3;
  const steps = Math.floor(((R - 1) * cell) / spacing);
  const out: number[] = [];
  for (let gz = 0; gz < steps; gz++) {
    for (let gx = 0; gx < steps; gx++) {
      const x = (gx + 0.5) * spacing + rng.range(-1.3, 1.3);
      const z = (gz + 0.5) * spacing + rng.range(-1.3, 1.3);
      const roll = rng.next();
      const scaleRoll = rng.next();
      const rot = rng.range(0, Math.PI * 2);
      const sx = Math.round(x / cell);
      const sz = Math.round(z / cell);
      if (sx < 1 || sz < 1 || sx >= R - 1 || sz >= R - 1) continue;
      const i = sz * R + sx;
      if (waterType[i] !== WaterType.None) continue;
      const table = VEG_TABLE[biome[i] as Biome];
      if (!table) continue;
      let acc = 0;
      let chosen: VegType | -1 = -1;
      for (const [type, p] of table) {
        acc += p;
        if (roll < acc) {
          chosen = type;
          break;
        }
      }
      if (chosen === -1) continue;
      const tall = chosen <= VegType.Acacia;
      if (tall && (slope[i] > 0.75 || freshDist[i] < 3)) continue;
      if (chosen === VegType.Reed && freshDist[i] > 14) continue;
      const [s0, s1] = VEG_SCALE[chosen];
      const y = sampleHeight(h, R, cell, x, z);
      out.push(chosen, x, y, z, s0 + (s1 - s0) * scaleRoll, rot);
    }
  }
  return new Float32Array(out);
}

function findSpawn(
  h: Float32Array, slope: Float32Array, biome: Uint8Array, walkable: Uint8Array, waterDist: Uint16Array,
  R: number, cell: number
): [number, number] {
  const cx = R / 2;
  const cz = R * 0.62;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < R * R; i++) {
    if (!walkable[i] || h[i] < 2 || h[i] > 25 || slope[i] > 0.35) continue;
    const b = biome[i];
    if (b !== Biome.Grassland && b !== Biome.Savanna && b !== Biome.Forest) continue;
    const x = i % R;
    const z = (i / R) | 0;
    const score = Math.hypot(x - cx, z - cz) + (waterDist[i] > 40 ? 30 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) {
    for (let i = 0; i < R * R; i++) if (walkable[i] && h[i] > 1) { best = i; break; }
  }
  if (best < 0) best = Math.floor(R * R / 2);
  return [(best % R) * cell, ((best / R) | 0) * cell];
}

/** Height on the rendered terrain surface (matches the mesh triangulation). */
export function sampleHeight(h: ArrayLike<number>, R: number, cell: number, x: number, z: number): number {
  const fx = clamp(x / cell, 0, R - 1.0001);
  const fz = clamp(z / cell, 0, R - 1.0001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * R + ix;
  const h00 = h[i];
  const h10 = h[i + 1];
  const h01 = h[i + R];
  const h11 = h[i + R + 1];
  if (tx > tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
}
