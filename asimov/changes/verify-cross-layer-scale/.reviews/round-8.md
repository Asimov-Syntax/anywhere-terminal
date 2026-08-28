# Review Round 8

- Date: 2026-08-28
- Cycle: 3
- Mode: superseded
- Scope: requested verification range `a66a635c2990ab1372c2b33ed7cf41a8444e0331..e9504e391e0ab8dcd51255241ffcbbb499b519de`
- Head: `e9504e391e0ab8dcd51255241ffcbbb499b519de` (working tree also contains dirty Asimov analytics files outside the requested range)
- Scope lock: failed — `asimov/changes/verify-cross-layer-scale/design.md` D10 was semantically rewritten from acquisition/binding-form enumeration to a reference-type rule with erased-value provenance, after a thrash-stop handback through planning and a reopened/re-earned Gate 2
- Reviewable lines: not computed beyond scope-lock classification; the requested range contains a new gate mechanism, new accepted task 10_1, fixtures, and review/build metadata
- Agents spawned: none — specialist verification is prohibited after the scope lock trips
- Agents skipped: all — cycle 3 is superseded before Phase 2
- Verdict: SUPERSEDED — no code verdict issued
- Counts: BLOCK 0, WARN 0, SUGGEST 0

## Supersession

Round 7's B15/W7 remediation changed the accepted D10 mechanism rather than remaining inside the frozen cycle-3 verification cone. The signal is explicit in both artifacts and code intent:

- D10 now asks whether a reference expression's type resolves to a destructive `node:fs` function, instead of rejecting acquisition/binding forms.
- Erased values now use expression-chain and one-hop variable-initializer provenance, a new contract replacing round 7's owner-type/name policy.
- Task 10_1 was created after Gate 2 was reopened and re-earned to implement that redesigned mechanism.

Under the review scope lock, this is non-remediation contract/mechanism movement for the active cycle. Cycle 3 therefore ends as superseded; this round does not verify B15/W7 and makes no claim about commit `e9504e39`.

## Route

The design delta has already re-entered planning and re-earned Gate 2. The next user-initiated review starts **cycle 4, round 9, discovery mode**, with a fresh risk map and full-flow review of the reference-type/provenance mechanism. Prior audit-backlog entries would carry forward; none exist for this change.
