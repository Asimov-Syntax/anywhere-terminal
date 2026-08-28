export function describeRemoval(rm: (target: string) => string, dir: string): string {
  return rm(dir);
}
