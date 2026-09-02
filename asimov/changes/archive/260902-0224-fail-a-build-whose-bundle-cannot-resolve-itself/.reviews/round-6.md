# Review round 6 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 5
- Mode: discovery
- Requested mode: fastlane
- Head reviewed: `3c975ba1e06543271374234a7b428ca97739c1bd` (explicit range `36589201~1..HEAD`; the working tree was dirty in unrelated paths and protocol analytics, outside the explicit range)
- Reviewable lines: 224 additions and 116 deletions across 4 reviewable files, including generated change analytics; 177 additions and 1 deletion in the changed test file reviewed inline. Other Markdown change artifacts and the prior round file were context/skipped support files.
- Intent context: Gate 2 approved; D2 § Coverage, D6, D7, PLAN WT-011.12, and tasks 6_1–6_5 apply. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports exit 0 for all 15 tasks. The chair ran no project verify command; only one-off scratch probes were used.
- Verdict: **REJECT**
- Counts: 3 BLOCK · 1 WARN · 1 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | relative detection, classifier, resolver, CLI | Node request boundaries and exit behavior | `gpt-5.6-sol[1M]` |
| asm-review-performance | propagation worklist | mixed fanout and edge-application growth | `gpt-5.6-terra[1M]` |
| asm-review-logic | propagation worklist | soundness under fact-arrival order | `sonnet[1M]` |
| asm-review-contracts | gate API, CLI, tests | accepted obligations and witness non-vacuity | `gpt-5.6-luna[1M]` |
| asm-review-reuse | parser and predicate helpers | duplicate traversal and divergent rules | `gpt-5.6-luna[1M]` |
| chair | full explicit range | all applicable lenses and end-to-end package flow | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security` and `asm-review-frontend` — the range changes no data/auth/storage/API or UI surface. No separate data-scale collection exists, but the package hot path was assigned to `asm-review-performance` with call count × callee holdings × argument holdings as the growth axes.

## Risk map

1. The relative-class guarantee crosses three independently implemented boundaries: literal/template discovery, Node request classification, and host-filesystem resolution.
2. D2 remains on every package run despite becoming warning-only for bare/absolute requests; its worklist is bounded only by artifact topology and size.
3. CLI success depends on severity remaining authoritative from classifier through grouping and `exitCodeFor`.
4. D7 turns any relative-headed template into a failing verdict, so false positives are release-blocking.

## Findings

### [F006] Argument-side fact arrivals still reapply every existing callee target

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-performance (corroborated by chair; asm-review-logic confirmed soundness but not the edge-once cost claim)
- Class: feature
- File: `scripts/bundleRequires.mjs:281-301`
- Status: accepted — persists from round 5
- Triage: The callee-growth boundary is fixed, but the same edge-once invariant remains false at the argument-growth boundary.

**Evidence.** `drainFreshlyHeld()` now queues `{ call, only: fn }` when a callee gains a callable, but `enqueue()` still queues a generic `{ call }` whenever a symbol used as an argument gains a fact. `applyCall(work.call, undefined)` then traverses every target already held by that callee. A focused mixed-fanout probe with N callee targets established before N sequential argument callable arrivals produced `applications/distinct` of `110/10`, `420/20`, `1640/40`, and `6480/80`: exactly `N² + N` applications for N distinct call-target pairs. The committed fixture varies only callee targets while passing ambient `require` directly, so it cannot expose this boundary.

**Impact.** Task 6_4's observable claim that each propagation edge is applied exactly once is still false. A minified bundle that unions both factory targets and argument callables restores quadratic package-time work; the axes have no structural cap below bundle size. The new `only` path remains logically sound in tested late-argument orders, but soundness does not close the accepted cost invariant.

**Suggested fix.** Make argument arrivals delta-specific too: queue an identity containing the newly arrived argument fact and the affected call/parameter edge, apply only that delta to each relevant target, and deduplicate processed edge-plus-fact work. Add the mixed-fanout witness, not another timing budget.

**Invariant inventory.** Verified safe: termination, scalar reverse chains, callee-side target arrivals, and late argument taint reaching existing targets. Affected: callable fact growth on symbols in `passedAs`, and mixed callee-target × argument-fact fanout.

### [F016] Dot-prefixed bare requests still receive failing relative severity

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by asm-review-contracts, asm-review-reuse, and chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:631-633`
- Status: open — new in round 6
- Triage: The D2 warning-only contract is implemented with a broader classifier than D6's relative predicate.

