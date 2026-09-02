# Review round 7 — fail-a-build-whose-bundle-cannot-resolve-itself

- Date: 2026-09-02
- Cycle: 6
- Mode: discovery
- Requested mode: fastlane
- Head reviewed: `2457947eec021d677a284a5c75ede455e11960fe` (explicit range `3c975ba1e06543271374234a7b428ca97739c1bd..HEAD`; the working tree was dirty only in analytics state outside the explicit range)
- Reviewable lines: 448 additions/deletions across 4 reviewable files, including generated change analytics; 233 test additions across 2 test files were reviewed inline. Markdown review/change artifacts were context or skipped support files.
- Intent context: Gate 2 approved; D2, D2 § Coverage, D6, D7, PLAN WT-011.12, and tasks 7_1–7_5 apply. No `proposal.md` exists (light-lane change).
- Verify evidence: `bun run asm change verify-status fail-a-build-whose-bundle-cannot-resolve-itself` reports exit 0 for all recorded tasks through 7_5. The chair ran no project verify command; only focused one-off probes were used.
- Verdict: **BLOCK**
- Counts: 2 BLOCK · 0 WARN · 0 SUGGEST
- Split over gating blockers: 2 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-logic | propagation worklist | argument-arrival soundness under all discovery orders | `gpt-5.6-sol[1M]` |
| asm-review-performance | propagation worklist | real mixed-fanout growth and witness validity | `gpt-5.6-terra[1M]` |
| asm-review-logic | classifier, resolver, templates | request-class and syntactic boundary correctness | `sonnet[1M]` |
| asm-review-contracts | gate API and invariant suite | accepted obligations and witness non-vacuity | `gpt-5.6-luna[1M]` |
| asm-review-reuse | parser and predicates | shared implementation and divergence | `gpt-5.6-luna[1M]` |
| chair | full explicit range | all applicable lenses and end-to-end package flow | `gpt-5.6-sol[1M]` |

Additional trace: `asm-finder` mapped the package-to-exit flow and found no production consumers of `parseCount`, `propagationStats`, `relativeLiterals`, or `relativeTemplates` outside the gate/tests.

Skipped: `asm-review-data-security` and `asm-review-frontend` — the range changes no data/auth/storage/API or UI behavior. The unrelated sibling test addition inside the interleaved range was reviewed inline and produced no finding.

## Risk map

1. D2's worklist is a package hot path whose growth axes are call edges, callee targets per symbol, callable/taint facts per argument symbol, and matching parameter positions; none is structurally capped below bundle size.
2. D7's release-blocking verdict depends on recognizing computed relative templates without re-admitting ordinary path data or tagged templates.
3. D6's relative guarantee crosses one shared class predicate, spelling normalization, package containment, and host-independent filesystem resolution.
4. The one-parse refactor changes the production aggregation path while retaining test-facing wrapper collectors and a global observable counter.

## Findings

### [F006] Argument arrivals still replay every prior fact, and the witness no longer counts that work

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: asm-review-performance (corroborated by both asm-review-logic and asm-review-contracts, and independently by chair)
- Class: feature
- File: `scripts/bundleRequires.mjs:306-323`
- Status: accepted — persists from round 6
- Triage: The argument-arrival branch is semantically sound in the searched orders, but it still violates the accepted edge-plus-fact-once invariant and hides the repeated work from `propagationStats`.

**Evidence.** Each newly held fact on an argument symbol causes `enqueue()` to queue `{ call, fromArgument: symbol }`. `deliverArgument()` then scans every current callee target and calls `flow(held, valueOf(argument))`; `valueOf(argument)` names the whole symbol, and `flow()` iterates every callable already held by it. With N callee targets and N argument callables, the branch performs N² target scans and N²(N+1)/2 callable-fact visits. A focused scratch instrumentation of the committed topology measured:

| N | exported applications/distinct | hidden target scans | hidden callable-fact visits |
|---:|---:|---:|---:|
| 10 | 10 / 10 | 100 | 550 |
| 20 | 20 / 20 | 400 | 4,200 |
| 40 | 40 / 40 | 1,600 | 32,800 |
| 80 | 80 / 80 | 6,400 | 259,200 |

