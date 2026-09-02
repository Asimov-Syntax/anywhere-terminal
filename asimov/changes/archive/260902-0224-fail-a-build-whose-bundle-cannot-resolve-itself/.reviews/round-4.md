# Review round 4 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 3
- Mode: discovery
- Operating mode: fastlane
- Round extension: accepted by the review protocol; `asm review round-start` proceeded with round 4.
- Head reviewed: `d3ccc700df75d77e0ec0191c1e4cff2b324dbea5` (explicit range Head; target files match the commit)
- Diff scope: `git diff 1185220633febc6eeaeae3c872792d885bb9b36e..d3ccc700df75d77e0ec0191c1e4cff2b324dbea5`
- Working tree: protocol-generated analytics changes and unrelated untracked paths were outside the explicit range.
- Reviewable lines: 142 additions and 126 deletions in `scripts/bundleRequires.mjs`; 61 additions and 3 deletions in the test file reviewed inline. Task/workflow metadata changed by 8 additions and 5 deletions.
- Intent context: Gate 2 approved after the round-3 handback; current D2–D5 and tasks 4_1–4_3 applied. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports tasks 1_1 through 4_3 exit 0 and records 44 assertions. The author recorded clean type-check, 6756 passing unit tests, the Biome 3/14/1 baseline, a 0.47-second real-artifact gate, and four simultaneous artifact arms. The chair ran no project verify command.
- Verdict: **REJECT**
- Counts: 3 BLOCK · 2 WARN · 1 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | checker-backed binding graph | emitted call/value forms, taint precision, and declared limits | `opus[1M]` |
| asm-review-performance | checker-backed fixed point | termination, topology growth, and D2 worklist obligation | `gpt-5.6-terra[1M]` |
| asm-review-contracts | manifest and config fixes | Node resolution and fail-closed authority | `sonnet[1M]` |
| chair | full range | all applicable lenses and package full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-data-security`, `asm-review-frontend`, and `asm-review-reuse` — the range adds no data/auth or UI surface, and the hand-rolled lexical resolver was replaced by the installed TypeScript binder rather than reimplemented again.

---

## Findings

### [F006] The promised worklist is absent, and the checker version remains quadratic on deep propagation

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-performance (corroborated by chair and asm-review-logic)
- Class: feature
- File: `scripts/bundleRequires.mjs:200`
- Status: accepted — persists from round 3 with severity escalation
- Triage: F006 escalates from WARN to BLOCK because the newly approved D2 explicitly requires worklist/reverse-index propagation, the implementation still performs whole-graph rescans, and the checker version materially increases the evidenced deep-topology cost.

**Evidence.** The convergence loop reprocesses every collected assignment and every call×target×parameter edge on every pass. There is no queue or reverse index despite D2 and task 4_1 saying each propagation edge is processed once. Current-code reverse-chain measurements showed quadratic growth: approximately 0.49 seconds at 1,000 links, 2.07 seconds at 2,000, and 8.31 seconds at 4,000 links in a 61.8 KB bundle; a second probe measured 6.39 seconds at 2,000 links. The current 1 MB artifact completes quickly because its propagation depth is shallow, not because the growth mechanism changed.

**Impact.** A small dependency with deep forwarding topology can stall `vscode:prepublish` before the later size gate. This is a load-bearing divergence from approved D2 on the package command's only execution path.

**Suggested fix.** Implement the accepted worklist: pre-index source symbol → dependent assignments and call-argument → parameter edges, enqueue newly tainted symbols and newly discovered symbol/function holdings, and process each edge/fact once.

**Invariant inventory.** Termination remains formally safe because `tainted` and `holds` grow monotonically over finite domains. Safe boundary: the current shallow artifact. Affected boundary: propagation depth, unbounded structurally and not bounded by the later byte-size gate.

### [F008] Conditional and logical aliases of ambient require are not modeled as values

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:149`
- Status: accepted — new in round 4
- Triage: New value-expression mechanism; the round-3 direct scalar-alias witness is fixed.

**Evidence.** `valueOf()` recognizes only a function expression/arrow or a bare identifier. Conditional, logical, and sequence expressions return `undefined`, so no taint reaches the target symbol. Production esbuild preserves standard environment-probe forms such as `var r = typeof require === "function" ? require : fallback; r("./conditional")`; the current detector returns `[]`. A production-minified UMD-shaped probe with the guarded alias calling `./impl/format` likewise passed undetected. `require || fallback` and `(0, require)` aliases also miss.

