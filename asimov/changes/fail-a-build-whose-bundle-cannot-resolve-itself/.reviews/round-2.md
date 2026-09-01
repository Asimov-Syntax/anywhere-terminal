# Review round 2 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 1
- Mode: verification
- Operating mode: fastlane
- Head reviewed: `02c5af09c7c0cd4c09d02ce92509e90e820192e1` (explicit commit; target files match the commit)
- Prior round Head: `4e81e3a4383a2330e12ea7e30f34adc1e155fa3b`
- Diff scope: `git show --format= --find-renames 02c5af09`
- Scope lock: clear for the explicit commit; its product changes are remediation for F001–F003. The unrelated interposed commit `e18c774e` and unrelated dirty-tree paths are outside the requested commit scope.
- Reviewable lines: 179 additions and 36 deletions across 3 code files plus one declaration file; 140 generated analytics-metadata additions inspected; 122 additions and 29 deletions in the test file reviewed inline.
- Intent context: Gate 2 approved; `design.md` D2/D3 and task 2_1 Acceptance/Plan applied. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports tasks 1_1, 1_2, and 2_1 exit 0 and records the 10-to-23 assertion rewrite. The author also recorded clean type-check, the Biome baseline, 6735 unit tests across 281 files, and a zero exit from `node scripts/check-bundle-requires.mjs`; the chair ran no project verify command.
- Verdict: **REJECT**
- Counts: 3 BLOCK · 0 WARN · 0 SUGGEST

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | AST require extraction | production esbuild spellings and alias reachability | `opus[1M]` |
| asm-review-logic | relative path resolution | Node/VSIX file, package-main, symlink, and containment semantics | `gpt-5.6-terra[1M]` |
| asm-review-contracts | esbuild external extraction | current config identity and future composition drift | `sonnet[1M]` |
| chair | full remediation commit | all applicable lenses and package-gate flow | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security`, `asm-review-frontend`, `asm-review-performance`, and `asm-review-reuse` — the remediation cone adds no data/auth, UI, persistence/growth, hot-path, or reuse surface.

---

## Findings

### [F001] Package-manifest existence is still not runtime resolution to a shipped file

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:141`
- Status: accepted — persists from round 1
- Triage: The F001 remediation is incomplete at the package-directory-main boundary.

**Evidence.** `resolveShipped()` returns success as soon as `target/package.json` is a file; it never parses the manifest or resolves its `main`. A focused scratch probe created a directory whose manifest named a missing `./missing.js`: `classify("./pkg")` returned `ok: true`, while `createRequire(...).resolve("./pkg")` threw `MODULE_NOT_FOUND`. The same unconditional pass accepts malformed manifests and a `main` that resolves to an excluded checkout file outside `dist/`.

**Impact.** A bundle can pass the package gate while its directory require still fails in the extension host, preserving the dangerous direction of F001 and violating task 2_1's outcome that only what the packaged extension could load counts as resolved.

**Suggested fix.** Resolve the manifest's effective `main` with Node-compatible file/directory fallback, then require the final resolved file to be in the allowed shipped root. Reject malformed, missing, unresolvable, or escaping mains. Add witnesses for each, plus one valid in-`dist` main.

**Invariant inventory.** Required invariant: a relative request passes only when Node resolves a file carried by the VSIX. Verified safe: exact files, `.js`/`.json`/`.node`, `index.*`, absolute rejection, lexical traversal rejection, and a spelling such as `../dist/x` that normalizes back inside `dist/`. VSCE dereferences an in-`dist` file symlink into bytes at that archive path, so lexical containment is correct for that case; default packaging does not turn a symlinked directory into a silently broken installed module. Affected: missing, malformed, and escaping package-directory mains.


**Author triage (round 2)** — accepted. `resolveShipped` treats the existence of `target/package.json` as resolution; it is not, since the manifest's `main` may name a file the VSIX does not carry. This sits inside D2's existing "resolves to a shipped file" contract, so on its own it would be ordinary remediation. Carried into the F002 handback because it lives in the module F002 reopens.

