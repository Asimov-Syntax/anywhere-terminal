// W7, the index form: an erased owner reached by a runtime key, with no fs anywhere in its chain.

export function evict(cache: any, key: string): void {
  cache[key]();
}
