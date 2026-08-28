function rm(target: string): string {
  return `would remove ${target}`;
}

export function describeRemoval(dir: string): string {
  return rm(dir);
}
