# Tasks: fail-a-build-whose-bundle-cannot-resolve-itself

A dependency left a relative `require` in the bundle that resolved against `dist/` at runtime, and
the extension failed to activate. No suite could catch it, because every suite imports sources.

- [x] 1_1 Classify every require the bundle still carries — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: design.md#d2--what-counts-as-a-require-the-runtime-cannot-satisfy, design.md#d3--detection-is-a-function-so-the-gate-can-be-proven-non-vacuous
  - **Acceptance**:
    - Outcome: The defect's own signature is classified unresolvable and each allowed form is not
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. `scripts/bundleRequires.mjs` exports the classifier over bundle text, reading the externals from `esbuild.js` and the builtins from `node:module`.
    2. `src/test/invariants/bundleRequires.test.ts` drives it over the UMD factory relative-require signature the defect had, a builtin, a declared external, and an unbundled bare specifier.

- [x] 1_2 Fail the package build on a bundle that cannot resolve itself — verified: node scripts/check-bundle-requires.mjs && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 2_1 Identify requires syntactically, and resolve them the way the VSIX would — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Refs**: .reviews/round-1.md#f001, .reviews/round-1.md#f002, .reviews/round-1.md#f003
  - **Acceptance**:
    - Outcome: Only real `require` calls are reported, and only what the packaged extension could load counts as resolved
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. `scripts/bundleRequires.mjs` finds requires by walking a TypeScript AST — a bare `require` identifier called with one string literal — rather than by matching text, so comments, string contents and `x.require(...)` are not requires (F002).
    2. The same walk reads the externals off the build config object whose `outfile` is the extension bundle, and refuses ambiguity rather than taking the first array it sees (F003).
    3. Resolution accepts only a real FILE inside the shipped artifact directory — `.js`/`.json`/`.node`, an `index.*` under a directory, or a directory's `package.json` main — and refuses absolute specifiers and anything resolving outside it (F001).
    4. `src/test/invariants/bundleRequires.test.ts` witnesses each false pass and false failure the round named.
    5. `scripts/bundleRequires.d.mts` types the classifier, so the suite has real types instead of a suppression.
    6. `scripts/check-bundle-requires.mjs` passes the bundle's own `outfile` so the externals come from the right build config.
    7. `asimov/changes/fail-a-build-whose-bundle-cannot-resolve-itself/design.md` corrects the known-limit paragraph, which claimed more for a text scan than a text scan can do.
