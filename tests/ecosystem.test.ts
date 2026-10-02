import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generate';
import { extractNav } from '../src/world/types';
import { Ecosystem } from '../src/sim/Ecosystem';
import { DAY_SECONDS, TICK_SECONDS } from '../src/sim/time';

const world = generateWorld(777);
const ticksPerDay = DAY_SECONDS / TICK_SECONDS;

function digest(e: Ecosystem): string {
  return JSON.stringify(e.creatures.map((c) => [c.id, c.state, c.x.toFixed(4), c.z.toFixed(4), c.hunger.toFixed(5)])) + e.tick;
}

describe('ecosystem', () => {
  it('is deterministic for the same seed', () => {
    const a = new Ecosystem(extractNav(world));
    const b = new Ecosystem(extractNav(world));
    for (let i = 0; i < 2000; i++) {
      a.step();
      b.step();
    }
    expect(digest(a)).toBe(digest(b));
  });

  it('keeps every species alive over several days', () => {
    const e = new Ecosystem(extractNav(world));
    for (let i = 0; i < ticksPerDay * 6; i++) e.step();
    for (const p of e.populations) expect(p).toBeGreaterThan(0);
    expect(e.stats.births.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(e.history.length).toBeGreaterThan(100);
  });

  it('resumes identically from a save', () => {
    const a = new Ecosystem(extractNav(world));
    for (let i = 0; i < 1500; i++) a.step();
    const save = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Ecosystem(extractNav(world));
    b.load(save);
    for (let i = 0; i < 1500; i++) {
      a.step();
      b.step();
    }
    expect(digest(b)).toBe(digest(a));
  });

  it('rejects saves from a different seed', () => {
    const a = new Ecosystem(extractNav(world));
    const other = new Ecosystem(extractNav(generateWorld(778)));
    expect(() => a.load(other.serialize())).toThrow();
  });
});
