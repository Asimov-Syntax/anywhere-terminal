# Review Round 11

- Date: 2026-08-28
- Cycle: 5
- Mode: verification
- Scope: range `b725de9c0c0650d97f88e8fc4253fd7d2e5044c0..db8b1f85c775d449658414d50d73be7a3941ddbf`, plus all round-10 finding boundaries and the author's impact manifest
- Scope lock: passed — task 12_1 contains only accepted B19/W8/W10/W11/W12/S13 remediation, fixture/contract corrections, and review/build metadata; no production capability, invariant owner, or new design mechanism was added
- Head: `db8b1f85c775d449658414d50d73be7a3941ddbf` (reviewed range; working tree also contains dirty Asimov analytics files outside the requested range)
- Reviewable lines: 133 (plus 145 changed test/support lines; 370 skipped Markdown lines)
- Verification evidence: caller reports check-types clean; 234 files / 4,733 tests passing; `pnpm run gate:fs-deletion` exit 0; scale bench passing at 0.1 ms presence / 33.2 ms model; lint equal to local main under Biome 2.4.5; `verify-status` exit 0. Project verification commands were not rerun. A targeted in-memory TypeScript Program probe confirmed the call-produced fixture now retains the `rm` symbol from `promises.d.ts` while the structural fixture resolves `rmSync` to its local declaration; no repository files were written.
- Agents spawned: `asm-review-contracts` (B19 and contract cone, `gpt-5.6-sol[1M]`); `asm-review-logic` (W8/W10/W11/W12/S13 gate and fixture cone, `gpt-5.6-terra[1M]`)
- Agents skipped: data-security, frontend, performance, reuse — their boundaries are outside the verification cone
- Verdict: WARN
- Open counts: BLOCK 0, WARN 2, SUGGEST 0
- Fixed this round: W8, W10, W11, S13; most of B19; W12's missing/counting halves

## Verification cone

- B19 contract surface: canonical D10, registry I10 statement/comment/stimulus/status, project command description, gate header and success/failure output.
- W8 executable-reference predicate: type positions, declaration/binding names, import/export bindings, shorthand values, assignment targets, property/element references, and the new pass fixture.
- W10/W11 gap truth: call-result symbol provenance through the unasserted helper and real `node:fs` crossing the structural parameter boundary.
- W12 inventory: required gap presence, closed-gap detection, fixture-directory scoping, undeclared extras, and success count.
- S13 pass inventory: obsolete erased fixture removed while W7 member/index guards remain.

## Open findings

### B19

- ID: B19
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:6`
- title: Gate comment still grants universal proof to finite integration tests
- evidence: The remediated header says this gate does not prove “the extension deletes no directory itself” because “the real-git integration tests ... do.” Grammatically, `do` assigns those tests the same universal proof that canonical D10 now rejects at `design.md:121-124`; those tests establish delegation only on exercised paths. The comment also names nonexistent `src/extension.worktreeMutations.integration.test.ts`; the actual file is `src/worktree/worktreeMutations.integration.test.ts`. Boundary inventory update: the canonical D10, registry evidence-standard comment/stimulus, project command description, failure header, and success output are now narrow and mutually consistent. Only this gate-header sentence/path still overclaims.
- impact: B19 is not fully closed across its contract surface. A maintainer reading the rule is still told that finite integration tests prove the universal negative, contradicting the authoritative design immediately linked above it.
- suggestedFix: Say the real-git tests prove delegation on the exercised shipped removal path, not universal direct-deletion absence, and correct the file path to `src/worktree/worktreeMutations.integration.test.ts`.
- status: open — persists from round 10 with materially reduced reach
- triage: accepted in round 10; authoritative D10/registry/output fixed, remaining comment pending author triage
- severity delta: downgraded from BLOCK to WARN because the normative design, registry evidence standard, project command, and user-visible gate output are fixed; the remaining contradiction is confined to one non-executable source comment

### W12

- ID: W12
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-contracts` + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:204`
- title: The named gap inventory still accepts undeclared extra gaps
- evidence: `seenGaps` records every fixture whose basename starts with `gap-`, but validation at lines 225-229 checks only that every `EXPECTED_GAPS` member was seen. Adding `gap-new-limit.ts` therefore remains green, needs no `EXPECTED_GAPS` edit despite the README saying it does, and increments the success message's “declared gaps” count. Boundary inventory update: missing expected gaps now fail, closed gaps fail, expected cases are named, and counting is restricted to classified fixture files. Still affected: unexpected extra gaps. Verified safe: deletion/move of an expected fixture, closure of a known gap, and unrelated `gap-*` names outside the fixture directory.
- impact: An unreviewed fifth non-deciding condition can silently enter the asserted set and be reported as declared, so the four-case D10 inventory is not authoritative in both directions.
- suggestedFix: Reject every observed `gap-*` name absent from `EXPECTED_GAPS`, or compare `seenGaps` and `EXPECTED_GAPS` for exact set equality before success; report the validated expected-set size.
- status: open — persists from round 10; missing/counting halves fixed, extra-inventory half remains
- triage: accepted in round 10; current persistence pending author triage

## Fixed findings

### W8

- status: fixed
- evidence: `isBindingName()` excludes declaration names and import/export binding halves, retains shorthand property values and assignment/value references, and `pass-declaration-names.ts` carries the four accepted reproductions without runtime references. The author's old-predicate/new-predicate measurement is consistent with the implementation.

### W10

- status: fixed
- evidence: `helper-fs-factory.ts` now returns `typeof fs.promises.rm`. The in-memory Program reports the inner call-result type symbol as `rm` declared in `promises.d.ts`, so `gap-call-produced.ts` isolates the unvisited `CallExpression` mechanism rather than structural erasure.

### W11

- status: fixed
- evidence: `removeWithNodeFs()` passes the real `node:fs` namespace into the structurally typed parameter. The call remains undetected because `owner.rmSync` resolves to the local declaration in `gap-structural-parameter.ts`, exactly reproducing B17.

### S13

- status: fixed
- evidence: `pass-erased-unrelated.ts` is deleted. The W7 member-name and runtime-index pass fixtures remain.

## Specialist adjudication

- Both specialists independently identified the undeclared-extra half of W12; it remains WARN with the same severity and causal mechanism as round 10.
- The contracts specialist identified the remaining B19 header contradiction. B19 is carried forward rather than assigned a new ID because gate comments were in its original boundary inventory. Severity is downgraded with the stated evidence delta: every authoritative and user-visible contract surface is fixed, leaving one misleading source comment and wrong path.
- No specialist found a new issue outside the verification cone. No audit-backlog or user-granted accepted-risk entry carries forward.

## Triage — author, round 11

| ID | Status | Rationale |
|---|---|---|
| B19 | accepted | Correct on both halves, and it is the same overclaim one layer down: I narrowed the gate's claim and then handed the withdrawn universal proof to the integration tests in the next clause. Finite tests establish delegation on the paths they exercise, which is what canonical D10 says and what the header must say. The path was wrong too — `src/worktree/worktreeMutations.integration.test.ts`, not `src/extension.…`; a citation that resolves to nothing is not evidence a reader can check. |
| W12 | accepted | Correct. I asserted the inventory in one direction only: every declared gap must exist, but an undeclared `gap-*` file was still counted and still green. That is the defect W12 named in round 10, surviving in the other direction — the count can still grow without the inventory being amended. Fix: exact set equality, so an added gap must be declared. |

Cycle 5, round 2 of 3. Zero gating blockers; both warnings fixed rather than carried.
