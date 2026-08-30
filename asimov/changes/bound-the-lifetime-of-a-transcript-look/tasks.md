## 1. Bounding the look

- [x] 1_1 Bound a look with a deadline and let only a current attempt commit what it saw — verified: pnpm exec vitest run 'src/worktree/sessionPreviewService.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/vault-session-preview/spec.md#{a-transcript-look-abandons-a-slow-read-rather-than-waiting-on-it, an-abandoned-look-is-scored-as-no-progress-and-commits-nothing} <!-- design.md D1, D2, D3, D5, D6 -->
  - **Acceptance**:
    - Outcome: a look against an unresponsive path answers with its last known line and never blanks it
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, add `lookTimeoutMs?: number` and `wait?(ms: number): Promise<void>` to `SessionPreviewDeps`, with `DEFAULT_LOOK_TIMEOUT_MS = 5000` and a default `wait` built on `setTimeout` whose timer is `unref()`d.
    2. Introduce a `LookDraft` holding the five fields `look` owns — `entry`, `target`, `stamp`, `line`, `progressed` — plus `snapshot(held)` and `commit(held, draft)` helpers; change `look`, `forget`, and `clearTarget` to take a `LookDraft` rather than a `Held`.
    3. Add `generation: number` to `Held`, initialised to `0`; in `preview` capture `const generation = ++current.generation` and build a fresh draft before calling `look`.
    4. Guard both settlement handlers with `if (current.generation !== generation) return ...`; inside the guard call `commit(current, draft)` first, then score — `misses = draft.progressed ? 0 : misses + 1` on resolve, `misses += 1` plus `forget` on reject — then `schedule()`.
    5. Race the guarded promise against `wait(lookTimeoutMs)` mapped to a module-private sentinel; on the sentinel bump `current.generation`, do `current.misses += 1`, call `schedule()`, and return `current.line` unchanged. Assign the raced promise to `current.inflight` so concurrent askers are released together.
- [ ] 1_2 Keep the attempt registry outside the cache so eviction releases nothing
  - **Deps**: 1_1
  - **Refs**: specs/vault-session-preview/spec.md#outstanding-transcript-work-does-not-grow-with-the-rows-that-ask <!-- design.md D4, D6 -->
  - **Acceptance**:
    - Outcome: outstanding transcript reads never exceed the retention cap
    - Verify: unit src/worktree/sessionPreviewService.test.ts
  - **Plan**:
    1. In `src/worktree/sessionPreviewService.ts`, add a service-scoped `const outstanding = new Map<string, Attempt>()` beside `held`, where `Attempt` carries the owning `Held` and the raced promise.
    2. In `preview`, resolve the entry as `held.get(entryId) ?? outstanding.get(entryId)?.owner ?? <fresh Held>`, so an evicted session with an attempt still running is re-adopted rather than rebuilt.
    3. Return the registered raced promise when `outstanding` holds this entry, and return `current.line` without starting a look when `outstanding.size >= cap`; place both checks before the `nextAt` cadence check.
    4. Register the attempt when the look starts and delete it from a `.then` on the scored promise from 1_1 — never from a bare `finally` on the raw look, per design.md D6.
    5. Leave `touch`'s eviction loop unchanged, and update the existing eviction test at `src/worktree/sessionPreviewService.test.ts:515-529`, which asserts a second read runs while the first is held — the behavior this task forbids.
