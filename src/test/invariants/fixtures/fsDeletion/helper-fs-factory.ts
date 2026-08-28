// Not a fixture: no flag-/pass-/gap- prefix, so the gate asserts nothing about this file. It models
// a helper living OUTSIDE the enforced scope, which is what makes gap-call-produced.ts a real gap
// rather than an artefact of both halves sitting in one file.
//
// The return type is `typeof fs.promises.rm` on purpose (round-10 W10). Annotated with an anonymous
// structural signature instead, the value would be erased by B17 before the unscanned CallExpression
// ever mattered, and the fixture would prove the wrong limit.

import fs from "node:fs";

export function getRm(): typeof fs.promises.rm {
  return fs.promises.rm;
}
