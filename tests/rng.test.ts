import { describe, expect, it } from 'vitest';
import { Rng, hashString, parseSeed } from '../src/core/rng';
import { MinHeap } from '../src/core/heap';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('can resume from serialised state', () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(0);
    b.state = a.state;
    expect(b.next()).toBe(a.next());
  });

  it('parses numeric and text seeds', () => {
    expect(parseSeed('1234')).toBe(1234);
    expect(parseSeed('island')).toBe(hashString('island'));
  });
});

describe('MinHeap', () => {
  it('pops in ascending key order', () => {
    const h = new MinHeap(2);
    const keys = [5, 1, 9, 3, 7, 2, 8];
    keys.forEach((k, i) => h.push(i, k));
    const out: number[] = [];
    while (h.size) out.push(keys[h.pop()]);
    expect(out).toEqual([...keys].sort((a, b) => a - b));
  });
});
