// Fail-closed must stay narrow: an erased type is only a finding when the member it selects is
// one of the destructive fs names. Without this case, tightening the rule further would go
// unnoticed until it fired across production.

export function describeRemoval(handle: unknown, dir: string): string {
  return String((handle as any).writeSummary(dir));
}
