// Not a fixture: no flag-/pass-/gap- prefix, so the gate asserts nothing about this file. It models
// a helper living OUTSIDE the enforced scope, which is what makes gap-call-produced.ts a real gap
// rather than an artefact of both halves sitting in one file.

import fs from "node:fs";

export function getRm(): (p: string, o: { recursive: boolean }) => Promise<void> {
  return fs.promises.rm;
}
