// Round-9 B17, and the reason D10 stopped claiming soundness: TypeScript's type identity is
// STRUCTURAL. `owner.rmSync` belongs to the local parameter type, not to @types/node/fs, so no
// type-based rule can tell this apart from any other object with a method of that shape.
//
// `removeTree` is reached here with the real `fs` namespace (round-10 W11). Without that caller the
// file would only show an ordinary local interface, not a node:fs value laundered through one.

import fs from "node:fs";

export function removeTree(owner: { rmSync(path: string, options: { recursive: boolean }): void }, dir: string): void {
  owner.rmSync(dir, { recursive: true });
}

export function removeWithNodeFs(dir: string): void {
  removeTree(fs, dir);
}
