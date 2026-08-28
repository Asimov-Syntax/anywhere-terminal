// Round-9 B16: a value is also PRODUCED by a call, so the reference set round 8 assumed was closed
// is not. The fs function arrives here on a CallExpression, and no node in this file names it.

import { getRm } from "./helper-fs-factory";

export async function removeTree(dir: string): Promise<void> {
  await getRm()(dir, { recursive: true });
}
