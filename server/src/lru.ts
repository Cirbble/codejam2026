/** Small bounded LRU with a TTL (Map keeps insertion order; a hit moves the key to the end). */
export class Lru<V> {
  private m = new Map<string, { v: V; at: number }>();
  constructor(
    private max: number,
    private ttlMs: number,
  ) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    this.m.delete(k);
    if (Date.now() - e.at > this.ttlMs) return undefined;
    this.m.set(k, e);
    return e.v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, { v, at: Date.now() });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
  delete(k: string) {
    this.m.delete(k);
  }
  get size() {
    return this.m.size;
  }
}
