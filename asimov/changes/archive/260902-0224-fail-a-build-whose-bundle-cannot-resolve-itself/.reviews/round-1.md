# Review round 1 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Head reviewed: `4e81e3a4383a2330e12ea7e30f34adc1e155fa3b` (explicit range; working tree has protocol-generated untracked `analytics.json`, outside the review scope)
- Diff scope: `git diff dfa3629481570b452b72433c409f87be73da818f..4e81e3a4383a2330e12ea7e30f34adc1e155fa3b`
- Reviewable lines: 132 additions and 1 deletion across 3 reviewable files; 86 test lines reviewed inline
- Intent context: Gate 2 approved; `design.md`, WT-011.12, and task Acceptance/Boundary applied. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports tasks `1_1` and `1_2` exit 0; the chair ran no project verify command.
- Verdict: **REJECT**
- Counts: 3 BLOCK · 0 WARN · 0 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | bundle/external lexical scanning | executable-call boundaries and fail-closed parsing | `gpt-5.6-sol[1M]` |
| asm-review-logic | relative, absolute, and bare module handling | Node resolution and packaged-artifact semantics | `gpt-5.6-terra[1M]` |
| asm-review-contracts | gate contract, tests, and package wiring | accepted obligations and non-vacuity | `sonnet[1M]` |
| asm-review-reuse | new classifier and CLI | parser/resolver/gate reuse and cohesion | `gpt-5.6-luna[1M]` |
| chair | full range | all applicable lenses and package full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security`, `asm-review-frontend`, and `asm-review-performance` — the range adds no data/auth, UI, persistence, collection-growth, or hot-path surface.

---

## Findings

### [F001] Builder-filesystem existence is not runtime resolution of the packaged artifact

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:57-65`
- Status: open · Triage: pending

**Evidence.** `classify()` resolves a relative or absolute spelling against `resolvesFrom`, then accepts the first existing path among `target`, `target.js`, `target.json`, and `target/index.js`. This is neither Node's resolver nor a package-membership check.

- A targeted probe against this checkout classified both `require("../scripts/check-bundle-size.mjs")` and the absolute path to that script as `ok: true`; `.vscodeignore` excludes build scripts, so neither path exists in the installed extension.
- An empty `dist/empty/` directory makes `require("./empty")` return `ok: true`, while `createRequire(...).resolve("./empty")` throws `MODULE_NOT_FOUND`.
- A shipped `dist/native.node` makes Node resolve `require("./native")`, while this classifier rejects it. The same omission applies to `index.json`, `index.node`, and full directory `package.json` resolution.

**Invariant inventory.** The required invariant is: a detected request passes exactly when the target runtime can resolve a file that the VSIX carries. Affected boundaries are parent traversal, absolute paths, existing directories, native extensions, index variants, and package-directory mains. Verified safe boundaries are exact files, `.js`, `.json`, and `index.js` beside the bundle. Bare specifiers are handled separately and are safe under the current no-`node_modules` package policy.

**Impact.** The dangerous direction is live: a reference satisfied only by the build checkout, or by an existing-but-unloadable directory, passes the gate and can reproduce the activation failure WT-011.12 exists to prevent. The incomplete algorithm can also reject a valid CommonJS sidecar.

**Suggested fix.** Use Node's resolver anchored at `dist/extension.js` for relative/absolute requests, then verify the resolved file belongs to the shipped artifact set (or deliberately enforce a documented dist-only containment rule). Reject machine-specific absolute paths. Add witnesses for traversal into an excluded checkout file, an empty directory, a native addon, an index variant, and a package main.

