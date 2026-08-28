# Review Round 10

- Date: 2026-08-28
- Cycle: 5
- Mode: discovery
- Scope: commit `b725de9c0c0650d97f88e8fc4253fd7d2e5044c0` (the clean current tree's new tripwire mechanism since round 9), using the `verify-cross-layer-scale` change context
- Head: `b725de9c0c0650d97f88e8fc4253fd7d2e5044c0` (clean working tree at review start)
- Reviewable lines: 764 (plus 24 changed test/fixture lines; 306 skipped Markdown lines)
- Verification evidence: caller reports check-types clean; 234 files / 4,733 tests passing; `pnpm run gate:fs-deletion` exit 0 in 1.35 s over 29 scoped modules; scale bench passing at 0.1 ms presence / 26.9 ms model; lint equal to the clean-main baseline; `verify-status` exit 0. Project verification commands were not rerun. Targeted probes used an in-memory TypeScript CompilerHost and wrote no repository files.
- Agents spawned: `asm-review-contracts` (narrowed D10 honesty, `gpt-5.6-sol[1M]`); `asm-review-logic` (gap fixture truth, `gpt-5.6-terra[1M]`); `asm-review-logic` (tripwire regression inventory, `sonnet[1M]`)
- Agents skipped: data-security, frontend, performance, reuse — no persistence/auth/input boundary, UI, production hot path, or new duplicate capability is in the commit
- Verdict: BLOCK
- Counts: BLOCK 1, WARN 4, SUGGEST 1

## Risk map

- Claim honesty: D10, WT-007.1 Acceptance, task 11_1, the gate's comments, and its success/error output must describe a limited tripwire rather than the withdrawn soundness claim.
- Behavioral evidence flow: WorktreeHost action → mutation service → `removeWorktree` → Git runner → real-git nested/already-missing integration cases. This proves exercised delegation behavior, not universal absence of direct filesystem deletion.
- Executable-reference classification: the narrowed scanner must reject only actual value references, not declaration names or type-only syntax.
- Gap truth: call-produced, structural-parameter, any-cast, and erased-alias fixtures must each carry a destructive fs value through the named mechanism and pass for that reason alone.
- Fixture inventory: flag/pass/gap classification must be non-vacuous and counts must describe the asserted fixture directory.
- Regression inventory: deletion of erased provenance must not silently lose a formerly caught class without a named gap; pass fixtures should remain falsifiable against the smaller mechanism.

## Full-flow trace

1. The shipped removal flow begins at `WorktreeHost`, delegates to the mutation service, and reaches `worktreeMutations.removeWorktree`, which invokes `git worktree remove`. The tagged host test proves the action handoff; the real-git integration tests prove the low-level Git behavior for nested and already-missing directories.
2. `pnpm run gate:fs-deletion` separately builds a real TypeScript Program and scans only the enumerated production paths for identifier/member nodes whose executable-position type retains a destructive `@types/node/fs` symbol.
3. Production hits fail. Every existing `flag-` fixture must hit; every existing `pass-` and `gap-` fixture must not hit. An unprefixed helper is scanned but deliberately not adjudicated.
4. The current gate does not inspect value flow and deliberately misses the four named categories. The contract therefore depends on honest wording and on each gap fixture isolating the category it names.
5. Failures occur at the evidence boundary: the design still states universal/obsolete SHALL requirements, two gaps pass for confounded or absent provenance, declaration names remain reportable, and gap existence is not anchored to the four accepted cases.

## Open findings

### B19

- ID: B19
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair + `asm-review-contracts`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/asimov/changes/verify-cross-layer-scale/design.md:205`
- title: D10 still claims the universal rule that task 11_1 withdrew
- evidence: The new revision at lines 192-223 says soundness is withdrawn and the checker is only a limited tripwire, but the same approved D10 still has the normative title “I10 is closed by a source rule,” says no scoped module SHALL acquire or call a destructive operation at lines 125-128, requires complete reference-type resolution and fail-closed erased handling at lines 145-190, and then says the original universal I10 is “closed” at line 205 despite explicitly asserted direct-deletion gaps at lines 219-223. The implementation intentionally violates those earlier SHALLs. `fsDeletionGate.ts:11-13` repeats the defeated claim that all value uses are identifiers/member selections and the checker handles any binding syntax. Its success line at `fsDeletionGate.ts:192` says all scoped modules “delegate removal to git,” although this command only proves that none contains a reference the narrow predicate recognizes. The WT-007.1 PLAN acceptance and task 11_1 Boundary are narrower and honest, so the sources of truth contradict each other rather than jointly narrowing the claim. Boundary inventory searched: D10 heading, original SHALLs, round-5/7 revisions, round-9 revision, canonical I10 statement/status, PLAN Acceptance, task Boundary, gate header/comments, error/success output, host and real-git tagged evidence. Affected: D10 and gate-facing claims. Verified safe: WT-007.1 Acceptance and task 11_1's explicit no-provenance boundary.
- impact: This change's product is verification truthfulness, but its accepted design and command output still certify a universal property that the implementation and fixtures explicitly demonstrate can be violated while green. Contributors cannot tell which SHALL governs, and the registry remains `covered` for evidence that the latest revision admits is incomplete.
- suggestedFix: Replace, rather than append to, D10: remove or strike the superseded title and normative paragraphs; state one current contract containing the exercised integration behavior, exact tripwire predicate/scope, and non-deciding conditions. Narrow the canonical I10 statement/status or explicitly define the evidence standard that permits a covered-but-incomplete tripwire. Update the gate header and success/error text to report only recognized references, not delegation or universal direct-deletion absence.
- status: open — new in cycle 5 discovery; the round-9 design handback narrowed the mechanism but did not remove the superseded claims
- triage: pending author triage

### W8

- ID: W8
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-contracts` + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:71`
- title: Declaration names are still reported as executable references
- evidence: `isTypePosition()` excludes only nodes with a type-node ancestor. A declaration identifier is a sibling of its annotation, so it remains eligible. An in-memory Program probe produced findings for `declare const ambient: typeof fs.promises.rm`, an unused parameter typed `typeof fs.promises.rm`, an interface property signature, and a type-alias declaration name, even though none is an executable value reference. Current flag probes also show declaration/binding identifiers are still counted alongside their executable calls. The author's partial rebuttal is accepted only as evidence that all current flag files also contain executable hits; it did not exclude declaration names and therefore does not fix W8's false-positive boundary.
- impact: Declaration-only source in the mandatory production scope can fail the tripwire, contradicting D10's narrowed “executable positions” contract and task 11_1 plan item 2.
- suggestedFix: Positively classify executable value-reference positions. Exclude declaration/binding names, ambient declarations, parameter/property signatures, and type-only import/export nodes; add direct pass fixtures for the round-9 ambient and annotated-parameter reproductions.
- status: open — persists from round 9; type descendants are fixed, declaration-name evidence remains
- triage: accepted in round 9; current persistence pending author triage

### W10

- ID: W10
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fixtures/fsDeletion/helper-fs-factory.ts:7`
- title: The call-produced fixture also erases the symbol structurally
- evidence: `getRm()` is explicitly annotated as returning a local structural function type. The checker therefore gives the inner `CallExpression` in `gap-call-produced.ts` symbol `__type`, declared by the helper's `FunctionType`, rather than the `node:fs/promises.rm` symbol. The fixture remains green both because `CallExpression` is unscanned and because B17-style structural typing has already erased the symbol. An in-memory Program probe confirmed the returned type and declaration source.
- impact: If the tripwire later learns to inspect call-result expressions, this gap can remain green for the unrelated structural-erasure reason and falsely claim B16 is still open.
- suggestedFix: Return `typeof fs.promises.rm` or infer that exact return type in the unasserted helper. Keep the producer outside the enforced/asserted scope so the only reason the gap passes is the unscanned call-result expression.
- status: open — new in cycle 5 discovery; round-9 B16's gap is asserted for the wrong combined mechanism
- triage: pending author triage

### W11

- ID: W11
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair + `asm-review-contracts` + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fixtures/fsDeletion/gap-structural-parameter.ts:5`
- title: The structural gap never carries a node:fs value
- evidence: The fixture declares a parameter with a local `rmSync` shape and invokes it, but it neither imports `node:fs` nor passes an fs object into the parameter. Its no-finding result is equally explained by an unrelated object implementing the same method. D10's B17 rationale specifically depends on a real fs value crossing a structural boundary.
- impact: The fixture does not establish the structural-origin blind spot used to justify withdrawing soundness and can stay green without representing direct filesystem deletion at all.
- suggestedFix: Include an actual `node:fs` object crossing into the structurally typed parameter and reaching `owner.rmSync`, while retaining the local structural declaration that erases the originating symbol.
- status: open — new in cycle 5 discovery; round-9 B17's gap is not reproduced
- triage: pending author triage

### W12

- ID: W12
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: chair + `asm-review-contracts` + `asm-review-logic`
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fsDeletionGate.ts:186`
- title: The four contractual gaps are not anchored as an inventory
- evidence: The gate checks only gap-prefixed files that happen to exist. Removing one or all four does not enter the vacuity condition, and no expected filename/condition set is compared with the classified fixtures. `closedCount` additionally counts every Program source whose basename starts with `gap-`, even outside `FIXTURES`, and prints that number as “stated gaps still open.”
- impact: WT-007.1 says the non-deciding conditions themselves are asserted, but a contractual gap can disappear without gate failure and an unrelated source file can inflate the reported count.
- suggestedFix: Define and compare the four expected gap fixture paths or condition identifiers, fail on a missing or extra contractual gap until its design classification is updated, and derive the success count from the fixture-directory cases actually scanned.
- status: open — new in cycle 5 discovery
- triage: pending author triage

### S13

- ID: S13
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/verify-cross-layer-scale/src/test/invariants/fixtures/fsDeletion/pass-erased-unrelated.ts:1`
- title: The non-destructive erased pass fixture no longer falsifies the tripwire
- evidence: The fixture selects `writeSummary` from `any`. The narrowed predicate only recognizes destructive symbols whose declarations come from `@types/node/fs`; this case cannot collide by name and the erased/provenance branch its comment describes was deleted. `pass-unrelated-any-member.ts` and `pass-unrelated-any-index.ts` remain meaningful because they guard the exact W7 risk of a future name-based or broad erased-owner fallback.
- impact: The fixture and its fail-closed comment imply coverage of a mechanism that no longer exists, adding noise to an evidence directory whose filenames are contracts.
- suggestedFix: Delete this redundant case or replace it with a pass case that can actually collide with the narrowed predicate without being node:fs-derived.
- status: open — new in cycle 5 discovery
- triage: pending author triage

## Prior finding adjudication

- B16 and B17 are no longer gating as claims the implementation promises to close; the accepted design response is to expose them as limits. W10 and W11 show that the new gap evidence does not yet isolate those limits correctly.
- B18's erased-provenance soundness claim is withdrawn; any-cast and erased-alias are now explicit gaps. No new provenance walker exists to verify.
- W8 persists through declaration names even though type-descendant scanning was fixed. The round-9 rebuttal establishes that the current flag files also have executable hits, not that declaration-name false positives are gone.
- W9 and S10 are fixed by deletion of the provenance walk and shared `seen` state.
- No audit-backlog or user-granted accepted-risk entries carry forward.

## Specialist adjudication

- The contracts specialist's two honesty findings are merged into B19 and raised from WARN to BLOCK. The entire accepted outcome is that the tripwire claims only what it enforces; contradictory SHALLs, a still-universal closure statement, and overclaiming command output violate that hard acceptance rather than merely documenting poorly.
- The gap-fixture specialist graded W10 and W11 as BLOCK. They are reduced to WARN under the support-review rule: the defects invalidate fixture evidence but do not alter production behavior. They still gate approval through warnings after B19 is fixed.
- W8 and W12 are accepted with specialist corroboration.
- The regression-inventory logic specialist reported no checklist-applicable runtime/complexity finding. Chair review found no distinct formerly-caught destructive class beyond the four broad gap categories; dynamic erased keys and multi-hop erased values fall under the stated any-cast/erased-alias limits.
- `pass-unrelated-any-member.ts` and `pass-unrelated-any-index.ts` remain useful guards against reviving W7. Only `pass-erased-unrelated.ts` is no longer falsifiable against the narrowed mechanism.

## Triage — author, round 10

| ID | Status | Rationale |
|---|---|---|
| B19 | accepted | Correct, and it names the actual defect: round 9's conclusion was appended as a fifth revision rather than replacing the four superseded ones, so D10 still carries the withdrawn universal SHALLs as normative text. The gate's header comment repeats the defeated "the set of reference forms is closed" premise, and its success line reports delegation — a positive property — from the absence of a recognized reference. A change whose only product is verification truthfulness cannot ship a design section that certifies what its own `gap-` fixtures assert is violable. Fix: replace D10 with one canonical contract, and reword the gate header and success/failure output to state only what was searched for and found. |
| W8 | accepted | Reproduced. The round-9 rebuttal showed only that every `flag-` fixture also contains an executable hit; it never denied that declaration names are eligible. `isTypePosition` excludes descendants of type nodes, but a declaration's name identifier is a *sibling* of its annotation, so `declare const ambient: typeof fs.promises.rm` is reported. That is a false positive in the production scope, the direction D10 says the rule must not be wrong in. Fix: skip an identifier that is the `name` of its parent declaration, and the binding halves of import/export specifiers. |
| W10 | accepted | Correct and material. `getRm()` is annotated with an anonymous structural function type, so its result symbol is `__type` — the fixture is defeated by B17 structural erasure before the unscanned `CallExpression` ever matters, and therefore proves nothing about the call-produced limit it is named for. Fix: annotate the helper `typeof fs.promises.rm` so the value's provenance survives and the fixture isolates exactly one cause. |
| W11 | accepted | Correct. The fixture declares a structurally-shaped parameter but no caller ever passes a `node:fs` value through it, so it demonstrates an ordinary local interface rather than laundering. Fix: add a caller that passes the real `fs` namespace into that parameter, which is the B17 claim. |
| W12 | accepted | Correct on both halves, and this is the same class of defect as the "reachable from the removal path" overclaim: a stated limit nothing checks. A deleted `gap-` fixture currently reduces the reported count in silence, and the count is taken over every Program file whose basename starts with `gap-`, not over classified fixtures. Fix: assert the expected gap inventory by name and count only files under the fixture directory. |
| S13 | accepted | Correct. Its comment describes the erased-provenance mechanism deleted in task 11_1; against the narrowed predicate an `any` member is unreachable by construction rather than excluded by a decision, so the case can no longer fail. The W7 member and index guards remain. Fix: delete it. |

Cycle 5, round 1 of 3. No thrash stop: the round cap restarted with this cycle's discovery round.
