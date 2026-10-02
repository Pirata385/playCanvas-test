import { clamp } from '../core/math';
import { sampleHeight } from './generate';
import { Biome, WaterType, type WorldData } from './types';

/** Fast spatial queries against generated world data (main thread). */
export class WorldQuery {
  readonly R: number;
  readonly cell: number;
  readonly size: number;

  constructor(readonly data: WorldData) {
    this.R = data.res;
    this.cell = data.cell;
    this.size = data.size;
  }

  index(x: number, z: number): number {
    const ix = clamp(Math.round(x / this.cell), 0, this.R - 1);
    const iz = clamp(Math.round(z / this.cell), 0, this.R - 1);
    return iz * this.R + ix;
  }

  heightAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return -20;
    return sampleHeight(this.data.heights, this.R, this.cell, x, z);
  }

  /** Water surface height at a point, or -Infinity if dry. Ocean extends beyond the map. */
  waterAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return 0;
    const i = this.index(x, z);
    const t = this.data.waterType[i] as WaterType;
    if (t === WaterType.None) return -Infinity;
    return this.data.waterLevel[i];
  }

  waterTypeAt(x: number, z: number): WaterType {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return WaterType.Ocean;
    return this.data.waterType[this.index(x, z)] as WaterType;
  }

  biomeAt(x: number, z: number): Biome {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return Biome.Ocean;
    return this.data.biome[this.index(x, z)] as Biome;
  }

  oceanDistAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return 0;
    return this.data.oceanDist[this.index(x, z)];
  }

  freshDistAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return 1e9;
    return this.data.freshDist[this.index(x, z)];
  }

  isWalkable(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return false;
    return this.data.walkable[this.index(x, z)] === 1;
  }
}
