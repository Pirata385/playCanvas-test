import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generate';
import { WaterType } from '../src/world/types';

function checksum(a: ArrayLike<number>): number {
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + Math.round(a[i] * 1000)) | 0;
  return h;
}

describe('world generation', () => {
  const a = generateWorld(1337);

  it('is deterministic for the same seed', () => {
    const b = generateWorld(1337);
    expect(checksum(b.heights)).toBe(checksum(a.heights));
    expect(checksum(b.vegetation)).toBe(checksum(a.vegetation));
    expect(checksum(b.biome)).toBe(checksum(a.biome));
    expect(b.spawn).toEqual(a.spawn);
  });

  it('differs between seeds', () => {
    const c = generateWorld(2024);
    expect(checksum(c.heights)).not.toBe(checksum(a.heights));
  });

  it('produces an island with lakes, rivers and vegetation', () => {
    expect(a.stats.landFraction).toBeGreaterThan(0.25);
    expect(a.stats.landFraction).toBeLessThan(0.7);
    expect(a.stats.lakes).toBeGreaterThan(0);
    expect(a.stats.riverSamples).toBeGreaterThan(50);
    expect(a.stats.vegetation).toBeGreaterThan(500);
    // the border is ocean
    expect(a.waterType[0]).toBe(WaterType.Ocean);
    expect(a.waterType[a.res * a.res - 1]).toBe(WaterType.Ocean);
  });

  it('places the spawn on walkable land with reachable water', () => {
    const i = Math.round(a.spawn[1] / a.cell) * a.res + Math.round(a.spawn[0] / a.cell);
    expect(a.walkable[i]).toBe(1);
    expect(a.waterDist[i]).toBeLessThan(65535);
  });
});
