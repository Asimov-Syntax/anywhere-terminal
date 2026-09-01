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

## 3. Round-2 handback — the gate was blind to the shipped artifact

- [x] 3_1 Find a require call whose callee minification renamed — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D2, D3
  - **Acceptance**:
    - Outcome: The gate reports the relative specifier in production-minified UMD output
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, replace the `expression.text === "require"` callee test in `requireLiteral` with a lookup against a tainted-name set.
    2. Add the D2 fixed point to `scripts/bundleRequires.mjs`: seed `{require}`, resolve callee identifiers to function expressions bound by declaration initializer or call-site parameter, bind parameters positionally to arguments, and iterate until the set stops growing.
    3. Update `scripts/bundleRequires.d.mts` for any changed export signature.
    4. Arm the witness in `src/test/invariants/bundleRequires.test.ts` with production-minified UMD output — the shape where the factory parameter is renamed and called with a single relative string literal — and assert the specifier is reported.

- [x] 3_2 Resolve a directory through its manifest's main — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_1
  - **Refs**: design.md D4
  - **Acceptance**:
    - Outcome: A manifest whose `main` names no shipped file is reported unresolvable
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, extend `resolveShipped` so a directory resolves only by parsing its `package.json`, resolving the effective `main` (absent ⇒ `index.*`) through the existing shipped-file rule with extension fallback, and confirming the result is inside the artifact directory.
    2. Report an unparseable manifest, a missing `main` target, and a `main` escaping the artifact directory as distinct named failures.
    3. Witness each of those three plus the resolving case in `src/test/invariants/bundleRequires.test.ts`.

- [x] 3_3 Refuse a build config whose composition the extractor cannot read — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: A config object the extractor cannot read is refused rather than read
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, make `declaredExternals` throw a named refusal when a candidate config object literal carries a spread assignment, a computed property name, or an accessor.
    2. Witness the spread, computed-key, and accessor refusals, and that the current plain-literal `esbuild.js` shape still reads, in `src/test/invariants/bundleRequires.test.ts`.

## 4. Round-3 handback — delegate lexical identity to the binder

- [x] 4_1 Resolve callees through TypeScript's binder instead of a hand-rolled scope walk — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D2, D3
  - **Acceptance**:
    - Outcome: The gate reports an aliased and a function-declaration require, and stops rejecting a declared local
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, replace `scopeNames` and `makeResolver` with a `ts.createProgram` over the bundle and `checker.getSymbolAtLocation`, keying the fixed point on symbols.
    2. Seed taint only where the resolved symbol has no declarations and the identifier is spelled `require`, and delete the spelling-only seed.
    3. Register function declarations and variable initializers as callable targets, and propagate taint through identifier initializers and assignments.
    4. Drive propagation from a worklist with reverse indexes so each edge is processed once.
    5. Change the source-only uninvoked-factory witness in `src/test/invariants/bundleRequires.test.ts` to an invoked one, and add witnesses for the alias, function-declaration, and declared-local-named-require cases.
    6. Record the gate's wall-clock cost on the real `dist/extension.js` in the change's workflow.md Notes.

- [x] 4_2 Read a directory manifest before accepting its sibling index — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_1
  - **Refs**: design.md D4
  - **Acceptance**:
    - Outcome: A directory with an index and a malformed manifest is reported unresolvable
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, move the `package.json` read in `resolveShipped` ahead of the `index.*` candidates, making a parse failure fatal for the directory.
    2. Keep Node's index fallback for a valid manifest whose `main` is absent or does not resolve.
    3. Witness both orderings in `src/test/invariants/bundleRequires.test.ts`.

- [x] 4_3 Refuse a shorthand property in the build config — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 4_2
  - **Refs**: design.md D5
  - **Acceptance**:
    - Outcome: A config carrying a shorthand property is refused rather than read
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, add `ts.isShorthandPropertyAssignment` to the refusal guard in `declaredExternals`.
    2. Witness the shorthand refusal, and that the repo's own config still reads, in `src/test/invariants/bundleRequires.test.ts`.

## 5. Round-4 handback — sweep the class instead of the spelling

- [ ] 5_1 Resolve every relative string literal in the artifact
  - **Deps**: none
  - **Refs**: design.md D6, D3
  - **Acceptance**:
    - Outcome: An unresolvable relative specifier is reported however it is called
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, export a function collecting every distinct relative string literal in the bundle, in first-seen order, independent of call detection.
    2. Classify each through the existing `resolveShipped` path so directory, manifest, and containment rules are shared rather than duplicated.
    3. Accept an explicit allowlist of literals known not to be module specifiers, defaulting to the one the current artifact carries, each entry carrying its reason in a comment.
    4. Union the sweep's verdicts with the call-detected ones in `unresolvableRequires`, deduplicating by specifier.
    5. Witness the conditional-alias and `.call` shapes from round 4's F008 and F009, plus a computed-argument and an object-carried loader from its F012, asserting each is reported without any call analysis seeing it.

- [ ] 5_2 Process each propagation edge once
  - **Deps**: 5_1
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: Propagation cost grows with edges rather than with edges times facts
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, replace the rescan loop in `requireBindings` with a worklist seeded from the ambient requires and the known callables.
    2. Build reverse indexes from a symbol to the assignments and to the call edges binding an argument to a parameter that read it, and enqueue only those when a fact is added.
    3. Witness the cost claim with a deep forwarding chain — the topology round 4's F006 measured — asserting it completes well inside the budget a rescan loop would blow.