`propagationStats` increments only inside `applyCall()`. The new `fromArgument` path bypasses that accounting, so the committed assertions report linear work while omitting the quadratic target replay and cubic fact replay they are meant to bound.

**Soundness result.** No dropped-fact ordering was found. A 24-permutation probe over two callee targets and two argument callables found every expected specifier; separate probes covered the same symbol in two argument positions, a target arriving after its argument facts, and an argument fact arriving after its targets. Later targets receive the accumulated argument facts through `applyCall(call, only)`. This closes the caller's soundness question but does not close F006's accepted cost invariant.

**Impact.** The package gate can still do cubic propagation work on a minified bundle with mixed callee/argument fanout, despite task 7_4 claiming each edge/fact application is processed once. The growth axes are uncapped below bundle size, and the test can keep passing through regressions on the changed path.

**Suggested fix.** Carry the concrete newly arrived fact in the argument-side work item, deliver that delta only to the positions and targets it reaches, and deduplicate a stable `(call, target, position, fact)` identity. Keep `applyCall(call, only)` for later targets so they receive the complete accumulated set once. Extend `propagationStats` to count the argument-side fact-edge deliveries it currently omits.

**Invariant inventory.** Verified safe: termination; assignment-chain propagation; callee-side target arrivals; alternating target/fact discovery; late targets through `only`; late arguments; repeated argument positions; downstream scheduling. Affected: argument-side target scans, argument-side callable-fact delivery, mixed callee-target × argument-fact fanout, and the production-visible count witness.

### [F019] Parenthesized computed requests bypass the call-argument template sweep

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair (corroborated by both asm-review-logic agents and asm-review-contracts)
- Class: feature
- File: `scripts/bundleRequires.mjs:67-72`
- Status: open — new in round 7
- Triage: F018's over-reporting mechanism is fixed; this is the opposite boundary introduced by the new immediate-parent test.

**Evidence.** `isCallArgument()` first requires the template's immediate parent to be a `CallExpression` or `NewExpression`. In `require((`./${name}`))`, the template's parent is a `ParenthesizedExpression`, so the function returns false before its `unwrap(argument) === node` comparison can help. A focused probe returned `relativeTemplates("r(`./${name}`)") === ["./"]` but `relativeTemplates("r((`./${name}`))") === []`. The parenthesized request is not a string literal, and `requireLiteral()` deliberately ignores computed arguments, so no other collector reports it.

**Impact.** The production CLI can exit 0 while the shipped bundle contains a computed relative request that D7 requires to fail. Redundant parentheses are valid JavaScript and a normal transform output, so the relative-only guarantee is unsound at a load-bearing release gate.

**Suggested fix.** Walk upward through enclosing `ParenthesizedExpression` nodes before checking the call/new parent, then confirm the outer wrapper is the call argument whose unwrapped value is the template. Add direct and UMD-style parenthesized computed-request witnesses, alongside the existing tagged-template negative.

**Invariant inventory.** Verified safe: direct call arguments; direct `new` arguments by the same parent rule; non-call path data; object-held path data; tagged templates. Affected: one or more parentheses around a `TemplateExpression` used as a call or constructor argument.

## Prior finding dispositions

| Finding | Round-7 disposition |
|---|---|
| F001–F005, F007–F014 | Remain fixed/closed; no changed mechanism re-opened them. |
| F006 | Persists. The searched discovery orders are sound, but argument-side delta processing remains superlinear and its witness omits the changed branch. |
| F015 | Fixed: the production gate builds one bundle AST and one config AST; wrappers delegate to the same collectors. |
| F016 | Fixed: discovery and severity share `isRelativeRequest`; dot-prefixed bare names warn and exit 0. |
| F017 | Fixed for the approved four-prefix spelling rule: Win32-prefixed requests normalize before the one host filesystem resolver and containment remains enforced. |
| F018 | Fixed at its recorded impact: non-call path data and tagged templates no longer fail. F019 is a distinct immediate-parent false-negative introduced by the narrowing. |
| F019 | New: parenthesized computed call arguments are missed. |

