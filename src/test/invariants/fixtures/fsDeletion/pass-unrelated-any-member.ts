// W7: fail-closed must be decided by an expression's provenance, not by the member's name. This
// cache shares a name with an fs deletion and has nothing to do with the filesystem.

export function evict(cache: any, key: string): void {
  cache.rm(key);
}
