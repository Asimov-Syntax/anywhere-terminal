# Review Round 1

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Fastlane: yes — escalated for security-privacy and cross-boundary review
- Scope: commit range `ab400d17..HEAD`
- Head: `45ec28b564815a097a666d881161fce94fa523eb` (working tree also contains dirty Asimov analytics files outside the requested range)
- Reviewable lines: 86
- Agents spawned: `asm-review-logic` (nonblocking open, errors, async/lock flow; `gpt-5.6-sol[1M]`), `asm-review-data-security` (repository-controlled reads and failure classification; `gpt-5.6-terra[1M]`), `asm-review-contracts` (LockedFile API/DI and caller compatibility; `sonnet[1M]`), `asm-review-reuse` (helper duplication and ownership; `gpt-5.6-luna[1M]`), `asm-finder` (full production call-site and classifier inventory; `gpt-5.6-luna[1M]`)
- Agents skipped: `asm-review-frontend` — no frontend change or impact cone; `asm-review-performance` — the accepted growth axis is structurally capped at one `fstat` per already-bounded provider open
- Verdict: APPROVE
- Counts: BLOCK 0, WARN 0, SUGGEST 0

## Accepted obligations

Gate 2 is approved. The reviewed range satisfies D1–D4 and tasks 1_1–1_3: the helper composes the platform read flags, validates the opened handle, closes and rejects non-regular handles with `ENOTSUP`; both in-scope readers use it; and `writeNativeConfig` gains no separate file-type rule.

## Full-flow trace

- Provisioning: extension wiring supplies `createProvisioningDeps` → every adapter reaches `openProviderFile` containment → `readBounded` → `openRegularFile`. A non-regular handle throws `ENOTSUP`; `isAbsence` rejects that errno, so the result is an `unreadable` problem while the repository's own material remains in the model.
- Native save: `writeNativeConfig` acquires `LockedFile` → observes the target under the lock → `readText` opens through `openRegularFile`. Refusal propagates to `withLock`, which returns the caller's `unwritable` value and then releases the lock; the lock-path witness and following-save witness cover the stationary FIFO, while the raced replacement witness covers the path-type TOCTOU.
- Claude hook installer: it constructs `LockedFile` for locking and staged replacement but does not call `LockedFile.readText`; its direct authorized-handle reads are unchanged by this range. The new `handle.readFile("utf8")` path therefore changes behavior only for the native-config caller, where a fresh handle begins at offset zero and `fstat` does not move that offset.
- Error exits: provider reads classify only `ENOENT`/`ENOTDIR` as absence; `ENOTSUP` remains unreadable. The native writer's lock callback converts the throw to `unwritable`, not success, and releases the lock. No reachable changed path treats the new errno as success.

## Findings

No evidence-backed BLOCK, WARN, or SUGGEST findings.

## Support review

Changed production code has corresponding real-filesystem and integration witnesses. The conditional skips are limited to win32 FIFO cases; the pure `readFlags` test covers the win32 degradation arm. No `.only`, unconditional `.skip`, unawaited changed async assertion, fixture secret, or contract-shape mismatch was found.

## Verification evidence

`bun run asm change verify-status open-a-provider-file-without-waiting-on-it` records tasks 1_1, 1_2, and 1_3 as exit 0 and scope-unchanged. No project verify command was run by the chair.
