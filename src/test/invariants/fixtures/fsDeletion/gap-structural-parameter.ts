// Round-9 B17, and the reason D10 stopped claiming soundness: TypeScript's type identity is
// STRUCTURAL. `rmSync` here belongs to the local parameter type, not to @types/node/fs, so no
// type-based rule can tell this apart from any other object with a method of that shape.

export function removeTree(owner: { rmSync(path: string, options: { recursive: boolean }): void }, dir: string): void {
  owner.rmSync(dir, { recursive: true });
}
