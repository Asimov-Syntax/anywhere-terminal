# Review Round 2: prove-the-store-is-readable-not-merely-there

**Date**: 2026-08-30
**Cycle**: 2
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: commit `0ed037f0` only
**Head**: `0ed037f0d2e48f852ccf95c5d8e52dd2a68b6274` (working tree dirty outside the reviewed commit)
**Reviewable lines**: 49
**Agents spawned**: `asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`, `asm-review-reuse`; support trace by `asm-finder`
**Agents skipped**: `asm-review-frontend` (no UI code)
**Verdict**: **BLOCK**
**Counts**: 1 BLOCK, 3 WARN, 0 SUGGEST
**Blocker split**: 1 feature / 0 machinery

## Scope and accepted obligations

This is cycle 2 discovery, not verification of cycle 1. The reviewed implementation is the replacement design in commit `0ed037f0` only; neighbouring archive and test-pool commits are out of scope. Gate 2 is marked approved, so the vault-store-status spec, task 1_1, and D1-D4 are accepted obligations. The user additionally identified the one readability pass beside two ordered stat passes as deliberate after two readability passes delayed in-flight joining.

## Risk map

- Store-set proof: `.db` plus any stamped `-wal` must be openable before retained reuse.
- Coherence/readability seam: two ordered path-stat passes establish stamps; a later open pass establishes permission, leaving ordinary check/use races and a design-contract question about whether the two claims must share a file handle.
- File-descriptor ownership: each successful open must be released on every exit, including cleanup failure.
- Pool behavior: `usable=false` disables retained hits, in-flight joins, and retention, then routes to fresh production and existing status mapping.
- Status contract: present unreadable stores must become `db-unreachable`, never `no-db`, on retained and fresh read paths; the write path must still reach `write-error` rather than report absence.
- Test honesty: the retained and fresh branches need distinct pool keys, unsupported permission environments need a real runtime skip, and assertions must pin the discriminated status rather than merely failure.
- Hot-path scale: the file-set axis is structurally capped at two paths; each generation read adds at most two sequential open/close operations. Retained production may read the generation before and after snapshotting, and join retries remain bounded by `MAX_JOIN_WAITS`.

## Full-flow trace

- `readSqlite` and `withSqliteSnapshot` first select an engine, then run the unchanged existence-oriented presence gate. Only proved absence maps to `no-db` there.
- Both enter `SnapshotPool.borrow`. `readStoreGeneration` performs two ordered stat passes, requires equal usable stamps covering the database, then opens and closes each path present in the second stamp set.
- A usable equal generation can lease a retained entry or join an in-flight production. An unusable generation does neither; the pool creates or waits for a fresh snapshot attempt.
- Source-open failures from the Node and CLI snapshot engines are tagged and map to `db-unreachable`; other production/cleanup failures map to `query-error`. A non-retained reader deletes its snapshot after the final lease; a stable retained production performs a second generation read before publication.
- `readStoreGeneration` has no production consumer beyond `SnapshotPool`. `stampStoreFiles` continues to call the shared stat loop directly and does not observe the stronger usability rule.
- The two-store test warms only store `a`; store `b` has a distinct path and therefore genuinely takes the fresh path. Vitest 4's `ctx.skip()` marks the test skipped and throws to stop execution, so the unsupported-permission branch is not recorded as a pass.

## Cross-round disposition

- Cycle 1 B1 is fixed in the reviewed behavior: the proof now uses `open("r")` over the stamped `.db`/`-wal` set rather than `fs.access(R_OK)` on the base file.
- Cycle 1 W1 is fixed: the presence/write dependency remains existence-only, so an unreadable existing store is not collapsed to `no-db` before the write engine.
- Cycle 1 W2 is fixed in structure: the comparison uses two distinct store keys and the unsupported runner branch uses Vitest's dynamic skip.

## Findings

### B1

