# Review Round 3: prove-the-store-is-readable-not-merely-there

**Date**: 2026-08-31
**Cycle**: 3
**Mode**: discovery
**Scope**: exact commits `46d0ca2f` and `d1e1c303` only, reviewed independently — not `0ed037f0..d1e1c303`
**Head**: `d1e1c303f62e11ffa3de7bc003bebbd3d9c1e6bc` (working tree dirty outside the reviewed commits)
**Reviewable lines**: 145
**Agents spawned**: `asm-review-data-security`, `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`; support trace by `asm-finder`
**Agents skipped**: `asm-review-frontend` (no UI code), `asm-review-reuse` (no new helper, duplicated capability, or cohesion split)
**Verdict**: **APPROVE**
**Counts**: 0 BLOCK, 0 WARN, 0 SUGGEST
**Blocker split**: 0 feature / 0 machinery

## Scope and accepted obligations

This is a new cycle's discovery round. Cycle 1 was superseded when its blocker required a new design decision; cycle 2 round 2 accepted the design mismatch as a handback plus three warnings. Gate 2 is now approved again, so current D1-D4, task 1_1, and the vault-store-status specification are accepted obligations.

The review scope is exactly the patch from commit `46d0ca2f` plus the patch from commit `d1e1c303`. Commit `1b94dbd3` between `0ed037f0` and `46d0ca2f` belongs to another change and was not reviewed. The changed analytics JSON was classified as reviewable metadata and inspected; changed tests were reviewed inline; ordinary change Markdown and prior review records were context/skipped by file classification except where they establish accepted obligations.

Applicable obligations:

- D1: `readStoreGeneration` owns readability of the stamped `.db`/`-wal` set through one open-and-close pass after the two ordered stat passes.
- D2: the shared presence predicate remains existence-only, preserving `no-db` as proved absence on reads and writes.
- D3: the retained-path cost is explicitly accepted and structurally capped at two opens and two closes per generation read.
- D4: `stampStoreFiles` remains stat-only; its omission semantics are not strengthened.
- Task/spec: a present unreadable store reports `db-unreachable` on fresh and retained reads, never `no-db`; an existing unreadable write reaches `write-error`; every successful open has an explicit close attempt.

## Risk map

- **Readability verdict and descriptor ownership**: a rejected `close()` must not escape as an untagged error or permit reuse.
- **Retained and in-flight pool paths**: `usable=false` must disable a retained hit and same-generation join, then allow fresh production to determine the status.
- **Status discrimination**: read failures must remain `db-unreachable`; write existence must remain distinct from unreadability.
- **Test causality**: reused and fresh reads need distinct pool keys, exact status assertions, and an honest permission-enforcement skip.
- **Hot-path work**: store paths are structurally capped at `.db` and `-wal`; the pass must remain sequential and bounded.
- **Design/code agreement**: the renewed Gate 2 must describe the shipped one-pass placement and its check/use boundary rather than the rejected stat-through-handle design.

## Full-flow trace

- Both `readSqlite` and `withSqliteSnapshot` select an engine, run the unchanged existence-oriented presence check, and map only proved absence to `no-db`.
- `SnapshotPool.borrow` calls `readStoreGeneration`. Two ordered stat passes establish an agreed generation; the separate readability pass opens each stamped path read-only and closes it before advancing.
- An open rejection or close rejection returns `usable=false`. That disables retained reuse and same-generation in-flight joining for that observation; the caller falls through to fresh snapshot production.
- Fresh node and CLI snapshot paths classify source-open refusal as `SnapshotOpenError`, and `withPooledSnapshot` maps it to `db-unreachable` for both public read entry points. Other snapshot/query failures remain `query-error`.
- Retention publication still requires usable, equal before/after generations. A generation made unusable by close failure cannot publish a retained snapshot under that proof.
- The write path still uses `defaultWriteDeps.exists`, which aliases the bare existence predicate. An existing unreadable file therefore reaches SQLite and maps the engine failure to `write-error`, while a genuinely absent file remains `no-db`.
- The new real-filesystem read regression warms only store A and uses store B as a genuinely fresh key. Both WAL files are made unreadable, and both results now assert `db-unreachable`. The write regression asserts `write-error` and explicitly rejects `no-db`. Vitest's dynamic `ctx.skip()` aborts unsupported permission environments while `finally` cleanup still restores/removes files.

## Cross-round disposition

- **B1-R2 fixed**: `46d0ca2f` updates D1/D3 and the failure-surface inventory to own the shipped one-readability-pass-beside-two-stat-passes mechanism, its bounded cost, and its check/use boundary; Gate 2 was re-earned.
- **W1-R2 fixed**: `d1e1c303` catches a rejecting handle close and returns an unusable generation instead of allowing an untagged rejection to surface as `query-error`.
- **W2-R2 fixed**: the end-to-end retained/fresh regression now asserts `db-unreachable` on both paths, not merely equality and non-`ok`.
- **W3-R2 fixed**: an existing-but-unreadable write now asserts `write-error` and not `no-db`, with an honest runtime skip where chmod is ineffective.
- Cycle 1 B1/W1/W2 remain fixed by the replacement design and its retained test structure.

## Findings

None.

## Invariant inventory

- **A retained `ok` requires the stamped live source set to be openable**: searched base file, present WAL, open refusal, close refusal, retained hit, in-flight join, fresh production, and post-production retention. Changed behavior is safe at each boundary. Permission changes after the proof remain the explicitly accepted ordinary check/use race; SQLite's eventual source open is authoritative.
- **Only proved absence becomes `no-db`**: searched both read entry points, source-open classification for node and CLI engines, and the shared write dependency. Read refusals become `db-unreachable`; existing unreadable writes become `write-error`; absence remains `no-db`.
- **Descriptor work stays bounded**: the file-set axis is structurally capped at two paths, opens are sequential, close is attempted before any next path, and a close rejection stops the pass. No retry, collection growth, or repeated per-path work was introduced.
- **The regression distinguishes retained from fresh and exact status from mere agreement**: distinct store paths, exact `db-unreachable` assertions, dynamic skip, and cleanup are all present.

## Inline support review

The changed tests have no `.only` or static `.skip`; async filesystem and SQLite operations are awaited; cleanup runs in `finally`; temporary paths are unique. The close-rejection unit case fails if the rejection escapes and proves `usable=false`. The two-store read case is genuinely fresh on store B. The write case exercises production default dependencies rather than an injected existence answer. No fixture, seed, secret, or PII issue was found. The changed analytics metadata contains aggregate execution counts only and no credential material.

## Recorded verification evidence

`bun run asm change verify-status prove-the-store-is-readable-not-merely-there` reports task `1_1 [x]`, exit 0, scope unchanged, with five additive assertions covering round-2 W1/W2/W3. Per review policy, no project test, typecheck, lint, or verify command was run during this review.

## Specialist results

- `asm-review-data-security` — store readability, descriptor ownership, and status security — `gpt-5.6-sol[1M]` — no findings.
- `asm-review-logic` — close control flow, pool fallback, races, and test honesty — `gpt-5.6-terra[1M]` — no findings.
- `asm-review-contracts` — D1-D4, task/spec alignment, and discriminated statuses — `sonnet[1M]` — no findings.
- `asm-review-performance` — bounded open/close work and pool interaction — `gpt-5.6-luna[1M]` — no findings.
- `asm-finder` — caller, engine, write, and test-flow trace — support evidence only.
