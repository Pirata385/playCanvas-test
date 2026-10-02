import { MinHeap } from '../core/heap';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Weighted A* over the walkability grid with an expansion budget. Reuses its
 * buffers between searches (generation stamps avoid clearing large arrays).
 */
export class GridPathfinder {
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap: MinHeap;

  constructor(private R: number, private walkable: Uint8Array, private extraCost: (i: number) => number = () => 0) {
    const N = R * R;
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.heap = new MinHeap(4096);
  }

  /** Returns a list of sample indices from start (exclusive) to goal, or null. */
  find(start: number, goal: number, budget = 6000): number[] | null {
    const R = this.R;
    if (!this.walkable[goal]) return null;
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    const gx = goal % R;
    const gz = (goal / R) | 0;
    const h = (i: number): number => {
      const dx = Math.abs((i % R) - gx);
      const dz = Math.abs(((i / R) | 0) - gz);
      return (Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz)) * 1.4;
    };
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.parent[start] = -1;
    heap.push(start, h(start));
    let expanded = 0;
    let best = start;
    let bestH = h(start);
    while (heap.size > 0 && expanded < budget) {
      const c = heap.pop();
      if (this.closed[c] === gen) continue;
      this.closed[c] = gen;
      expanded++;
      if (c === goal) return this.build(goal);
      const hc = h(c);
      if (hc < bestH) {
        bestH = hc;
        best = c;
      }
      const cx = c % R;
      const cz = (c / R) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
        const n = nz * R + nx;
        if (!this.walkable[n] || this.closed[n] === gen) continue;
        // forbid cutting corners diagonally past obstacles
        if (k >= 4 && (!this.walkable[cz * R + nx] || !this.walkable[nz * R + cx])) continue;
        const ng = this.g[c] + COST[k] + this.extraCost(n);
        if (this.stamp[n] !== gen || ng < this.g[n]) {
          this.stamp[n] = gen;
          this.g[n] = ng;
          this.parent[n] = c;
          heap.push(n, ng + h(n));
        }
      }
    }
    // budget exhausted: return a partial path towards the closest node found
    return best !== start ? this.build(best) : null;
  }

  private build(end: number): number[] {
    const path: number[] = [];
    let c = end;
    while (c >= 0 && this.parent[c] >= 0) {
      path.push(c);
      c = this.parent[c];
    }
    path.reverse();
    // thin the path: keep every other node, always keep the last
    const thin: number[] = [];
    for (let i = 1; i < path.length; i += 2) thin.push(path[i]);
    if (path.length && thin[thin.length - 1] !== path[path.length - 1]) thin.push(path[path.length - 1]);
    return thin;
  }
}
