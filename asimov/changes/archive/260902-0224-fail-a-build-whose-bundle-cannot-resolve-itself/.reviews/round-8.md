# Review round 8 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 7
- Mode: discovery
- Requested mode: fastlane
- Head reviewed: `48f0e270` (explicit range `2457947eec021d677a284a5c75ede455e11960fe..48f0e270`; `scripts/` and `src/test/invariants/` are byte-identical between `48f0e270` and the working-tree HEAD `853829fc`, so the later commits belonging to `award-a-contested-destination-or-refuse-it` do not intersect this review)
- Reviewable lines: 45 additions across 2 reviewable files (`scripts/bundleRequires.mjs`, `scripts/bundleRequires.d.mts`) against 375 deletions; 132 test additions in `src/test/invariants/bundleRequires.test.ts` reviewed inline. `asimov/changes/**` markdown is context or skipped support; the `award-a-contested-destination-or-refuse-it` artifacts inside the range are out of scope by the caller's instruction.
- Intent context: Gate 2 approved. D2 (with its round-7 obligation ledger and § Coverage), D6, D7, D5, PLAN WT-011.12, and tasks 8_1–8_4 apply. No `proposal.md` (light lane).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports exit 0 for every recorded task through 8_4. Task 8_4 declares the suite change: 23 witnesses removed (subject deleted), 4 rewritten, assertions −24, arm-checked by disabling the literal sweep (32 failures including all four). The chair ran no project verify command; only focused one-off probes, created and deleted in the same command.
- Verdict: **WARN**
- Counts: 0 BLOCK · 4 WARN · 1 SUGGEST
- Split over gating blockers: n/a (no gating blockers)

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | the deletion delta | fails-set subsumption, candidate construction, classify routing | `gpt-5.6-sol[1M]` |
| asm-review-logic | `isCallArgument` / `templatesIn` | D7 position rule soundness and completeness | `gpt-5.6-terra[1M]` |
| asm-review-contracts | `machinePathsIn`, exports, CLI | build-root predicate vs the D2 contract | `sonnet[1M]` |
| asm-review-contracts | invariant suite | witness non-vacuity after 23 removals and 4 rewrites | `gpt-5.6-luna[1M]` |
| asm-review-reuse | collectors and predicates | dead weight left by the deletion, duplication | `gpt-5.6-luna[1M]` |
| chair | full explicit range | all applicable lenses, differential old-vs-new trace on the real artifact | `opus[1M]` |

Skipped: `asm-review-data-security` and `asm-review-frontend` — the range touches no data, auth, storage, API, or UI behavior. `asm-review-performance` skipped: the change is a net deletion of the only unbounded pass, and the chair measured the production path directly (335 ms → 127 ms on the real artifact), so there is no growth axis left to route.

## Risk map

1. The SUBSUMPTION obligation in D2's ledger: deleting call analysis must not change any `severity: "fails"` verdict. A silent loss here is exactly the defect WT-011.12 exists to prevent.
2. The new `machinePathsIn` build-root prefix test — whether it can be defeated, and whether it re-introduces the host-dependence D6/F017 outlawed.
3. `isCallArgument`'s parenthesis walk plus the `parent.arguments` membership test — soundness and completeness for D7 after the F019 fix.
4. What the deletion left behind: retained `BUILTINS`/`declaredExternals`/`classify` branches, new exported wrappers, and a CLI whose diagnostics were written for the deleted mechanism.
5. Suite integrity after 23 witness removals and 4 rewrites — whether any surviving witness now passes vacuously.

## Findings

