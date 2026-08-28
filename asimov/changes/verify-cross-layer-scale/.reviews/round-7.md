# Review Round 7

- Date: 2026-08-28
- Cycle: 3
- Mode: verification
- Scope: range `47b0310cba9c17c6fed70bc41bfa6c707a5fc2ef..a66a635c2990ab1372c2b33ed7cf41a8444e0331`, plus every round-6 finding boundary and the author's impact manifest
- Scope lock: passed — task 9_1 contains only accepted B15/W5/W6 remediation, fixtures, review/build metadata, and no new production capability, invariant owner, or design contract
- Head: `a66a635c2990ab1372c2b33ed7cf41a8444e0331` (reviewed commit range; working tree also contains dirty Asimov analytics files outside the requested range)
- Reviewable lines: 154 (plus 181 changed test/support lines; 145 skipped Markdown lines)
- Verification evidence: caller reports check-types clean; 234 files / 4,733 tests passing; `gate:fs-deletion` passing over 29 scoped modules with 11 proven spellings; scale bench passing at 0.1 ms presence / 32.6 ms model; `verify-status` exit 0; lint finding set identical to clean main under Biome 2.4.5. Review commands were not rerun. Targeted scratch probes created and deleted in one command showed one remaining acquisition bypass and two false-positive boundaries.
- Agents spawned: `asm-review-contracts` (B15/W5 gate cone, `gpt-5.6-sol[1M]`); `asm-review-logic` (W6 lifecycle cone, `sonnet[1M]`)
- Agents skipped: data-security, frontend, performance, reuse — their boundaries are outside the verification cone
- Verdict: BLOCK
- Open counts: BLOCK 1, WARN 1, SUGGEST 0
- Fixed this round: W5, W6; B15's four round-6 reproduction forms

## Open findings

### B15

- ID: B15
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:156`
- title: Nested destructuring assignments keep the I10 acquisition bypass open
- evidence: The new assignment branch only examines properties directly inside the left-hand `ObjectLiteralExpression`. For `({ promises: { rm: wipe } } = fs)`, it asks whether the top-level `promises` property is destructive and never pairs the nested object with the `fs.promises` owner type. Recursive AST traversal reaches the nested object, but it is not itself the left operand of an equals expression and no branch processes it as an assignment pattern. A targeted scratch module under `src/worktree/` made `fsDeletionGate.ts` exit 0 for this acquisition. Boundary inventory update: named/renamed imports, direct/promises properties, literal and runtime element access, declaration/nested binding destructuring, quoted binding keys, flat assignment destructuring, direct assignment, `any` cast, erased fs alias, and lexical shadows were searched. Fixed/safe this round: quoted binding, flat assignment, `any` cast, erased fs alias, runtime-decided element key, path normalization. Still affected: nested destructuring assignment.
- impact: In-scope removal code can still acquire `rm` through the assignment equivalent of the already-covered nested binding form while I10 and the Verify Gate stay green. This is the same safety impact and causal mechanism as round-6 B15, so severity remains BLOCK.
- suggestedFix: Do not add another top-level shape patch. Recursively walk destructuring-assignment patterns while carrying the selected property's type as the next owner, using `memberName`/runtime-key handling at every level. Add a nested assignment fixture. Because B15's boundary inventory expanded again in its verification round through the same shape-enumeration mechanism, hand this mechanism back to planning before another patch-level fix.
- status: open — persists from round 6; four named boundaries fixed, invariant-level remediation incomplete
- triage: accepted in round 6; current persistence pending author triage

### W7

- ID: W7
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:130`
- title: Erased types are treated as filesystem provenance
- evidence: `acquires()` receives only the owner's type. At lines 132 and 141 it rejects every runtime key on `any`/`unknown`, and every destructive-looking member name on `any`/`unknown`, without checking whether the expression originated from `node:fs`. Targeted scratch modules showed both `declare const cache: any; cache.rm(key)` and `cache[key]` reported as I10 filesystem deletion. `pass-erased-unrelated.ts` covers only a statically named non-destructive member (`writeSummary`), so it does not exercise either collision. D10's fail-closed clause names non-literal access on an fs namespace, and task 9_1's boundary says unresolved symbols on fs-derived expressions reject; neither authorizes treating every erased value as fs-derived.
- impact: Valid in-scope code using an unrelated erased API with an `rm` method, or any runtime-indexed erased value, fails the mandatory project gate. This creates pressure to weaken or bypass I10 even though no filesystem symbol was acquired.
- suggestedFix: Preserve expression/symbol provenance into `acquires()`. Apply erased-owner fail-closed handling only when the owner originates from a `node:fs` namespace or fs-derived alias; add pass fixtures for unrelated `any.rm` and unrelated `any[key]`.
- status: open — new finding inside B15's widened rejection impact cone
- triage: pending author triage