### [F002] The raw-text scanner cannot distinguish executable `require` calls from inert text or member methods

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:18, 43-49`
- Status: open · Triage: pending

**Evidence.** `REQUIRE_LITERAL` runs over bundle bytes without JavaScript lexical context. Targeted probes show that each of the following is returned as `./missing`: a quoted diagnostic containing `require("./missing")`, a line comment containing it, and `loader.require("./missing")`. None is a direct CommonJS call. Conversely, legal executable spellings with a comment/newline between `require` and `(`, and no-substitution template literals, are outside the expression.

**Invariant inventory.** The required invariant is: only executable direct calls through the `require` identifier enter classification. Affected boundaries are comments, quoted/template text, member access, legal inter-token whitespace/comments, and supported static literal syntaxes. The exact shipped witness `require("./impl/format")` and ordinary same-line single/double-quoted calls are verified safe. Computed specifiers remain the approved, stated limitation and are not the defect here.

**Impact.** Inert text retained by a dependency can fail every package build, while a legal direct literal call outside the regex spelling can pass unseen. The current real-artifact arm test proves one string shape, not the classifier's claimed call boundary.

**Suggested fix.** Replace the raw regex with a JavaScript-aware lexer/AST walk that selects direct `require` call expressions and reads static string values. Add negative witnesses for comments, strings/templates, and member calls, plus positive witnesses for every supported direct-call spelling.

### [F003] The externals regex can silently restore an external that the build removed

- Severity: BLOCK · Confidence: HIGH · Priority: P1
- Agent: asm-review-logic (corroborated by chair; latent ambiguity also noted by asm-review-contracts)
- Class: feature
- File: `scripts/bundleRequires.mjs:30-38`
- Status: open · Triage: pending

**Evidence.** `declaredExternals()` selects the first textual `external: [...]` anywhere in `esbuild.js` and collects every quoted token inside it. A targeted probe with the actual configuration shape plus `// "removed-package"` returned both `vscode` and `removed-package`. A preceding unrelated config or comment/string block can likewise win. The function throws when no matching spelling exists, but these ambiguous inputs parse successfully and therefore never reach the deliberate fail-closed path.

**Impact.** If an external is removed from the extension build but remains quoted in a comment, a surviving bare `require("removed-package")` is allowlisted even though esbuild no longer declares it external and the VSIX carries no `node_modules`. That is the exact silent-dangerous drift D2 says this design must prevent.

**Suggested fix.** Parse `esbuild.js` structurally and read only the literal `extensionConfig.external` definition; reject missing, duplicate, computed, or ambiguous definitions. Pin commented-out strings and an unrelated earlier `external` array as rejection witnesses. Keeping an exception/nonzero exit for an unrecognized configuration shape is the correct failure mode.

---

## Full-flow trace

`vsce package`/publish invokes `vscode:prepublish` → `pnpm run package` → production esbuild writes `dist/extension.js` → `build:check-requires` verifies both inputs exist → reads bundle and build config → extracts externals and candidate calls → classifies builtins, externals, path requests, and bare requests → exits 1 with all rejected specifiers or continues to size/VSIX gates. Missing files and uncaught read/parser errors fail nonzero. The three findings are all inside the load-bearing extraction/resolution segment before the verdict; no auth, state, cache, persistence, or alternate runtime mode is involved.

## Author triage

All three accepted in full, none rebutted, fixed in task 2_1. The chair's decision-checks were right
on every count, including the one that partly defended me: the computed-require limit is real and
acceptable, and it was the raw scanner — not that limit — that was wrong.

- **F001 — accepted, fixed.** The false pass was the serious one: `existsSync` answers about the
  BUILD machine, and `scripts/` and `node_modules/` are not in the VSIX. Resolution now requires a
  real FILE — `.js`/`.json`/`.node`, a directory `index.*`, or a directory carrying its own
  `package.json` — lying INSIDE the artifact directory. A bare existing directory no longer counts
  (Node throws `MODULE_NOT_FOUND` for one), and an absolute specifier is refused outright as naming
  the build machine. Six witnesses; arm-checked by restoring both the bare-existence test and the
  containment check, which fails three of them.
- **F002 — accepted, fixed.** Replaced the regex with a TypeScript AST walk selecting a bare
  `require` IDENTIFIER called with one string literal, so a comment, a quoted diagnostic and
  `loader.require(...)` are all correctly not requires — and a call split across lines, which the
  regex missed, now is one. `typescript` is already a direct devDependency carrying
  `fsDeletionGate.ts`, so no new dependency. Arm-checked by restoring the regex, which fails three.
- **F003 — accepted, fixed.** `declaredExternals` now finds the config object whose `outfile` IS the
  extension bundle and throws unless exactly one exists, rather than taking the first `external:`
  array in a file that configures two builds. A commented-out entry is no longer a member, because a
  comment is not an array element in an AST. Arm-checked.

The `@ts-expect-error` on the test's import is also gone: `scripts/bundleRequires.d.mts` types the
module, so the suite has real types rather than a suppression that had already drifted once when the
import became multi-line.

Non-vacuity re-proven against the REAL artifact after the rewrite: appending `require("./impl/format")`
to `dist/extension.js` exits 1; restoring it exits 0.
