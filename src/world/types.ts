import type { RGB } from '../core/math';

/** Samples per side of the world grid (vertices). */
export const WORLD_RES = 257;
/** Metres between grid samples. */
export const WORLD_CELL = 2;
/** Side length of the playable square in metres. */
export const WORLD_SIZE = (WORLD_RES - 1) * WORLD_CELL;
export const SEA_LEVEL = 0;

export enum Biome {
  Ocean,
  Beach,
  Grassland,
  Forest,
  Taiga,
  Savanna,
  Marsh,
  Rock,
  Snow,
  Lakebed
}

export interface BiomeInfo {
  name: string;
  color: RGB;
  /** Maximum grazing food a sample can hold (0..1). */
  foodCap: number;
  /** Food regrowth per sim-day as a fraction of capacity. */
  foodRegen: number;
}

export const BIOMES: Record<Biome, BiomeInfo> = {
  [Biome.Ocean]: { name: 'Ocean', color: [0.76, 0.7, 0.5], foodCap: 0, foodRegen: 0 },
  [Biome.Beach]: { name: 'Beach', color: [0.86, 0.79, 0.57], foodCap: 0.1, foodRegen: 0.5 },
  [Biome.Grassland]: { name: 'Grassland', color: [0.42, 0.62, 0.25], foodCap: 1, foodRegen: 1.6 },
  [Biome.Forest]: { name: 'Forest', color: [0.24, 0.45, 0.18], foodCap: 0.7, foodRegen: 1.2 },
  [Biome.Taiga]: { name: 'Taiga', color: [0.3, 0.42, 0.3], foodCap: 0.45, foodRegen: 0.9 },
  [Biome.Savanna]: { name: 'Savanna', color: [0.7, 0.66, 0.36], foodCap: 0.6, foodRegen: 0.9 },
  [Biome.Marsh]: { name: 'Marsh', color: [0.33, 0.45, 0.28], foodCap: 0.85, foodRegen: 1.6 },
  [Biome.Rock]: { name: 'Mountain', color: [0.5, 0.48, 0.45], foodCap: 0.05, foodRegen: 0.3 },
  [Biome.Snow]: { name: 'Snowcap', color: [0.93, 0.95, 0.98], foodCap: 0, foodRegen: 0 },
  [Biome.Lakebed]: { name: 'Water', color: [0.45, 0.4, 0.3], foodCap: 0, foodRegen: 0 }
};

export enum WaterType {
  None = 0,
  Ocean = 1,
  Lake = 2,
  River = 3
}

export enum VegType {
  Oak,
  Pine,
  Palm,
  Birch,
  Acacia,
  Bush,
  Rock,
  Boulder,
  Grass,
  Reed,
  Flower
}

export const VEG_TYPE_COUNT = 11;
export const VEG_NAMES = ['Oak', 'Pine', 'Palm', 'Birch', 'Acacia', 'Bush', 'Rock', 'Boulder', 'Grass', 'Reed', 'Flower'];
/** Vegetation types that get a physics collider and block creature movement. */
export const SOLID_VEG = new Set<VegType>([VegType.Oak, VegType.Pine, VegType.Palm, VegType.Birch, VegType.Acacia, VegType.Boulder]);
/** Floats per vegetation instance: type, x, y, z, scale, rotation. */
export const VEG_STRIDE = 6;

export interface WorldStats {
  landFraction: number;
  lakes: number;
  riverSamples: number;
  maxHeight: number;
  vegetation: number;
  genMs: number;
}

/** Everything the procedural generator produces. All arrays are row-major (z * res + x). */
export interface WorldData {
  seed: number;
  res: number;
  cell: number;
  size: number;
  heights: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  slope: Float32Array;
  waterLevel: Float32Array;
  waterType: Uint8Array;
  biome: Uint8Array;
  moisture: Float32Array;
  walkable: Uint8Array;
  /** Grid steps to the nearest drinkable spot (65535 = unreachable). */
  waterDist: Uint16Array;
  /** Metres to the ocean. */
  oceanDist: Float32Array;
  /** Metres to fresh water (lake or river). */
  freshDist: Float32Array;
  foodCap: Float32Array;
  vegetation: Float32Array;
  mapPixels: Uint8ClampedArray;
  spawn: [number, number];
  stats: WorldStats;
}

export function worldTransferables(w: WorldData): Transferable[] {
  return [
    w.heights.buffer, w.normals.buffer, w.colors.buffer, w.slope.buffer, w.waterLevel.buffer,
    w.waterType.buffer, w.biome.buffer, w.moisture.buffer, w.walkable.buffer, w.waterDist.buffer,
    w.oceanDist.buffer, w.freshDist.buffer, w.foodCap.buffer, w.vegetation.buffer, w.mapPixels.buffer
  ] as Transferable[];
}

/** The subset of world data the ecosystem simulation needs. */
export interface NavData {
  seed: number;
  res: number;
  cell: number;
  heights: Float32Array;
  walkable: Uint8Array;
  waterDist: Uint16Array;
  waterType: Uint8Array;
  foodCap: Float32Array;
  biome: Uint8Array;
}

export function extractNav(w: WorldData): NavData {
  return {
    seed: w.seed,
    res: w.res,
    cell: w.cell,
    heights: w.heights.slice(),
    walkable: w.walkable.slice(),
    waterDist: w.waterDist.slice(),
    waterType: w.waterType.slice(),
    foodCap: w.foodCap.slice(),
    biome: w.biome.slice()
  };
}