## Fixed findings

### W5

- status: fixed
- evidence: Every scope and fixture comparison now receives `relativeTo(fileName)`, which converts platform-native separators to `/` before predicate evaluation, including the final vacuity count.

### W6

- status: fixed
- evidence: `afterEach` captures synchronous or rejected deactivation failures, clears `teardown` and splices/disposes every subscription in `finally`, retains all cleanup failures, and asserts only after all cleanup completes. Same-module activate/deactivate capture is unchanged.

## Specialist adjudication

- The contracts specialist independently reproduced both B15's nested-assignment bypass and W7's unrelated-erased false positives. It graded the nested bypass WARN; severity remains BLOCK under cross-round stability because B15 is the same accepted P1 invariant finding, through the same shape-enumeration mechanism, with no impact or reachability reduction.
- The logic specialist found W6 fully fixed and no new lifecycle issue in its impact cone.
- The fixture-specific Biome suppressions are appropriate: they pin load-bearing syntax that the formatter/fixer would otherwise rewrite out of the TypeScript Program fixture. Moving the cases into strings would stop exercising the gate's real Program path.
- No audit-backlog or user-granted accepted-risk entries carry forward.

---

## Triage — author, round 7

Both accepted, neither rebutted. Both reproduced before triage with ephemeral fixtures, since the
gate's own fixture mechanism is the cheapest reproduction harness available.

| ID | Status | Rationale |
|---|---|---|
| B15 | **accepted** | Reproduced. `({ promises: { rm: wipe } } = fs)` left the gate at exit 0. The assignment branch reads only top-level properties and never descends carrying the selected property's type as the nested owner. |
| W7 | **accepted** | Reproduced, and it is the defect I asked the chair to hunt. `cache.rm(key)` and `cache[key]()` on an `any` parameter were both rejected as filesystem deletion. Fail-closed was implemented without provenance, so it rejects on the member NAME alone once the type is erased. |

### Thrash stop — declared

Trigger: **the same invariant survives 2 fix attempts.** I10 has now been fixed twice against this
mechanism — task 8_2 (the checker gate from the round-5 designed handback) and task 9_1 (unifying
member-name extraction) — and B15 is open after both.

A second trigger arguably also holds: a fix reintroducing a previously closed finding. Round 5
recorded that the hand-written resolver "produced **false positives** on a harmless parameter named
`rm`". W7 is that same failure direction, reintroduced by the fix for the opposite one.

### The pattern, stated without flattery to the previous fix

Every version of D10 has asked *which syntactic shapes acquire an fs symbol*. That set is
open-ended, and four rounds have each found new members of it:

| Round | Shapes newly discovered | Mechanism |
|---|---|---|
| 4 | named / renamed / namespace import | regex → AST binding walk |
| 5 | assigned member, element access, nested destructuring | AST walk → TypeScript checker |
| 6 | quoted key, destructuring assignment, `as any`, erased alias | checker + inline name reading |
| 7 | **nested** destructuring assignment | checker + unified name reading |

Round 6's diagnosis — "name extraction was reimplemented at each shape" — was correct and
insufficient. Unifying the reader fixed the four shapes then on the table and did nothing about the
fifth, because the enumeration itself is the defect, not how each entry reads its key.

### Hypothesis for the handback, stated so it can be attacked rather than assumed

Ask a different question. Not *which shapes acquire the symbol*, but **does this expression's TYPE
resolve to a destructive `node:fs` symbol** at the point of use. At a call site, `wipe(dir)` has a
callee whose type is `typeof fs.promises.rm` whatever syntax produced `wipe` — nested destructuring,
quoted key, assignment, alias all collapse into one question the checker already answers, asked at
one node kind.

This also supplies W7's missing provenance for free: `cache.rm(key)` has a callee of type `any`
whose symbol is not an fs declaration, so it is not a finding, and no name-based guess is needed.

It is not free of design work — an `any`-typed callee derived from an fs expression
(`(fs.promises as any).rm(dir)`) still needs a provenance rule, which is precisely what W7 asks for
and precisely what a mid-loop patch should not be inventing. It also contradicts D10's current
wording ("It does not follow an alias to its call site"), so it is an accepted-design change and
needs Gate 2 rather than another task.

### What is NOT true, and matters for the decision

There is no filesystem-deletion defect in production. The 29 in-scope modules are clean, verified
every round. B15 is a hole in a GUARD against a future regression, and the shapes it misses are
ones nobody writes by accident.
