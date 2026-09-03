# Review Round 4 — run-the-setup-the-user-saw

- Date: 2026-09-02
- Cycle: 2
- Round: 4
- Mode: superseded
- Scope: range `d0689ffc..HEAD`
- Head: `7e6af6dd4e7c71230d4c89975ff7b7b6d1da75fc`
- Reviewable lines: 97 production lines in the remediation range
- User extension grant: recorded in `build-state.json` before this chair started
- Agents spawned: none — verification scope lock tripped before Phase 2
- Agents skipped: all specialists
- Verdict: **REJECT**
- Status: **blocked**
- Counts: 4 prior accepted BLOCK findings not adjudicated · 2 prior accepted WARN findings not adjudicated · 0 new findings
- Review session identity: `ea8b01d7-0032-4405-a0ae-82791e72b715`

## Scope-lock disposition

Round 4 cannot proceed as verification. Since round 3's recorded Head `d0689ffc6ea395a16143aa91d3fb4764073cd8d2`, `tasks.md` adds task 6_1 with new Refs, an Acceptance outcome, a verification command, and a five-step implementation plan covering F001, F006, and F011–F014.

That is a new semantic task contract, not task-completion metadata. Under the verification scope lock, a new or semantically changed task supersedes the cycle even when it was introduced specifically to remediate the prior round. The recorded user extension grant authorizes opening round 4; it does not waive the scope lock or turn a newly planned task into verification metadata.

The implementation, adversarial witnesses, impact manifest, and recorded verification evidence were therefore not used to resolve any round-3 finding. No specialist was spawned and no current-code finding was adjudicated.

Round 3 remains the source of truth:

- F001 — Prototype-sensitive port names lose their authoritative environment value — BLOCK, accepted
- F006 — Immediate exit during kill can override timeout or close cancellation — BLOCK, accepted
- F011 — Oversized PTY events retain their full backing allocation — BLOCK, accepted
- F012 — Closing a replay terminal prevents subsequent output recreation — BLOCK, accepted
- F013 — Live flush limit measures UTF-16 units instead of bytes — WARN, accepted
- F014 — Reveal-time authority retirement leaves a stale View output action — WARN, accepted

## Scope-lock signal

`asimov/changes/run-the-setup-the-user-saw/tasks.md` adds:

- task `6_1 Close final arbitration findings`
- new `Refs` to D2–D4 and round-3 findings
- a new adversarial-boundary Acceptance outcome
- a new focused verification contract
- implementation obligations for null-prototype maps, settle-before-kill ordering, copied retained buffers, byte-bounded UTF-8 batching, replay recreation, output-retirement reporting, and assembly-wait stabilization

These obligations are exactly the newly planned invariant work that a discovery review must evaluate together with its implementation.

## Route

The next review starts **Cycle 3 in discovery mode**, with global round numbering continuing after round 4. It must review task 6_1's approved contract, the cumulative implementation, and rounds 1–4 together rather than treating the delta as verification against round 3's older gate set.

The current extension grant was bounded to round 4. Starting any further round requires whatever additional user grant the repository's review command requires; neither the coordinator nor this chair can supply that consent.

## Re-review identity

- Chair review session: `ea8b01d7-0032-4405-a0ae-82791e72b715`
- Round-3 source of truth: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-2/asimov/changes/run-the-setup-the-user-saw/.reviews/round-3.md`
- Round-4 scope-lock record: this file
- Proposed next discovery baseline: Head `7e6af6dd4e7c71230d4c89975ff7b7b6d1da75fc`