### [F020] `buildMachineLiterals` is exported and declared but has no caller and no witness

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:173-175`, `scripts/bundleRequires.d.mts:38`
- Status: accepted
- Triage: Correct, and the file's own comment makes the claim it falsifies. Fixed by adding a direct witness rather than dropping the wrapper: the wrapper layer's whole purpose is that each collector can be driven alone, and `buildMachineLiterals` is the one collector that needs `resolvesFrom` to mean anything, so a witness on it is worth more than one less export.

**Evidence.** `unresolvableRequires` calls the private `machinePathsIn(root, resolvesFrom)` directly at line 435; the exported wrapper is never reached. A repo-wide grep for `buildMachineLiterals` returns only its own definition and its `.d.mts` declaration. The test file's import list (`bundleRequires.test.ts:9-17`) omits it, unlike `relativeLiterals` and `relativeTemplates`, which the D6/D7 witnesses do drive directly (lines 476, 482, 488, 494, 501, 592-593). Task 8_2's plan step 3 witnesses the absolute warning through `verdicts()`, not through the wrapper.

**Impact.** The file's own justification for keeping thin string-taking wrappers — "so the witnesses can still drive each one alone" (`bundleRequires.mjs:433`) — is false for this one. It is new exported surface with zero direct coverage, added by this range.

**Suggested fix.** Either add a witness that imports and calls `buildMachineLiterals` directly, mirroring the `relativeLiterals`/`relativeTemplates` pattern, or drop the wrapper and its declaration and keep `machinePathsIn` private.

### [F021] The CLI prints build-machine string literals as `require(...)` calls that "may not resolve"

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-contracts (independently found by chair)
- Class: feature
- File: `scripts/check-bundle-requires.mjs:38, 44-49`
- Status: accepted
- Triage: The rendering was true while the absolute class came from require-call ARGUMENTS and this range made it false. A literal that names the build machine is not a require call and must not be printed as one.

**Evidence.** `const line = ({ specifier, why }) => \`  require(${JSON.stringify(specifier)}) — ${why}\`` and `console.warn(\`[bundle-requires] warning: ${warning.length} require(s) that may not resolve:\`)`. After the deletion, the only reachable `warns` class (`bundleRequires.mjs:390-398`) is a build-root absolute string literal collected by a plain AST sweep with no call-argument context whatsoever. Before this range the absolute class came from require-call ARGUMENTS, which is what made the `require(...)` rendering accurate; the mechanism that justified it is gone and the message was not updated.

**Impact.** The gate now tells a developer that a string which may be a copyright header, a source-map path, or a `__dirname`-derived constant is a `require(...)` that "may not resolve", misdirecting debugging toward a call that does not exist. The success line ("every relative require in dist/extension.js resolves") remains accurate, since `fails` is still relative-only.

**Suggested fix.** Make the warning line specifier-neutral — `\`  ${JSON.stringify(specifier)} — ${why}\`` — and change the summary to name what the class actually is, e.g. "N absolute build-machine path(s) baked into the bundle".

### [F022] `resolvesFrom` now denotes two different roots, and the containment test has a third implementation

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-contracts + asm-review-reuse (merged; same lines, same severity)
- Class: feature
- File: `scripts/bundleRequires.mjs:177-178, 185`
- Status: accepted
- Triage: Both facets. `resolvesFrom` denoting the artifact directory in two collectors and its PARENT in a third is a trap the next reader walks into, and the derivation appears in no contract. The third copy of the containment test is settled by one local helper — `src/utils/pathBoundary.ts` is the repository's only definition for `src/`, and this is a plain `.mjs` build script that cannot import from it.

**Evidence.** Two facets of the same lines.

1. `machinePathsIn` takes `path.dirname(path.resolve(resolvesFrom))` as its root — the artifact directory's PARENT — while `resolveShipped` (`:330`) and `classify` use `path.resolve(resolvesFrom)` directly as the root, the artifact directory itself. Same parameter name, same production value (`path.dirname(bundle)`), opposite semantic role. The `dirname` step is named nowhere: not in the `.d.mts` doc (`"Absolute literals that name the build machine, per design.md D2"`), not in D2 (`"the build root derived from resolvesFrom"`), only inferable from a test title, `"reports one the artifact directory's PARENT carries"` (`bundleRequires.test.ts:521`).
2. The diff adds a third copy of the root-containment rule: `text === buildRoot || text.startsWith(buildRoot + path.sep)` at `:185`, alongside `resolveShipped` at `:330` and `resolveManifest` at `:298`. All three are currently equivalent and independently maintained.

Chair probe on the committed code (buildRoot `/repo`): sibling-prefix collision is correctly rejected (`/repository/x.js` → no verdict), so the boundary logic itself is right; a caller passing `resolvesFrom: "/"` collapses `buildRoot` to `/` and degenerates the prefix test to matching only `//`-prefixed strings.

**Impact.** A future caller passing a different `resolvesFrom` gets a defensible-looking but silently different scope with no documented contract to check against, and the collector can drift from the resolvers on what "inside the root" means.

