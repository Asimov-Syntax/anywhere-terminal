# Tasks: fail-a-build-whose-bundle-cannot-resolve-itself

A dependency left a relative `require` in the bundle that resolved against `dist/` at runtime, and
the extension failed to activate. No suite could catch it, because every suite imports sources.

- [ ] 1_1 Classify every require the bundle still carries
  - **Refs**: design.md#d2--what-counts-as-a-require-the-runtime-cannot-satisfy, design.md#d3--detection-is-a-function-so-the-gate-can-be-proven-non-vacuous
  - **Acceptance**:
    - Outcome: The defect's own signature is classified unresolvable and each allowed form is not
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. `scripts/bundleRequires.mjs` exports the classifier over bundle text, reading the externals from `esbuild.js` and the builtins from `node:module`.
    2. `src/test/invariants/bundleRequires.test.ts` drives it over the UMD factory relative-require signature the defect had, a builtin, a declared external, and an unbundled bare specifier.

- [ ] 1_2 Fail the package build on a bundle that cannot resolve itself
  - **Deps**: 1_1
  - **Refs**: design.md#d1--the-gate-reads-distextensionjs-and-nothing-else, design.md#adoption
  - **Acceptance**:
    - Outcome: `pnpm run build:check-requires` exits non-zero on an unresolvable bundle and zero on the shipped one
    - Verify: command node scripts/check-bundle-requires.mjs
  - **Plan**:
    1. `scripts/check-bundle-requires.mjs` reads `dist/extension.js`, reports every unresolvable require with its specifier, and exits non-zero.
    2. `package.json` adds `build:check-requires` and runs it in `package` after `esbuild.js --production`, beside the existing checks.
    3. `asimov/project.md` records the new gate command.
  - **Boundary**: `esbuild.js` is not edited — the externals are read from it, and a gate that rewrites the build it audits proves nothing.