**Evidence.** Candidate discovery uses `isRelativeRequest()`, which recognises only `./`, `../`, `.\\`, and `..\\`, but `classify()` decides that any `specifier.startsWith(".")` is relative. A scratch Node resolver probe successfully resolved `.pkg` from `node_modules/.pkg/index.js`, proving it is a bare request; the gate classified the same spelling as `severity: "fails"`. Even when unresolved, task 6_3 requires a bare-only verdict list to exit 0, while this spelling exits 1.

**Impact.** The user-approved scope cut is incomplete: an unresolvable dot-prefixed bare request can still reject a release, exactly what D2 § Coverage and task 6_3 removed from the gate's authority.

**Suggested fix.** Use one shared request-class predicate for discovery and severity. Requests outside the four relative prefixes must take the bare warning path; preserve the separately approved exact-value limits rather than replacing them with `startsWith(".")`.

**Invariant inventory.** Verified safe: ordinary bare names such as `lodash`, builtins, declared externals, and four normal relative prefixes. Affected: call-detected bare names beginning with `.` other than the explicitly admitted exact limits.

### [F017] Win32-relative spellings are resolved with the builder host's path semantics

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:360-376`
- Status: open — new in round 6
- Triage: F014's detection predicate is fixed, but the newly admitted Win32 class is passed unchanged to the pre-existing host-native resolver.

**Evidence.** `RELATIVE_PREFIXES` now intentionally recognises `.\\` and `..\\`, but those candidates flow to `resolveShipped()`, which uses the process host's `node:path`. On POSIX, `.\\foo` is tested as a filename containing a backslash (`/artifact/dist/.\\foo`), not the Win32 target `foo`. Conversely, on a Windows package build, `.\\foo` can resolve and pass even though the same cross-platform VSIX fails to load that request on the supported macOS/Linux runtimes. The project advertises macOS, Linux, and Windows support; the package script does not encode a target runtime into the gate.

**Impact.** The gate's relative guarantee depends on the release machine rather than the user's editor runtime. A valid target-specific Windows request can be falsely rejected by a POSIX cross-build, and a Windows build can approve an artifact that fails on supported POSIX hosts.

**Suggested fix.** Make target semantics explicit. For one cross-platform artifact, require resolution under every supported Node path model (or reject platform-exclusive separators); for target-specific artifacts, pass the declared target platform and resolve with `path.win32`/`path.posix`, then map the lexical target back onto the builder filesystem. Add a resolving `.\\foo` witness, not only missing-file detection.

**Invariant inventory.** Verified safe: forward-slash relative requests on POSIX and the four-prefix detection step. Affected: backslash requests when builder and target/runtime path semantics differ.

### [F018] Relative-headed path-data and tagged templates fail as module requests

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-logic (corroborated by asm-review-contracts and chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:410-419`
- Status: open — new in round 6
- Triage: D7 deliberately chooses fail-closed behavior, but its proof claim is broader than module requests and the tests do not expose the admitted false-positive surface.

**Evidence.** `relativeTemplates()` selects every `TemplateExpression` in the AST solely from its head. Both `const p = `./${name}`` and `tag`../${name}`` are returned exactly like `require(`./${name}`)`, then `unresolvableRequires()` assigns every result `severity: "fails"`. A tagged template need not evaluate to a string at all, and an untagged relative path may be data for an unrelated filesystem API. The new tests cover only a genuine require-shaped fixture and non-relative/no-substitution negatives.

**Impact.** A legitimate future bundle can be blocked by relative display/path data even though it contains no module request. Zero occurrences in today's artifact is adoption evidence, not a structural bound on this release gate.

**Suggested fix.** Either narrow D7 to request-bearing positions that can be justified by binding/use evidence, or explicitly accept and witness the false-positive boundary with unrelated untagged and tagged templates so future authors know the gate requires rewriting legitimate dynamic path data.