**Suggested fix.** Extract one `isWithinRoot(target, root)` predicate used by `machinePathsIn`, `resolveShipped`, and `resolveManifest`, and either name the `dirname` derivation explicitly in the doc and `.d.mts` or pass the build root as its own parameter rather than re-deriving it by convention from a value whose established meaning in this file is the artifact containment root.

### [F023] D2's externals paragraph claims a declared external can no longer change a verdict; a relative external entry still suppresses a `fails` verdict

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair (corroborated by asm-review-contracts on its question 5)
- Class: feature
- File: `asimov/changes/fail-a-build-whose-bundle-cannot-resolve-itself/design.md` (D2, externals paragraph, added by task 8_4 step 5); mechanism at `scripts/bundleRequires.mjs:377-411`
- Status: accepted
- Triage: The correction I wrote in task 8_4 is wrong and the finding's probe reproduces on the committed module: with `external: ["vscode"]` a relative require FAILS, with `external: ["vscode", "./impl/format"]` it produces no verdict at all. Fixed on BOTH halves. The paragraph is rewritten to what is true. The behaviour is fixed too, because D2's own classification table says the relative class fails unless it resolves to a shipped file and states no exemption — an externalized relative path still has to resolve beside the bundle at runtime, which is exactly the activation failure this gate exists to catch. `esbuild.js` declares no relative external today, so this is latent rather than live.

**Evidence.** The paragraph this range added states: "nothing the sweep now collects — a relative literal, or an absolute one under the build root — can be a builtin or a declared external, so neither set can change a verdict any more." The builtin half is true; the externals half is not. `classify` checks `externals.has(specifier)` BEFORE the relative branch, and esbuild's `external` field legally accepts relative path entries, which are matched exactly. Chair probe against the committed module:

```
require("./impl/format"), external: ["vscode"]                    -> ["fails:./impl/format"]
require("./impl/format"), external: ["vscode", "./impl/format"]   -> []
```