### [F002] The production bundle renames the UMD require parameter, so the historical defect is still invisible

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:43`
- Status: accepted — persists from round 1
- Triage: The AST rewrite closes comments/strings/member-call false positives but does not close the executable-call false-negative on the actual production artifact shape.

**Evidence.** `requireLiteral()` accepts only a callee Identifier whose text is exactly `require`. With this repository's production CJS/minified esbuild settings, bundling the historical `jsonc-parser` UMD entry leaves the failing calls as renamed factory-parameter calls such as `n("./impl/format")`, `n("./impl/edit")`, and `n("./impl/scanner")`. A focused probe passed that emitted bundle to `requiredSpecifiers()` and received `[]`. The new test at `src/test/invariants/bundleRequires.test.ts:84` exercises pre-transform fixture text whose parameter is still literally named `require`; the recorded arm check similarly appends a literal `require(...)` and therefore does not witness the production form.

Parenthesized and sequence callees are missed in raw source, but production minification normalizes those direct ambient-require spellings; optional `require?.(...)` is already caught. The load-bearing miss is the renamed UMD factory parameter, which is exactly how the defect reaches the artifact.

**Impact.** Removing the current alias can reproduce the original activation failure while this gate reports no bad specifier. The change therefore remains unarmed against WT-011.12's own defect class despite a green real-artifact append test.

**Suggested fix.** Track bindings that receive ambient `require` through the emitted wrapper/factory call flow, or use another detector that recognizes the same alias relationship without treating arbitrary one-argument calls as module loads. Arm the invariant with the actual production-minified UMD output (or a faithful full wrapper fixture), not a hand-appended direct `require` spelling.

**Invariant inventory.** Required invariant: executable literal module loads reachable through CommonJS `require`, including aliases created by the emitted UMD wrapper, enter classification; inert text and unrelated methods do not. Verified safe: direct ambient `require`, comments, strings, member methods, inter-token whitespace/comments, optional direct calls, and computed-argument exclusion. Affected: factory parameters renamed by esbuild from the ambient `require` passed into them.


**Author triage (round 2)** — accepted, and independently reproduced rather than taken on the report's word. `pnpm exec esbuild --bundle --platform=node --minify` over a jsonc-parser-shaped UMD fixture emits `var n=e("./impl/format")`: the factory's `require` parameter is renamed, so no bare `require` identifier survives anywhere in the call. `requiredSpecifiers` returns nothing and the gate passes clean. `pnpm run package` builds `--production`, so the minified artifact is the ONLY one this gate ever inspects.

This refutes design.md D2 ("a bare `require` identifier called with one string-literal argument") and the "Known limit" paragraph's assertion that the shipped defect left a DIRECT literal call. Repairing it changes D2's detection mechanism, which is a changed `D#` — an artifact handback under the remediation boundary, not a fix inside this cycle.

### [F003] Unsupported object composition can still retain an external that esbuild removed

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair (corroborated by asm-review-contracts after counterexample)
- Class: feature
- File: `scripts/bundleRequires.mjs:77`
- Status: accepted — persists from round 1
- Triage: The exact current config is read correctly, but F003's fail-closed drift invariant remains open for ordinary object-literal composition.

**Evidence.** `declaredExternals()` records only plain identifier/string-named `PropertyAssignment`s and silently ignores spreads, computed names, and accessors. JavaScript applies object properties left-to-right, but the gate does not. For:

```js
const shared = { external: ["actual"] };
const config = { outfile: "./dist/extension.js", external: ["stale"], ...shared };
```

esbuild consumes `actual`, while `declaredExternals()` returns `stale`. Focused probes confirmed the same stale result for a later computed `external` property and a later getter. A request for `stale` is therefore allowlisted even though the runtime config no longer declares it external — the exact silent-dangerous drift F003 names.

The current `esbuild.js` has one plain literal matching config and is read correctly. Variable `outfile`, `outdir`, and zero/multiple literal matches fail loud; the fragility is specifically an unsupported override coexisting with an earlier readable property.

**Impact.** A legitimate future shared-config refactor can make the gate pass a bare dependency that esbuild stopped externalizing and the VSIX does not carry.

**Suggested fix.** Reject any candidate config object containing a spread, computed property name, accessor, or other unsupported composition before trusting its literal `outfile` or `external`. Add witnesses where a later override replaces both fields and require the extractor to throw.

---


**Author triage (round 2)** — accepted. A spread, computed key, or getter that overrides an earlier literal `external` leaves `declaredExternals` returning the stale value while esbuild uses the overriding one, allowlisting a dependency the VSIX does not carry. The fix is to refuse a config object whose composition the extractor cannot read rather than to trust it — inside the existing contract. Carried into the F002 handback with F001.

## Adjudication notes

- F001, F002, and F003 retain their global IDs and BLOCK severity. Each instantiates the same prior invariant through the same detector/resolver mechanism; the remediation witnesses covered only a subset of the recorded boundary.
- A specialist's speculative parser-diagnostic warning was dropped: the reviewed production bundle is valid syntax for the pinned TypeScript parser and no reachable failing syntax was evidenced.
- The suggestion to treat every shipped VSIX sibling as inside the resolver root was not promoted: task 2_1 deliberately scopes this classifier to the bundle artifact directory. The package-main false pass is independently blocking within that accepted scope.

## Verification trace

`vscode:prepublish` → `pnpm run package` → production esbuild writes/minifies `dist/extension.js` → `build:check-requires` parses the bundle and `esbuild.js` → extracts candidate module loads and externals → resolves relative candidates against the packaged artifact policy → exits nonzero on any rejected verdict. F002 leaves the historical load out before classification; F003 can inject a stale allowlist during config translation; F001 can accept an unresolved directory during final resolution. All three are on the load-bearing path to the gate verdict.