## Full-flow trace

`vscode:prepublish` → `pnpm run package` → checks/vendor gate → production esbuild emits `dist/extension.js` → `build:check-requires` verifies the bundle/config exist and reads them → `declaredExternals()` parses the config fail-closed → one bundle AST feeds binder-backed call propagation, literal sweep, and template sweep → `classify()` routes builtins/externals, warnings-only bare/absolute requests, and failing relative requests → `resolveShipped()` normalizes approved Win32-prefixed spellings, enforces artifact containment, and applies file/directory/manifest resolution → CLI groups warning/failing verdicts → `exitCodeFor()` returns 1 exactly when a failing relative verdict exists.

F016, F017, and F015 close cleanly through this flow. F006 remains in the always-run warning detector's package-time hot path. F019 occurs before classification: the parenthesized template never becomes a candidate, so no failing verdict reaches `exitCodeFor()`.

---

## Author triage — round 7, 2026-09-02

| Finding | Status | Triage |
|---|---|---|
| F019 | **accepted** | Reproduced exactly. `relativeTemplates` returns `["./"]` for `` r(`./${name}`) `` and `[]` for `` r((`./${name}`)) ``, and `unresolvableRequires` returns no verdict at all for the parenthesized form. My `isCallArgument` unwraps the *argument* but not the node's own parent chain, so a `ParenthesizedExpression` between template and call defeats it. This is a hole in D7's stated relative-only guarantee and a defect I introduced in task 7_3. |
| F006 | **accepted as fact; the OBLIGATION is what must change** | The cost claim is correct and my witness was vacuous for the path I changed — `propagationStats` increments only inside `applyCall`, so `deliverArgument`'s work is invisible to it. Measured growth on the mixed topology: 40→160 members is 10.9ms→117.8ms, ~11x for 4x the input. Task 7_4's assertions are true and uninformative. |

### Premise audit — the edge-once cost invariant

The thrash-stop applies twice over: this is cycle 6, and the same invariant has now survived three
fix attempts (round 4's timing budget, round 5's callee-side `only` path, round 6's task 7_4
argument-side delivery). Under `asimov-build` § Review Fix Loop that makes option 1 mandatory. Before
handing back I re-verified the shipped baseline the obligation is supposed to protect.

Measured on the real artifact — `dist/extension.js`, 1,908,308 bytes:

- `propagationStats` → **3555 applications for 3489 distinct pairs**, in **327 ms**.

Two things follow.

1. The edge-once invariant is **already false on the real artifact** — 66 applications above
   distinct — and has been through every round that claimed to have established it. The round-5 and
   round-6 witnesses only ever asserted it on synthetic fixtures built to exhibit one topology each.
2. The cost it exists to prevent is **not evidenced by any real state**. The whole propagation over
   the shipped 1.9 MB bundle is 327 ms inside a package-time gate. The Θ(N²)/Θ(N³) growth is real,
   but its defeater is a fixture with N identical reassignments of one binding, a shape no bundler
   emits.

So the machinery is being hardened against a state nothing in the shipped baseline requires, and the
obligation as written (`D2`, "each propagation edge is applied exactly once") cannot be discharged by
a fix — it is not true of the artifact the gate actually reads.

### Disposition

**Option 1 — hand back to `asimov-plan`.** Not a fix loop. The handback carries two items:

- `D2`'s cost obligation is rewritten from an asymptotic edge-once claim to a bound the shipped
  artifact evidences: a measured ceiling on propagation work, failing closed if a bundle ever exceeds
  it, with the real artifact's 3555/3489 in 327 ms as the recorded baseline. The witness must count
  every path's work, `deliverArgument` included, or it is vacuous again.
- `D7` gains the parenthesis case (F019) as a soundness requirement, not a cost one.

F019 alone would be ordinary remediation. It is folded into the handback rather than landed first
because a fix commit now would close this cycle as `superseded` and burn round 8, which the CLI
already refuses without another explicit user decision.
