# Review round 1 — anchor-a-locked-write-to-the-directory-it-checked

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Head: `dad131efed7002518126219dbab190124bdb5051` (explicit range `5af4d3fd..HEAD`; working tree dirty only in `asimov/changes/anchor-a-locked-write-to-the-directory-it-checked/analytics.json` and `docs/PLAN.md`, outside the reviewed committed range)
- Reviewable lines: 137
- Large change: no
- Verify evidence: `bun run asm change verify-status anchor-a-locked-write-to-the-directory-it-checked` records tasks 1_1 and 1_2 exit 0. The chair ran no project verify command; one isolated scratch probe reproduced `{ ok: true, wrote: false, lockLeaked }` and deleted its temporary directory in the same command.
- Verdict: **BLOCK**
- Counts: 1 BLOCK · 1 WARN · 0 SUGGEST
- Split over gating blockers: 1 feature · 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | filesystem identity, symlink refusal, path reporting | storage and security | `gpt-5.6-sol[1M]` |
| asm-review-logic | native write result and host publication | state, errors, async outcomes | `gpt-5.6-terra[1M]` |
| asm-review-contracts | helper API and result vocabulary | contracts and accepted scenarios | `sonnet[1M]` |
| asm-review-logic | bigint identity and no-follow edge cases | platform and race logic | `gpt-5.6-luna[1M]` |
| asm-review-reuse | identity comparison and installer pattern | reuse and drift | `gpt-5.6-luna[1M]` |
| chair | full range | all applicable lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped specialist lenses: frontend (no React/rendering change) and performance (single-file operations are structurally bounded; the added cost is one `lstat` per opted-in read).

---

## Findings

### [F001] Lock-release state is not orthogonal to the write outcome

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair; corroborated by asm-review-logic, asm-review-contracts, and asm-review-reuse
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:543`
- Status: accepted
- Triage: Preserve release failure independently across every acquired-lock outcome, then let the host compose truthful messages for committed, no-op, and refused writes. Add witnesses for no-op-plus-leak and refusal-plus-leak.

**Evidence.** `LockedFile.withLock` invokes `onLockReleaseFailed` after every acquired-lock work outcome (`lockedJsonFile.ts:79-88`). The writer then retains the captured path only when `written.ok` is true. Consequently, a malformed/unnamed/unwritable/outside result or a thrown work callback can leave a live lock while line 543 discards its exact path. The opposite edge is also wrong: the no-edit branch returns `{ ok: true, wrote: false }` at lines 462-463, line 543 attaches `lockLeaked`, and `WorktreeHost.ts:188-197,2519-2524` tells the user the file “was saved.” An isolated real-filesystem probe reproduced `{ "ok": true, "wrote": false, "lockLeaked": "...lock" }` by forcing only lock unlink to fail.

**Impact.** On refusal/error paths, the primary defect this change is meant to close remains: a live lock can block every later save while the only actionable path is hidden. On a no-op path, the user is warned but is falsely told bytes landed. The result union's documented invariant that `lockLeaked` means “the write LANDED” is therefore not representable across all reachable outcomes.

**Suggested fix.** Model lock-release failure independently of `ok` and `wrote` (for example, on every result variant or in an outer operation result). Preserve both the original refusal and the exact lock path, and branch host wording on whether bytes actually landed. Do not merely gate on `written.wrote`, because that would restore silence for no-op/refused operations whose leaked lock still wedges later saves.

**Invariant inventory.** Searched lock acquisition failure, committed create/replace, successful no-op, explicit refusal, thrown work, release success, and release failure. Affected: successful no-op and every post-acquisition refusal/thrown path. Verified safe: committed writes with release failure are reported; acquisition failure owns no lock; all release-success paths add no leak metadata.

### [F002] The approved “lock is gone” scenario requires the opposite of the implementation

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: feature
- File: `src/agentHooks/install/lockedJsonFile.ts:265`
- Status: accepted
- Triage: Resolve the accepted contract before remediation: replace the scenario with an actually unreleasable lock case, or explicitly change the release invariant if reporting an already-removed lock is truly intended.

**Evidence.** The approved delta spec says that when another actor removes this save's lock before release, the save reports that it may stay locked (`specs/worktree-panel/spec.md:17-21`). The implementation intentionally returns release success when the pathname is absent and the opened lock handle has `nlink === 0n` (`lockedJsonFile.ts:263-268`), so the callback cannot fire. A targeted real-filesystem probe confirmed that unlinking the only pathname makes `lstat` return `ENOENT` and the held handle report `nlink: 0n`.

**Impact.** Gate-2 artifacts and executable behavior disagree on a named acceptance scenario. Implementing the scenario literally would also produce a warning for a lock pathname that is already free, while retaining the current code leaves the approved scenario unfulfilled. Verification cannot establish both claims until the contract is corrected.

**Suggested fix.** Amend the scenario to the intended witness—such as unlink failing with `EPERM` or the pathname being substituted with a different lock—or record a deliberate change to the release semantics and add its corresponding test.

---

## Verification question outcomes

- Production `stat({ bigint: true })` / `lstat(..., { bigint: true })` values keep `dev`, `ino`, and `nlink` as bigints; the reviewed `BigInt()` coercions neither throw nor collapse different captured production identities. Unsafe injected numbers cannot restore precision already lost, but every production identity entering these comparisons is now captured as bigint.
- `owned.nlink === 0n` matches the `BigIntStats` overload and the real removed-open-file behavior observed by the targeted probe.
- The third `openRegularFile` argument is optional and off by default; `provisioningDeps.readBounded` still calls it with no options and continues following provider-file symlinks.
- No changed code silently claims directory-substitution safety; the changed comments keep that boundary explicit.

---

## Author triage (round 1)

**[F001] Status: accepted** — Triage: correct on both halves, and they are different in kind.
The `{ ok: true, wrote: false }` half is a plain defect against the approved spec: the host says the
file "was saved" when no bytes landed. The refusal half is NOT a spec violation — it is a spec GAP:
the approved requirement is scoped `WHERE a save completes its write`, so a refusal that strands a
lock was never covered. Widening it changes the requirement and D4's "add one outcome" mechanism,
which is a changed `D#` — so this is a handback under the remediation boundary, not a fix commit.

**[F002] Status: accepted** — Triage: the scenario I wrote is wrong, and the implementation is right.
`ENOENT` with `nlink === 0n` means the lock this holder held was already unlinked — the pathname is
free and there is nothing for the user to remove, so reporting it would send them after a file that
does not exist. The scenario demanded exactly that. It is replaced with a case that is genuinely
unreleasable rather than merely already-released.

Both findings land on artifacts approved at Gate 2, so the cycle closes as `superseded` and the
change goes back to planning before any fix edit.