So a declared external does still change a verdict — and specifically it can turn the only build-failing class into silence. The mechanism (`classify`'s branch order) is unchanged by this range; the false claim about it is what the range introduced.

**Impact.** D2 is accepted contract. A future change reading this paragraph could delete `declaredExternals` and the externals branch on the stated grounds that they cannot affect a verdict, or could fail to notice that a relative entry in `esbuild.js` silently disarms the gate for that specifier. Separately, the paragraph's justification for RETAINING the machinery is weaker than the real one: retention is right, but because `declaredExternals` still carries D5's fail-closed refusal and because the externals branch is genuinely reachable — not merely because `classify` is exported.

**Suggested fix.** Correct the paragraph to say the builtin set can no longer change a verdict while a declared external still can, whenever the config declares a relative entry; and record whether an external relative entry SHOULD suppress the failing class — an externalized relative path still has to resolve beside the bundle at runtime, which is the exact defect this gate exists to catch.

### [F024] The build-root test is lexical, so `..` segments, case, and cross-flavour spellings give false negatives

- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: asm-review-contracts (extended by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:185`
- Status: accepted
- Triage: Resolving the literal before the prefix test is one line and closes the `..` half outright. Case and cross-flavour spellings stay open and are recorded as a stated limit, not fixed: deciding them needs the build host's own folding rules, which the gate does not have.

**Evidence.** `text === buildRoot || text.startsWith(buildRoot + path.sep)` compares the raw literal, never `path.resolve(text)`. Chair probe with buildRoot `/repo`:

```
"/elsewhere/../repo/dist/x.js"  -> not reported   (resolves inside, missed)
"/repo/../elsewhere/secret.js"  -> warns          (resolves outside, over-reported)
"/Repo/dist/x.js"               -> not reported   (case-insensitive fs)
"C:\\repo\\dist\\x.js"          -> not reported   (win32 spelling on a POSIX host)
```

The converse of the F017 concern also holds on a Windows builder: `path.sep` is `\`, so a forward-slash literal `C:/repo/dist/x` fails the prefix test. The contracts specialist's refutation of the general host-dependence charge is accepted — unlike a relative specifier, which may have been produced on another machine, a build-machine path is by construction produced by the same build on the same host — so this is a residual spelling gap, not a re-introduction of F017.

**Impact.** Low and bounded: the class only warns, never gates, and the design already records "the gate can only attribute paths it can locate" as a stated limit. Worth noting only because that limit is currently written as being about paths from ELSEWHERE on the builder, not about spellings of paths that are under the build root.

**Suggested fix.** None required at warning severity. If this predicate is ever asked to fail a build, resolve the literal before comparing and widen the stated limit to name the spelling cases.

## Prior finding dispositions

| Finding | Round-8 disposition |
|---|---|
| F001–F005, F007–F018 | Remain fixed/closed; no changed mechanism re-opened them. |
| F006 | **Fixed by deletion.** Its subject — the propagation worklist, `propagationStats`, and the edge-once cost invariant — no longer exists. The user's handback decision replaced the obligation rather than discharging it; the chair confirms no production path builds a `ts.Program` or a type checker. |
| F019 | **Fixed.** Chair probe on the committed code: `relativeTemplates("r((((\`./${n}\`))))")` returns `["./"]`, and the UMD-factory parenthesized shape reports through `unresolvableRequires`. The negatives hold — a template in CALLEE position, a tagged template, and parenthesized path data all produce no verdict. |

## Full-flow trace

`vscode:prepublish` → `pnpm run package` → checks/vendor gate → production esbuild emits `dist/extension.js` → `build:check-requires` verifies both inputs exist and reads them → `declaredExternals()` parses `esbuild.js` fail-closed (D5 unchanged) → ONE `ts.createSourceFile` of the bundle feeds `literalsIn`, `machinePathsIn`, and `templatesIn` → `classify()` routes builtin, external, absolute-warns, relative-fails, bare-warns in that order → `resolveShipped()` normalizes Win32 spellings, enforces artifact containment, applies the file/directory/manifest rule → CLI groups warning and failing verdicts → `exitCodeFor()` returns 1 exactly when a failing verdict exists.

**Differential trace on the real artifact** (`dist/extension.js`, 1,908,980 bytes), running the pre-range module and the committed module in one process over the same inputs:

| | old (`2457947e`) | new (`48f0e270`) |
|---|---|---|
| `fails` verdicts | `[]` | `[]` |
| `warns` verdicts | `[]` | `[]` |
| with `require("./impl/format")` appended | `["fails:./impl/format"]` | `["fails:./impl/format"]` |
| wall clock | 335 ms | 127 ms |

**The SUBSUMPTION claim is confirmed, structurally and empirically.** Structurally: a candidate reaches `classify`'s failing branch only if `isRelativeRequest(specifier)`; the deleted `requireLiteral` produced a specifier only from a node satisfying `ts.isStringLiteralLike(unwrap(arg))`; `literalsIn` visits every `ts.isStringLiteralLike` node of the same root under the same `isRelativeRequest`. Therefore old-fails ⊆ new-fails. In the other direction, `machinePathsIn` admits only `path.isAbsolute` strings and `classify`'s absolute branch precedes the relative branch and returns `warns` without entering `resolveShipped`, so no new `fails` verdict can appear. The two sets are identical, not merely ordered. Both roots also come from the same `parse()` configuration — `createProgram` reused the already-created source file through its host rather than reparsing — so parse-option, ScriptKind, and `node.text` decoding differences are ruled out.

The findings above all sit downstream of the failing class: F020 and F022 are surface and contract, F021 and F023 are diagnostic and design accuracy, F024 is a warning-class spelling gap. None can falsify a `fails` verdict.

## Suite integrity

The 26 removed `it(...)` cases all had the deleted call-analysis or propagation implementation as their subject; no removal orphaned a behavior that survives. The four bare-specifier rewrites are individually negative (`toEqual([])`) but suite-level non-vacuity holds: the `[round-1 F003]` rewrite still discriminates the correct external set from the webview set through `classify`, and positive witnesses exist for each surviving collector — changing `templatesIn` or `machinePathsIn` to return `[]` unconditionally fails existing tests. All five `[round-7 D2]` subsumption witnesses fail if relative-literal collection is removed, matching the author's declared arm-check. First-verdict (`verdicts(...)[0]`) assertions all use single-candidate fixtures, so the changed `Set` construction order creates no fragile witness. No `.only`, `.skip`, or missing `await`.
