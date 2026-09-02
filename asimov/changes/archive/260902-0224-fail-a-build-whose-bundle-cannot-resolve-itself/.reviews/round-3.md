# Review round 3 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 2
- Mode: discovery
- Operating mode: fastlane
- Arbiter: yes
- Head reviewed: `14999eb9aa37c16b3c9e8968a41a9707ad320c15` (explicit range Head; target files match the commit)
- Diff scope: `git diff 6616ccf28bfbc7166b93cf8f6b0d813c6e2b7f97..14999eb9aa37c16b3c9e8968a41a9707ad320c15`
- Working tree: protocol-generated `analytics.json` modification and unrelated untracked change directories were outside the explicit range.
- Reviewable lines: 269 additions and 15 deletions across the implementation and declaration files; 117 additions and 5 deletions in the test file reviewed inline. Revised design/task/workflow context: 124 additions and 19 deletions.
- Intent context: Gate 2 approved after the round-2 F002 handback; revised D2–D5 and tasks 3_1–3_3 applied. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports tasks 1_1 through 3_3 exit 0 and records the assertion growth through 36. The author recorded a clean type-check, 6748 passing unit tests, the Biome 3/14/1 baseline, and artifact-level gate probes. The chair ran no project verify command.
- Verdict: **REJECT**
- Status: **BLOCKED**
- Counts: 4 BLOCK · 2 WARN · 0 SUGGEST
- Split over gating blockers: 4 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | require-binding fixed point | binding coverage, emitted esbuild shapes, and termination | `opus[1M]` |
| asm-review-performance | require-binding fixed point | growth axes and package-time cost | `gpt-5.6-terra[1M]` |
| asm-review-contracts | manifest and config extraction | Node resolution and fail-closed config authority | `sonnet[1M]` |
| asm-review-reuse | AST binding machinery | TypeScript/repository capability reuse | `gpt-5.6-luna[1M]` |
| chair | full range | all applicable lenses and package full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security` and `asm-review-frontend` — the range adds no data/auth or UI surface.

---

## Findings

### [F001] A malformed package manifest is bypassed when the directory also has an index

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair (corroborated by asm-review-contracts after the exact boundary was supplied)
- Class: feature
- File: `scripts/bundleRequires.mjs:378`
- Status: accepted — persists from round 2
- Triage: Arbiter sustains F001; the manifest-precedence witness remains open.

**Evidence.** `resolveShipped()` returns success for `target/index.*` before checking whether `target/package.json` exists or parses. A focused scratch directory containing both `index.js` and malformed `package.json` made `classify("./pkg")` return `ok: true`. Node 18.20.8 and Node 24 both throw while resolving the same directory because a malformed package config is a hard error; the index fallback does not bypass it. `resolveManifest()` has the correct parse-failure branch, but this ordering makes it unreachable whenever an index is present.

**Impact.** The gate can approve a directory require that the extension host rejects, violating D4 and preserving F001's dangerous false-pass direction.

**Suggested fix.** When a directory carries `package.json`, parse it before treating a sibling index as dispositive. Preserve Node's soft index fallback for a valid manifest with absent or unresolved `main`, but make parse failure fail regardless of an index. Add the combined malformed-manifest-plus-index witness.

**Invariant inventory.** Required invariant: pass exactly when Node resolves a shipped file. Verified safe: no manifest plus index, valid manifest with missing/invalid main plus root index fallback, valid main extension/index fallback, containment, and missing target. Affected: malformed manifest coexisting with an index.

### [F003] A shorthand property can still override the external allowlist without being refused

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-contracts (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:267`
- Status: accepted — persists from round 2
- Triage: Arbiter sustains F003; D5 enumerated several unreadable forms but omitted another valid overriding form.

**Evidence.** The property reader accepts only `PropertyAssignment`, while the refusal guard covers spread, computed keys, and accessors but not `ShorthandPropertyAssignment`. In valid JavaScript:

```js
const external = ["actual"];
const config = { outfile: "./dist/extension.js", external: ["stale"], external };
```

JavaScript and esbuild consume `actual`, while the current `declaredExternals()` returns `stale` without throwing. This is a normal shared-config refactor and the actual shorthand value is a valid esbuild external array.

**Impact.** A dependency removed from the build's externals can remain in the gate's allowlist, reproducing the exact silent fail-open drift F003 names.

