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

- [x] 5_1 Resolve every relative string literal in the artifact — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
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

- [x] 5_2 Process each propagation edge once — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 5_1
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: Propagation cost grows with edges rather than with edges times facts
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, replace the rescan loop in `requireBindings` with a worklist seeded from the ambient requires and the known callables.
    2. Build reverse indexes from a symbol to the assignments and to the call edges binding an argument to a parameter that read it, and enqueue only those when a fact is added.
    3. Witness the cost claim with a deep forwarding chain — the topology round 4's F006 measured — asserting it completes well inside the budget a rescan loop would blow.

## 6. Round-5 handback — a sound relative predicate, and a warning where no guarantee exists

- [x] 6_1 Recognise every relative spelling Node accepts — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D6, .reviews/round-5.md F014
  - **Acceptance**:
    - Outcome: A relative request spelled with a Win32 separator is reported
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, widen `relativeLiterals`' predicate to the four prefixes `./`, `../`, `.\`, `..\`.
    2. Exclude the six strings that are exactly a relative prefix and nothing more, as design.md D6 fixes them.
    3. Witness each of the four prefixes reported when it does not resolve, and witness that each of the six bare prefixes is not swept, in `src/test/invariants/bundleRequires.test.ts`.

- [x] 6_2 Sweep a prefixed literal wherever it sits — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_1
  - **Refs**: design.md D6, .reviews/round-5.md F013
  - **Acceptance**:
    - Outcome: A prefixed literal is reported from any syntactic position
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, delete the `NOT_SPECIFIERS` export and every value-keyed suppression, adding no exemption in its place.
    2. Witness the F013 shape — an unrelated bare-prefix argument to `.startsWith` sharing a bundle with a genuine unresolvable relative request — asserting the genuine one is still reported.
    3. Witness the oracle's counterexample — a relative literal passed through `String.prototype.concat` into `require` — which a role-based exemption would have hidden, as reported.
    4. Witness that the real `dist/extension.js` sweeps clean with no allowlist and no exemption.

- [x] 6_3 Report bare and absolute findings as warnings that do not fail the build — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_2
  - **Refs**: design.md D2 § Coverage, .reviews/round-5.md F008, F009, F010
  - **Acceptance**:
    - Outcome: The gate exits 0 on an unresolvable bare specifier
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, carry a severity on each verdict, set by specifier class rather than by which mechanism found it.
    2. In `scripts/check-bundle-requires.mjs`, extract the exit decision into an exported function returning the code, so the CLI's own rule is reachable from a test rather than only from `process.exit`; the CLI body calls it and nothing else decides.
    3. Witness that function returning 0 for a bare-only verdict list and nonzero for a relative one — the exit rule itself, not a proxy for it.
    4. Update the two bare-specifier witnesses in `src/test/invariants/bundleRequires.test.ts` to assert warning severity, rather than deleting them.

- [x] 6_4 Bound callable fanout so each propagation edge is processed once — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_3
  - **Refs**: design.md D2, .reviews/round-5.md F006
  - **Acceptance**:
    - Outcome: Each propagation edge is applied exactly once
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, record which call edges a newly discovered callable has already applied, so re-enqueueing it does not reapply them.
    2. Expose a count of edge applications from the propagation, so the invariant is observable rather than inferred.
    3. Witness the count equal to the edge count on the fanout topology round 5's F006 measured. A wall-clock budget is NOT the witness: the existing timing assertion passed while the fanout was still quadratic, so timing cannot tell the two apart.

- [x] 6_5 Report a relative request the gate cannot resolve — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 6_4
  - **Refs**: design.md D7
  - **Acceptance**:
    - Outcome: A template whose head is a relative prefix fails the build
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, report a `TemplateExpression` whose head starts with one of the four relative prefixes as an unverifiable relative request, carrying the head text.
    2. Witness the UMD shape `r(`./${name}`)` reported, and witness that a non-relative-headed template is not.
    3. Witness that the real `dist/extension.js` carries none, so the rule fails no current build.

## 7. Round-6 handback — one class predicate, a spelling-dispatched resolver, and a bounded template rule

- [x] 7_1 Decide the request class once, for detection and severity alike — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D6, D2, .reviews/round-6.md#f016
  - **Acceptance**:
    - Outcome: A dot-prefixed bare specifier warns instead of failing
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, have `classify` decide relative-versus-bare through the same predicate discovery uses, rather than its own `startsWith(".")` test.
    2. Witness a dot-prefixed bare name reported with warning severity and a zero exit, and witness that the four relative spellings still fail.