- **ID**: B1-R2
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-contracts`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/vault/storeStamp.ts:129-140`
- **Title**: The implementation materially diverges from the Gate-2-approved generation proof
- **Evidence**: Approved D1 says readability replaces the path stat with `open("r")` plus stat-through-the-handle, so each stamp describes the file actually opened. Approved D3 consequently records two ordered passes as four opens, four fstats, and four closes. The reviewed implementation leaves both `readOnce` passes on path-based `fs.stat`, then performs a separate third pass with one open/close per stamped path; `OpenFn` cannot fstat at all. The changed workflow note says this separate pass is deliberate and that “D1 records it,” but D1/D3 still record the superseded mechanism and cost.
- **Impact**: The code may embody a reasonable post-test tradeoff, but it is not the design approved at Gate 2. The authoritative mechanism, coherence claim, and hot-path cost are contradictory; a later builder or verifier following D1/D3 would reintroduce the two-pass open design that already broke in-flight deduplication. Under the workflow's intent-reconstruction gate, this material design delta cannot be approved as an implementation detail.
- **SuggestedFix**: Hand the change back to planning: update D1/D3 and the failure-surface inventory to explicitly own the one readability pass beside two stat passes, record the remaining check/use boundary and corrected cost, then renew Gate 2. Alternatively, implement the currently approved stat-through-handle design if its latency problem is resolved.
- **Status**: accepted
- **Triage**: Accepted, and not remediation. The one-readability-pass-beside-two-stat-passes shape is what shipped and what the latency evidence supports; the defect was that D1/D3 still described the superseded stat-through-handle design. Parked the lease, handed back to planning, rewrote D1/D3 and the failure-surface inventory to own the check/use boundary and the corrected cost (`46d0ca2f`), untick-ed Gate 2 and task 1_1, and re-earned Gate 2. Not implementing the approved-but-superseded design: the reviewer's own round-1 evidence is that stat-through-handle adds enough latency to the pooled path that a second borrower misses the in-flight join window.

### W1

- **ID**: W1-R2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `asm-review-data-security` and `asm-review-logic`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/vault/storeStamp.ts:84-95`
- **Title**: A rejected close escapes the readability verdict and leaves release unconfirmed
- **Evidence**: `allReadable` converts every `open()` rejection into `false`, but `await handle?.close()` runs in `finally` without handling rejection. `OpenFn` explicitly allows a rejecting `Promise<void>`, so this deterministically rejects `readStoreGeneration` instead of returning an unusable generation. `SnapshotPool.borrow` then aborts before the fresh snapshot path, and `withPooledSnapshot` maps the untagged cleanup error to `query-error`. The current handle-count test covers successful closes and an open refusal, not a rejecting close.
- **Impact**: Cleanup failure takes a different control path from the declared readability gate, and the descriptor's release is not established despite task 1_1's every-exit ownership requirement. Repeated failures could leave resource ownership uncertain and surface an internal `query-error` rather than a deliberate generation verdict.
- **SuggestedFix**: Define and test an explicit close-failure policy. Ensure reuse remains disabled, do not let an untagged cleanup rejection masquerade as an ordinary query failure, and only retry `close()` if the supported Node/runtime contract makes that safe; add an injected rejecting-close case.
- **Status**: accepted
- **Triage**: Accepted. `handle.close()` rejecting escaped the readability verdict and surfaced as `query-error` through `withPooledSnapshot`. Split `allReadable` so open and close are each caught and each return `false` — a descriptor whose release could not be confirmed is not a store we will claim is readable, and reuse stays disabled. No retry: the Node contract does not make a second `close()` on a rejected handle safe. Test added: `"refuses a generation whose handle could not be closed"`; mutation removing the close guard fails exactly that test.

### W2

- **ID**: W2-R2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/vault/sqlite.test.ts:923-927`
- **Title**: The end-to-end regression proves agreement but not the required unreachable status
- **Evidence**: The test correctly separates retained store `a` from fresh store `b`, but asserts only `reused.status === fresh.status` and `reused.status !== "ok"`. It would remain green if both paths regressed to `query-error`, even though task 1_1 and the spec require `db-unreachable` and explicitly distinguish it from other failures.
- **Impact**: The central discriminated-status obligation can regress while the new end-to-end test still passes; the test proves convergence, not the promised answer.
- **SuggestedFix**: Assert `db-unreachable` for both the reused and fresh results, retaining the distinct-store and dynamic-skip setup.
- **Status**: accepted
- **Triage**: Accepted. Convergence is a weaker claim than the promised one. Both assertions now name the discriminated status directly (`expect(reused.status).toBe("db-unreachable")` and the same for `fresh`), with a comment recording why equality alone was insufficient. The distinct-store and dynamic-skip setup is unchanged.

### W3