**Suggested fix.** Refuse every matching-object element form the extractor does not interpret, including shorthand properties; equivalently, allow only the plain property assignments the reader consumes. Add a trailing shorthand override witness. Method-shaped overrides may also be rejected for completeness, although esbuild itself rejects a function-valued `external` before this gate runs.

### [F004] Function-declaration factories are absent from the binding graph

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair and asm-review-reuse)
- Class: feature
- File: `scripts/bundleRequires.mjs:70`
- Status: accepted — new in round 3
- Triage: Arbiter sustains F004 as a new binder-form mechanism; round-2 F002's exact function-expression witness is fixed.

**Evidence.** `scopeNames()` records parameters and direct variable statements only, and the initial `holds` walk records only variable declarations initialized with function expressions/arrows. It records neither a `FunctionDeclaration` binding nor the declaration as a callable target. A plain UMD factory declared with `function factory(req) { req("./impl/format") }` and invoked with ambient `require`, built using this repository's exact `--bundle --platform=node --minify --format=cjs` settings, remains a function declaration with renamed parameters; `requiredSpecifiers()` returns `[]`. The current artifact contains many emitted function declarations, so the binder form is ordinary even though no current declaration receives `require`.

**Impact.** A realistic UMD dependency can reproduce the original unresolved relative load while the gate reports clean, outside the two limits D2 declares.

**Suggested fix.** Resolve binding identity with TypeScript's binder/checker rather than the hand-built parameter/direct-variable scope map, or at minimum register function declarations in both the scope map and `holds`. Add the actual emitted declaration-form UMD artifact as a witness.

**Invariant inventory.** Required invariant: taint reaches factory parameters independent of the syntax used to bind the factory. Verified safe: direct/IIFE function expressions, arrow initializers, function-valued positional arguments, parentheses, and the historical minified function-expression UMD witness. Affected: function declarations and hoisted `var` declarations nested in statement blocks.

### [F005] A scalar alias initialized from `require` never becomes tainted

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:187`
- Status: accepted — new in round 3
- Triage: Arbiter sustains F005 as an independent missing transfer rule.

**Evidence.** The fixed point transfers taint only from call arguments to parameters. `holds` records only function-valued initializers, so an identifier initializer is ignored. With the repository's exact production esbuild flags, `var r = require; r("./impl/format")` remains an aliased identifier call in the emitted bundle and `requiredSpecifiers()` returns `[]`. The same miss occurs inside an already-tainted factory after `var r = req`, and assignment aliases are also untracked. These are scalar binding flows, not the accepted data-structure or computed-specifier limits.

**Impact.** A CJS dependency using the ordinary indirect-require idiom can leave an unresolved literal request in the artifact while the gate exits successfully.

**Suggested fix.** Add monotone taint/holds propagation for identifier variable initializers and assignments, preferably through a worklist. Witness both the emitted top-level alias and a one-hop alias inside the historical factory flow.

**Invariant inventory.** Required invariant: once a binding holds ambient `require`, direct scalar rebinding preserves taint until the literal call. Verified safe: positional argument-to-parameter propagation. Affected: declaration initializers, later assignments, default initializers, and return-value aliases; data-structure flow remains the explicitly accepted limit.

### [F006] The terminating fixed point still rescans the whole call graph per new fact

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-performance (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:187`
- Status: open
- Triage: Non-gating performance warning.

**Evidence.** Termination is now sound: `tainted` has a finite binding domain and `holds` a finite binding×function domain; every `growing` pass adds at least one new fact, and no fact is removed. However every added fact can trigger another full scan of all calls, targets, and parameters. A reverse-ordered synthetic propagation chain measured approximately 0.2 seconds at 1,000 links and 3.25 seconds at 4,000 links despite being only about 130 KB, while the current 1,004,133-byte artifact completes in approximately 0.16 seconds because its propagation depth is shallow. The size gate runs after this gate, so it is not a pre-bound.

**Impact.** A dependency with a deep forwarding topology can make packaging impractically slow despite formal termination; bundle byte size alone does not predict the work.

**Suggested fix.** Replace whole-graph passes with a worklist and reverse indexes from newly added taint/holding facts to affected call sites, processing each propagation edge once.

### [F007] The spelling seed can classify a declared local callback as ambient require

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair (related concern noted by asm-review-logic)
- Class: feature
- File: `scripts/bundleRequires.mjs:153`
- Status: open
- Triage: Non-gating false-positive warning.

