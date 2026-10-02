/** Binary min-heap of integer items keyed by float priority. Allocation-free after construction. */
export class MinHeap {
  private keys: Float64Array;
  private items: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.items = new Int32Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(item: number, key: number): void {
    if (this.size >= this.items.length) this.grow();
    let i = this.size++;
    const keys = this.keys;
    const items = this.items;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      items[i] = items[p];
      i = p;
    }
    keys[i] = key;
    items[i] = item;
  }

  peekKey(): number {
    return this.keys[0];
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const item = items[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        items[i] = items[c];
        i = c;
      }
      keys[i] = key;
      items[i] = item;
    }
    return top;
  }

  private grow(): void {
    const k = new Float64Array(this.keys.length * 2);
    const it = new Int32Array(this.items.length * 2);
    k.set(this.keys);
    it.set(this.items);
    this.keys = k;
    this.items = it;
  }
}