- **ID**: W3-R2
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P3
- **Agent**: `asm-review-contracts`, corroborated by `chair`
- **Class**: feature
- **File:line**: `asimov/changes/prove-the-store-is-readable-not-merely-there/tasks.md:13`
- **Title**: The accepted write-path regression case is still absent
- **Evidence**: Task 1_1 is checked complete and its Plan step 4 requires an assertion that writing an existing unreadable store returns `write-error`, not `no-db`. Commit `0ed037f0` changes no write-path test; `src/vault/sqlite.write.test.ts` contains only generic injected status mapping and readable real-engine cases. The new `src/vault/sqlite.test.ts` case exercises read snapshots only.
- **Impact**: The exact cycle-1 W1 regression remains unpinned at its write boundary, so a future strengthening of the shared existence predicate could again misreport an existing store as absent without failing this task's verification suite.
- **SuggestedFix**: Add the required existing-but-unreadable write case against the production dependency behavior, with an honest runtime skip where permission revocation cannot be enforced, and assert `write-error` rather than `no-db`.
- **Status**: accepted
- **Triage**: Accepted — task 1_1's Plan step 4 promised this case and commit `0ed037f0` did not carry it. Added `describe("the write path tells absence from unreadability")` in `src/vault/sqlite.test.ts`, driving `writeSqlite` against the default deps over a real chmod-0o000 store, asserting `write-error` and explicitly `not.toBe("no-db")`, with `ctx.skip()` when the mode does not bite (root, or a filesystem that ignores it). Mutation restoring `R_OK` to the shared existence predicate fails exactly this case.

## Invariant inventory

- **An `ok` retained read requires the stamped live source set to be openable**: searched base file, present WAL, WAL absent/appearing/disappearing, permission changes between/after passes, retained hit, in-flight join, production, and post-production retention. The reviewed gate covers the base file and every WAL present in the agreed stamp set. A stamped path disappearing before open becomes unusable, which is correct because that generation no longer describes a current store. WAL appearance or permission changes after their sampling remain ordinary post-proof races; callers can only re-ask or take a fresh snapshot, and no changed caller performs a harmful side effect from `usable`.
- **Every successful open has explicit release ownership**: searched open rejection, successful close, later-path refusal, repeated calls, and close rejection. Successful paths and open failures are safe; close rejection is affected by W1.
- **Only proved absence becomes `no-db`**: searched both read entry points, snapshot failure mapping, and the shared write dependency. Production presence remains existence-only and fresh source refusals map to `db-unreachable`; the read assertion is under-specified by W2 and the write regression boundary is untested by W3.
- **The fresh comparison is actually fresh and unsupported environments do not pass vacuously**: distinct pool keys and Vitest's throwing dynamic skip verify both boundaries safe.
- **Bounded hot-path work**: store files are structurally capped at two, retained keys remain bounded to primary stores, join retries are bounded, and unusable generations do not accumulate retained entries or undeleted snapshots. No performance finding.

## Inline support review

No `.only` or static `.skip` was added, async filesystem operations are awaited, and cleanup restores permissions in `finally`. Vitest 4's dynamic `ctx.skip()` marks the case skipped and aborts the body. The new two-store setup genuinely separates retained from fresh pool keys. The read test does not assert the required exact status, and the task-required write regression is absent. The new stamp-helper test itself uses readable files, but the pre-existing permission-denial test already covers stat-only omission, so no separate finding survives.

## Recorded verification evidence

`bun run asm change verify-status prove-the-store-is-readable-not-merely-there` reports task 1_1 exit 0 with unchanged production scope and additive assertions. The caller reports type check, 5,546 unit tests, I10, both esbuild bundles, and `biome check src` at 0 errors / 14 warnings, plus two killed mutations (readability removed from `usable`; handle release removed). Per review policy, no project verify command or test suite was rerun.

## Specialist results

- `asm-review-data-security` — store-set permission proof and cleanup — `gpt-5.6-sol[1M]` — W1.
- `asm-review-logic` — generation races, error paths, pool state, and test control flow — `gpt-5.6-terra[1M]` — W1; confirmed distinct-store and dynamic-skip behavior.
- `asm-review-contracts` — accepted design/status/task obligations — `sonnet[1M]` — B1 and W3.
- `asm-review-performance` — bounded hot-path open cost and in-flight behavior — `gpt-5.6-luna[1M]` — no findings.
- `asm-review-reuse` — helper duplication and shared-loop cohesion — `gpt-5.6-luna[1M]` — no findings.
- `asm-finder` — callers and full vault hot/cold/status flow — support trace only.