**Evidence.** `isTainted()` returns true for every identifier textually named `require` before asking the resolver whether it is a declared local binding. Production minification normally renames such parameters, but direct `eval` forces esbuild to preserve names. A focused production build emitted `exports.f=function(require){return eval(""),require("./not-a-module")};`; the detector reported `./not-a-module` even though the parameter is a local callback and no ambient-require flow is established.

**Impact.** A dependency using direct eval can make the package gate reject a legitimate local callback call. Keeping the seed preserves the old uninvoked source fixture, but that fixture is not evidence that the artifact binding holds ambient `require`.

**Suggested fix.** Treat textual `require` as ambient only when resolver lookup is undefined; declared bindings should need taint evidence. Replace the disconnected round-1 source fixture with an invoked artifact-level witness, or explicitly document and accept this conservative false-positive boundary.

---

## Prior finding disposition

### [F002] The production-minified UMD callee rename

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (verified by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:122`
- Status: fixed
- Triage: Arbiter closes the exact round-2 witness.

The current fixed point detects all four `./impl/*` requests in a fresh production-minified bundle of the historical `jsonc-parser` UMD entry, and the committed artifact-level function-expression witness closes. F004 and F005 are new binder/transfer mechanisms, not a reopening of the callee-spelling defect.

## Full-flow trace

`vscode:prepublish` → `pnpm run package` → type/lint/vendor gates → production esbuild writes `dist/extension.js` → `build:check-requires` reads that artifact and `esbuild.js` → parses AST → computes function holdings and require taint → extracts the matching build's externals → classifies builtins, externals, bare requests, and relative requests → parses any directory manifest and checks shipped-file containment → uncaught extractor/read errors or bad verdicts exit nonzero → size and VSIX checks run afterward. There is one production mode and one consumer; no auth, persistence, cache, or alternate entry path is involved. F004/F005 omit loads before classification, F003 can corrupt the external authority, and F001 can return a false resolution at the final filesystem boundary.

## Arbiter dispositions

- **F001 — accepted.** Malformed `package.json` plus `index.js` passes the gate and throws in Node 18/24. Load-bearing D4 boundary remains open.
- **F002 — fixed.** The exact production-minified function-expression UMD witness and historical package output are detected.
- **F003 — accepted.** A valid shorthand override retains a stale external without refusal. Load-bearing D5 authority remains open.
- **F004 — accepted.** Production esbuild preserves function-declaration factories, which the graph cannot resolve. Load-bearing D2 path remains open.
- **F005 — accepted.** Production esbuild preserves scalar `require` aliases, for which the graph has no taint rule. Load-bearing D2 path remains open.

No blocker is external, rebutted, or eligible for audit backlog: each falsifies an approved obligation on the package gate's only execution path and is repo-fixable. The change remains parked with status blocked.

---

## Author triage — round 3

All four blockers **accepted**, each reproduced directly against the built detector rather than
accepted on the report's word:

| Finding | Probe | Result |
|---|---|---|
| F005 | `var r = require; r("./impl/format");` | `[]` — missed |
| F004 | `function factory(req){var x=req("./impl/format")} factory(require);` | `[]` — missed |
| F007 | `function outer(require){return require("./local-cb")} outer(cb);` | `["./local-cb"]` — false positive |
| F001 | manifest parse ordering | index is tested before the manifest is read, so a malformed manifest beside an index passes |
| F003 | shorthand `{ external }` | `ShorthandPropertyAssignment` is absent from the refusal guard |

F007 is accepted **against my own recorded decision**. D2 keeps a spelling seed so that a binding
still named `require` is tainted without evidence; I added it to preserve a round-1 fixture whose
factory is never invoked. That fixture is source-only and never reaches a bundle, and the seed buys
its coverage at the price of rejecting a legitimate build. The witness is what should change.

**These are not five independent defects.** F004, F005 and F007 are one defect: `scopeNames` and
`makeResolver` are a hand-rolled lexical scope resolver, and it is wrong about function declarations,
about assignment flow, and about whether a name is ambient. That is the third consecutive round in
which hand-rolled detection missed a spelling that ships — round 1 a text scan, round 2 an identifier
match, round 3 a scope resolver. The mechanism is the problem, not the coverage.

`asm-review-reuse` was spawned on exactly this and F004's fix names it: TypeScript's own binder
already resolves lexical identity correctly, and it is already a direct devDependency of this repo.

**Disposition: thrash stop.** Round 2 carried 3 blockers and round 3 carries 4, so two consecutive
global rounds show no net blocker reduction, and round 3 was the final automatic review. Not
triaged into a fix loop — presented to the user with the three options.