**Impact.** A dependency can ship the original unresolved relative-load failure behind a standard guarded alias while the package gate exits successfully. This is neither a computed specifier nor data-structure-carried taint.

**Suggested fix.** Make `valueOf` return a set of possible sources and recursively union the value-producing branches of conditional, `||`/`??`/`&&`, and sequence expressions. Feed those sources through the worklist and add a production-minified guarded-require witness.

**Invariant inventory.** Verified safe: direct identifier initializers and assignments, declaration factories, ambient/local identity, and the historical minified UMD witness. Affected: conditional, logical, and sequence-valued scalar aliases.

### [F009] Factories invoked through `Function.prototype.call` have no target in the graph

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-logic (corroborated by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:185`
- Status: accepted — new in round 4
- Triage: New invocation-shape mechanism, independent of F008's value extraction.

**Evidence.** `targetsOf()` accepts only direct function-expression or identifier callees. A `factory.call(null, require)` invocation has a `PropertyAccessExpression` callee and therefore returns no targets. With the repository's exact production esbuild flags, `var factory=function(r){r("./called")}; factory.call(null,require)` remains a `.call` invocation and `requiredSpecifiers()` returns `[]`. A webpack-style IIFE using `.call(this, typeof require === "function" ? require : "error")` is also emitted intact and missed.

**Impact.** UMD templates that bind `this` with `.call(root, require, exports, module)` can carry an unresolvable relative request while the gate reports clean.

**Suggested fix.** Recognize `.call` on a function-holding expression, resolve targets from the receiver, and map parameters from arguments after the `thisArg`. Treat literal-array `.apply` similarly or document it explicitly; `.bind` requires representing the returned bound function.

**Invariant inventory.** Verified safe: direct/IIFE invocation and direct identifier calls. Affected: `.call`; `.apply` and `.bind` remain adjacent unmodeled call shapes.

### [F010] Context-insensitive union can taint an unrelated factory

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: asm-review-logic
- Class: feature
- File: `scripts/bundleRequires.mjs:205`
- Status: open
- Triage: Non-gating false-rejection warning.

**Evidence.** One helper called at multiple sites unions every function ever held by its function parameter and every taint ever held by its value parameter. If one call passes a require-tainted value to factory A and another call passes an ordinary callback to factory B, the merged parameter facts can taint B's parameter. A focused two-call helper probe reported both `./real2` and `./innocent`, although the second callback never receives require.

**Impact.** A shared invoke helper can make a valid dependency fail the package gate. The current artifact does not trigger this shape, but the widened function-declaration graph makes it reachable in future dependencies.

**Suggested fix.** Preserve enough call-site context to pair a target function with the argument facts from the same invocation, or explicitly record this conservative false-positive boundary in D2.

### [F012] The two declared limits are reachable production shapes, not merely theoretical

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair
- Class: feature
- File: `scripts/bundleRequires.mjs:223`
- Status: open
- Triage: Non-gating limitation warning requested for this round.

**Evidence.** Production esbuild preserves both forms unchanged: `var r=require,p="./computed"; r(p)` is missed because the argument is an identifier, and `var box={r:require}; box.r("./boxed")` is missed because taint crosses an object property and the callee is a property access. Direct `require(moduleName)` calls and object-carried loader callbacks are established JavaScript module-loader idioms. The first example is statically recoverable even though it falls under the blanket computed-specifier limit.

**Impact.** The gate remains a tripwire rather than evidence that every surviving runtime request resolves; a literal relative request hidden behind either form can reproduce activation failure undetected.

**Suggested fix.** At minimum distinguish statically constant argument symbols from genuinely dynamic computed inputs. Either add bounded property-flow support for simple object literals or keep the data-structure limit explicit and avoid stronger completeness claims.

### [F011] Default-parameter and return-value require flows remain untracked

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: asm-review-logic
- Class: feature
- File: `scripts/bundleRequires.mjs:107`
- Status: open
- Triage: Low-likelihood scalar-flow gap.

**Evidence.** Parameter initializers are not collected as assignments, and call return values are not represented: `function f(r=require){r("./default")}; f()` and `function get(){return require}; get()("./returned")` both return no specifiers. Production esbuild preserves the default-parameter form. Neither is one of the two declared limits, but no dependency-shaped witness was found in the current graph.

**Impact.** A less common scalar forwarding form can escape the tripwire.

**Suggested fix.** Collect identifier parameter initializers as value edges. Add return-value propagation only if a real dependency witness appears; otherwise name it as a limit.

---

## Prior finding dispositions

- **F001 — fixed.** Existing manifests are now read before sibling indexes; malformed-plus-index fails while valid no-main-plus-index still resolves.
- **F002 — fixed.** Historical production-minified UMD calls remain detected.
- **F003 — fixed.** Shorthand properties now join the fail-closed config guard; the plain repository config still reads.
- **F004/F005/F007 — fixed as one resolver defect.** TypeScript symbol identity closes function declarations, direct scalar aliases/assignments, block scope, ambient/local distinction, and the exact legitimate-local false rejection.
- **F006 — persists and escalates.** Termination is preserved, but the accepted worklist does not exist and current deep-topology measurements are materially worse.

## Full-flow trace

`vscode:prepublish` → `pnpm run package` → type/lint/vendor gates → production esbuild writes `dist/extension.js` → `build:check-requires` creates one no-lib/no-resolve TypeScript Program over the artifact → the checker supplies symbol identity → assignments, functions, and calls are collected → the fixed point propagates holdings/taint → literal calls are extracted → the matching esbuild config's externals are read → builtins, bare requests, relative files, and manifest directories are classified → bad verdicts or uncaught extractor errors exit nonzero → size and VSIX checks run afterward. There is one production consumer and no auth, persistence, cache, or alternate entry mode. F008/F009 omit module loads before classification; F006 can stall the only path; F010 can add a false load.

---

## Author triage — round 4

**F006 — accepted, and it is my divergence.** D2 step 4 and task 4_1 step 4 both say "worklist with
reverse indexes so each edge is processed once". I implemented a rescan loop and then reported 0.47s
on the real artifact as though it answered the concern. It does not: it shows this bundle's graph is
shallow, which is a fact about the input, not about the algorithm. The measurement was real and the
inference from it was wrong.

**F008, F009 — accepted.** `var r = typeof require === "function" ? require : fallback` and
`factory.call(null, require)` are both ordinary production shapes, and neither is a computed
specifier nor data-structure flow, so neither is covered by the declared limits.

**F010, F012, F011 — accepted as valid, and all five findings above are subsumed by the disposition
below rather than fixed individually.**

### Disposition: handback, and the mechanism changes rather than the coverage

The cycle cap applies — this is cycle 3, so option 1 is mandatory and no further fix loop opens.
That is the correct outcome independently of the cap, because the rounds describe a pattern:

| Round | Mechanism | How it failed |
|---|---|---|
| 1 | text scan | comments, strings, `loader.require` |
| 2 | identifier match | minification renames the callee |
| 3 | hand-rolled scope resolver | declarations, assignments, ambient-vs-local |
| 4 | binder-backed taint | conditionals, `.call`, unions, property flow |

Every round asked **how the call is spelled** and every round found another spelling. That question
has no bounded answer over a minified artifact.

The defect class is not a call shape. It is **a relative specifier that does not resolve beside the
bundle**. Measured on the real 1 MB `dist/extension.js`: it contains exactly **one** distinct
relative-looking string literal, `"../"`, and that one is an argument to `.startsWith()` in a path
test. So sweeping every relative string literal and resolving it is sound over the shipped defect
class, catches F008, F009, F011 and F012's first case at once without asking how anything is called,
and has a measured noise floor of one string on the artifact it guards.

It does NOT replace call detection: a BARE specifier cannot be swept, because every string in the
bundle would be a candidate. So the binder-backed detection stays for bare and absolute specifiers,
where it is the only available signal, and the sweep takes the relative class it cannot secure.

The trade-off is real and is being recorded, not hidden: the sweep is sound but imprecise, so it can
flag a relative string that is not a module load, and clearing one means an explicit allowlist entry.
Today that list has one candidate. This is the open question carried to Gate 2.
