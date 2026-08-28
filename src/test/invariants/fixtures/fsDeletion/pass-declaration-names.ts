// Round-10 W8: a declaration's NAME is a sibling of its annotation, not a descendant, so skipping
// type-node descendants never reached it. Each name below is typed as a destructive fs function and
// none of them executes anything — reporting them would fail the tripwire on declaration-only code.
//
// Nothing here may reference a name at runtime. `typeof ambient` in a VALUE position is the
// JavaScript operator, not the type query, and the rule is right to report it.

import type fs from "node:fs";

declare const ambient: typeof fs.promises.rm;

export type Remover = typeof ambient;

export interface RemovalPort {
  rm: typeof fs.promises.rm;
}

export function describeRemoval(_rm: typeof fs.promises.rm, dir: string): string {
  return dir;
}