- [x] 7_2 Resolve a Win32 spelling by its spelling, not by the build host — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_1
  - **Refs**: design.md D6, .reviews/round-6.md#f017
  - **Acceptance**:
    - Outcome: A Win32-spelled relative specifier gets the same verdict on either host
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, normalize a Win32-spelled relative specifier to its POSIX equivalent before resolution, so one resolver answers both and no branch reads `process.platform`.
    2. Witness a Win32-spelled specifier RESOLVING against a file that exists beside the bundle, which the host-native path could not do, and witness one that does not resolve still failing.

- [x] 7_3 Report a template only where a module request can occur — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_2
  - **Refs**: design.md D7, .reviews/round-6.md#f018
  - **Acceptance**:
    - Outcome: A relative-headed template outside a call argument is not reported
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, report a relative-headed template only in a call-argument position, excluding tagged templates.
    2. Witness relative-headed path data and a tagged template both unreported, and witness the UMD call shape still reported.

- [x] 7_4 Bound argument-side fact arrivals too — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_3
  - **Refs**: design.md D2, .reviews/round-6.md#f006
  - **Acceptance**:
    - Outcome: Mixed fanout applies each edge once
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, deduplicate argument-side arrivals by edge and fact identity, the way callee-target arrivals already are, so a generic re-enqueue cannot reapply every target.
    2. Witness the MIXED topology the round-6 probe used — callee targets and argument callables both growing — asserting applications equal distinct pairs. The committed witness varied only callee targets and therefore could not fail on this.

- [x] 7_5 Parse the artifact once — verified: pnpm exec vitest run 'src/test/invariants/bundleRequires.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 7_4
  - **Refs**: design.md D1, .reviews/round-6.md#f015
  - **Acceptance**:
    - Outcome: One parse of the bundle serves every collector
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, build the source file and checker once in `unresolvableRequires` and pass them to the three collectors, keeping the string-taking exports as thin wrappers so the existing witnesses still drive them.
    2. Witness that the collectors agree with their wrapper forms on one bundle, so the shared parse is not a second implementation.
    3. Declare the parse counter in `scripts/bundleRequires.d.mts` so the witness reads it with a real type rather than a suppression.

## 8. Round-7 handback — a cost bound the artifact evidences, and a position test that survives parentheses

- [ ] 8_1 Find a computed request through the parentheses around it
  - **Deps**: none
  - **Refs**: design.md D7 § Through the parentheses, .reviews/round-7.md#f019
  - **Acceptance**:
    - Outcome: A parenthesized relative-headed template in a call argument is reported
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, have the call-argument position test walk out through enclosing parentheses before asking which call the node sits in, the way `unwrap` already does for a callee.
    2. Witness the direct form, the parenthesized form and a parenthesized UMD-factory form all reported, and keep the round-6 negatives green so the narrowing is not undone.

- [ ] 8_2 Count every unit of propagation work, on every path
  - **Deps**: 8_1
  - **Refs**: design.md D2 § Cost, .reviews/round-7.md#f006
  - **Acceptance**:
    - Outcome: The reported work rises when any propagation path does more work
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, count each fact offered to a symbol, each prior fact replayed, and each target scanned for an argument arrival, and report the total alongside the existing pair counts.
    2. Declare the counter in `scripts/bundleRequires.d.mts`.
    3. Arm-check the counter against the path round 6 left invisible: make the argument-delivery path do extra work, observe the total rise, and restore it. A counter that cannot see a path cannot bound it.
    4. Witness the shipped artifact's own work against the ceiling, so the recorded headroom is asserted rather than remembered.

- [ ] 8_3 Abandon the pass above the ceiling, and say so
  - **Deps**: 8_2
  - **Refs**: design.md D2 § Cost, .reviews/round-7.md#f006
  - **Acceptance**:
    - Outcome: A bundle above the ceiling is reported as an abandoned pass rather than analysed
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `scripts/bundleRequires.mjs`, stop propagation once the counted work passes the ceiling and carry that fact out with the verdicts.
    2. In `scripts/check-bundle-requires.mjs`, report an abandoned pass in its own voice rather than folding it into the verdict list.
    3. Witness a fixture above the ceiling abandoning rather than completing, a fixture below it completing, and the abandoned run still exiting 0 when no relative request failed.

- [ ] 8_4 Prove the abandoned pass cannot change a verdict
  - **Deps**: 8_3
  - **Refs**: design.md D2 § Cost, design.md D6
  - **Acceptance**:
    - Outcome: The failing verdicts are the same with the propagation pass run and abandoned
    - Verify: unit src/test/invariants/bundleRequires.test.ts
  - **Plan**:
    1. In `src/test/invariants/bundleRequires.test.ts`, witness that a minified UMD fixture whose relative request arrives only through propagation is also found by the literal sweep, so the sweep is a superset for the failing class.
    2. In the same file, witness that one bundle carrying a failing relative request, a bare specifier and an absolute path yields the same `severity: "fails"` verdicts whether the pass runs or is abandoned, and that only the warnings differ.