### [F015] The artifact is now parsed three times per gate run

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-reuse (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:661-668`
- Status: open — persists from round 5
- Triage: Severity remains stable; the changed D7 pass enlarges the already recorded duplicate-parse mechanism.

**Evidence.** `requiredSpecifiers()` builds a Program/source file, `relativeLiterals()` separately parses and walks the bundle, and new `relativeTemplates()` parses and walks it again. The latter two also maintain separate relative-prefix conditions.

**Impact.** The 1 MB artifact pays three AST constructions/walks per package run, and future predicate changes can drift between collectors. No new measurement establishes a gating latency impact, so this remains a suggestion.

**Suggested fix.** Parse once in `unresolvableRequires()` and pass a shared `SourceFile`/checker to one traversal that collects literals and templates; keep string-taking exports as thin test wrappers if needed.

## Prior finding dispositions

| Finding | Round-6 disposition |
|---|---|
| F001–F005, F007 | Remain fixed; their manifest/config/parser/binder witnesses were outside the new defects and no recurrence was found. |
| F006 | Persists. Callee-side fanout is fixed, but argument-side mixed fanout violates the same edge-once invariant. |
| F008, F009 | Fixed as gating findings by the approved removal of bare/absolute completeness and failure authority; their known detector gaps now only affect warnings. |
| F010 | Fixed at its recorded impact: context-union false bare candidates no longer reject ordinary bare builds. F016 is a different classifier mechanism that still assigns failing severity. |
| F011, F012 | Closed by the approved D2 scope withdrawal and stated computed non-template limits; D7 separately owns relative-headed templates. |
| F013 | Fixed: `NOT_SPECIFIERS` and the drafted positional exemption are absent; every non-bare prefixed literal is swept. |
| F014 | Exact predicate witness fixed. F017 is a new host/target resolution mechanism after detection. |
| F015 | Persists and now covers a third parse/walk. |

## Full-flow trace

`vscode:prepublish` → `pnpm run package` → production esbuild writes `dist/extension.js` → `build:check-requires` checks both required files and reads the built artifact/config → `declaredExternals()` fails closed on unreadable build config → checker-backed call propagation discovers supported bare/absolute/static calls → full-bundle literal and template passes add relative candidates → `classify()` assigns builtin/external/bare/absolute/relative severity and `resolveShipped()` applies file/manifest containment rules → CLI groups warnings/failures → `exitCodeFor()` is the sole final severity-to-exit decision.

No CLI disagreement was found: any `severity: "fails"` verdict exits 1 and warnings-only exits 0. The defects occur earlier: F016 assigns the wrong severity class, F017 resolves a newly detected class under the wrong target semantics, F018 manufactures failing verdicts from non-request templates, and F006 leaves the warning detector's package-time work unbounded quadratically under mixed fanout. Missing files and unreadable config still fail closed; builtins and `vscode` remain safe.

---

## Author triage — round 6

All five accepted, none rebutted. Every blocker is mine, and two of them are fallout from 6_1
widening the detection predicate without widening what consumes it.

| Finding | Status | Why |
|---|---|---|
| F006 | **accepted** | My 6_4 fix made CALLEE-target arrivals incremental and left argument-side arrivals reapplying every target. Worse, my own witness varied only callee targets, so it could not see the case it was supposed to bound. The measured N²+N stands. |
| F016 | **accepted** | Real inconsistency I introduced: discovery uses the four-prefix `isRelativeRequest`, `classify` uses `startsWith(".")`. A bare package literally named `.pkg` resolves from `node_modules/.pkg/` at runtime and the gate calls it a failing relative request — defeating the warning-only scope cut the user approved. |
| F017 | **accepted** | `.\x` flows into `resolveShipped`, which uses host-native `node:path`. The verdict then depends on the release machine. That is exactly the class of defect this gate exists to stop, in the gate itself. |
| F018 | **accepted** (WARN) | "Zero occurrences today is not a structural bound" is correct. D7 fails closed on any relative-headed template, including path data and tagged templates that are not module requests. |
| F015 | **accepted** (SUGGEST) | Three parses. Taken now because the fixes touch all three collectors anyway. |

### F017 — the mechanism, taken from a sibling rather than invented

`orca/src/relay/git-handler.ts:128-134` and `git-handler-worktree-ops.ts:133-136` both dispatch on the
SPELLING and never on the host: `path.win32.isAbsolute(value) ? path.win32.resolve(...) :
path.posix.resolve(...)`. That is the property this gate needs — the verdict must be a fact about the
specifier, not about the machine that ran the build.

Applied here with one adjustment: resolving through `path.win32` would produce win32-shaped paths that
a POSIX filesystem cannot stat. A Win32-spelled relative specifier names the same target as its POSIX
spelling — the separator is the only difference — so the specifier is normalized to its POSIX
equivalent and then resolved once. Host-independent verdict, one resolver, no target-platform flag.

### Disposition

Cycle 5. The cycle cap makes option 1 mandatory and F017 needs a rule D6 does not currently state, so
this is a handback either way, not a fix loop. **Artifact handback to `asimov-plan`.**

No round 7 is opened: the cap the chair names is respected, and the next review will be a new cycle's
discovery round after the replan.
