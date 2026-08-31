# Review Round 3: bound-the-looks-one-projection-starts

**Date**: 2026-08-30
**Cycle**: 2
**Mode**: discovery
**Requested execution mode**: fastlane
**Scope**: range `f07afcb1..5a6c67d5`
**Head**: `5a6c67d5bb7c5c9ac00a0a062bde5f8c97fd7ee9` (working tree dirty outside the explicit range: `analytics.json` modified and `round-2.md` untracked before this artifact)
**Reviewable lines**: 170
**Agents spawned**: `asm-review-logic`, `asm-review-performance`, `asm-review-contracts`; caller/flow trace by `asm-finder`
**Agents skipped**: `asm-review-data-security` (no changed authority, input, path-resolution, persistence, or external API boundary), `asm-review-frontend` (no webview/React change), `asm-review-reuse` (no duplicated repository capability or cohesion split)
**Verdict**: **BLOCK**
**Counts**: 2 BLOCK, 1 WARN, 1 SUGGEST
**Blocker split**: 2 feature / 0 machinery

## Scope and accepted obligations

Gate 2 is approved. This fresh discovery applied D1, D2, D5, D6 and D7 plus task 2_1: a default projection budget of 16 independent of the preview cache cap; one set declaration containing every drawn entry id; exact service retention of that set with cap-LRU only before any declaration; synchronous line reads for excluded rows; and a bounded identity order that preserves absent-row position well enough that no row is excluded forever. D3's `mayLook` seam and D4's index cursor are superseded.

The explicit range contains all three implementation commits. Change artifacts, review artifacts, `docs/**`, and tests are support context rather than specialist-reviewed production files.

## Risk map

- **Fair state queue**: `previewOrder` is a new closure-level invariant owner. Its growth axis is distinct entry ids seen around the currently drawn set; it must remain at most `drawn.size + previewBudget` without letting pruning recreate starvation.
- **Retention lifetime**: `held`, `outstanding`, and the declared `drawn` set share session state across timeout, empty-set, disappearance, redraw, and rows/presence subscription modes.
- **Hot path**: the drawn-row axis has no numeric cap. Accepted D5 permits retained state proportional to currently drawn rows, while asynchronous preview promises and actual looks must remain bounded by the projection budget and service cap respectively.
- **Contract seam**: production wiring must supply `preview`, `line`, and `retain` coherently through `extension.ts`, `presenceDeps.ts`, and `presenceProjector.ts`; the old undeclared service path must retain its LRU cap.

## Full-flow trace

- `WorktreeHost` computes whether any visible/displayed surface draws rows, passes that as `enrich`, and serializes every `project()` call through one single-flight run with dirty reruns.
- The projector resolves pane and registry identities, removes contested/duplicate claims before enrichment, attributes rows, and flattens every row carrying an `entryId` across all worktrees.
- On an enriched pass it declares those ids, reconciles the identity order, grants at most `previewBudget` distinct ids, reads excluded lines synchronously, and awaits only permitted previews before writing results back to their original worktree/index.
- The preview service answers cadence hits from `held`; due rows can resolve, stat, and read behind per-entry de-duplication and the capped `outstanding` map. Deadline expiry returns the held line while the underlying attempt remains fenced in `outstanding` until it settles.
- Presence-only passes intentionally skip title/preview enrichment. A later row-drawing promotion requests an enriching pass; completely detached/hidden surfaces can leave no projection running.

## Findings

### B1

- **ID**: B1-R3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:569-575`
- **Title**: Back-pruning can permanently starve an intermittently drawn row under churn
- **Evidence**: Pruning deletes absent ids from the back. With budget 1, drive `[A,C,X1]`, `[A,X2]`, `[A,C,X3]`, `[A,X4]`, then alternate `[A,C,Xn]` and `[A,Xn]` with a fresh `Xn`. C is served once, then an absent projection prunes it from the back. Each return appends C behind A; the following absent projection prunes C again before it reaches the front. From that point A is granted repeatedly and C is excluded on every projection in which C is drawn. A disposable line-for-line queue probe reproduced the sequence. The added churn tests assert only the always-drawn ids and never assert the every-other id that motivated the corrected queue.
- **Impact**: D7's identity queue removes the original index-remapping bug, but the accepted fairness invariant still fails at the pruning/absence boundary. A real session that appears every other registry read amid continuing arrivals can keep an indefinitely stale or blank preview.
- **SuggestedFix**: Hand the bounded absent-order rule back to planning before another local patch: define which absent identities retain priority under churn, then implement admission/pruning that cannot repeatedly discard the same returning row. Add the sequence above and assert C is granted again within a stated bound.
- **Status**: open
- **Triage**: pending

### B2

- **ID**: B2-R3
- **Severity**: BLOCK
- **Confidence**: HIGH
- **Priority**: P1
- **Agent**: `asm-review-logic`, corroborated by `chair`
- **Class**: feature
- **File:line**: `src/worktree/sessionPreviewService.ts:434-445`
- **Title**: Timed-out outstanding entries survive an empty retention declaration
- **Evidence**: `retain()` removes excluded ids only from `held`, while `line()` falls back to `outstanding`. A timed-out look deliberately stays in `outstanding` until its underlying filesystem operation settles. A targeted probe established a held line, started a second look whose `stat` never completed, let the deadline return, then called `retain([])`: `line(id)` still returned the held line, and it still returned after `retain([id])` redrew the session. An abandoned operation can remain outstanding indefinitely; `retain([])` therefore does not make the retained line set empty.
- **Impact**: The exact-retention contract is false at the timeout/outstanding boundary. A session drawn, removed, and redrawn before the abandoned attempt settles resurrects its pre-absence line without a new look, so B2's replacement invariant is not closed across all state owners.
- **SuggestedFix**: Keep the outstanding attempt for concurrency fencing, but sever its retained-line lifetime when the id leaves the declared set. Make `line()` and the preview finalizer respect declaration generations/current membership, and cover exclusion while outstanding, timeout then `retain([])`, and redraw before settlement.
- **Status**: open
- **Triage**: pending

### W1

- **ID**: W1-R3
- **Severity**: WARN
- **Confidence**: HIGH
- **Priority**: P2
- **Agent**: `chair`
- **Class**: feature
- **File:line**: `src/worktree/presenceProjector.ts:542-548`
- **Title**: Leaving rows mode never declares the actual empty drawn set
- **Evidence**: The new empty-set cleanup runs only inside `previewFromVault`. `WorktreeHost` passes `enrich:false` when no surface draws rows, and `project()` then skips `previewFromVault` entirely; a final surface hiding or detaching may request no projection at all. The service consequently keeps the last enriched set while the actual UI-drawn set is empty. A later row-drawing pass can reuse those lines rather than starting from the lifetime D5 declared.
- **Impact**: Retained preview state is bounded by the last enriched row set rather than the current drawn set and can remain for the window lifetime after rows disappear. It does not accumulate across successive declared sets, so this is a warning rather than a blocker, but the accepted cleanup/lifetime rule is not applied at a supported mode boundary.
- **SuggestedFix**: Give the rows-mode falling edge a lightweight way to declare an empty retention set and clear `previewOrder`, including detach and a switch to presence-only mode, without forcing full transcript enrichment.
- **Status**: open
- **Triage**: pending

### S1

- **ID**: S1-R3
- **Severity**: SUGGEST
- **Confidence**: MEDIUM
- **Priority**: P4
- **Agent**: `asm-review-contracts`
- **Class**: feature
- **File:line**: `src/worktree/presenceDeps.ts:41-43`
- **Title**: The three preview operations are optional independently although they form one capability
- **Evidence**: `sessionPreview`, `sessionPreviewLine`, and `retainSessionPreviews` are separate optional fields and are spread independently. A caller supplying only the pre-change `sessionPreview` shape type-checks, but excluded rows silently receive no synchronous line and no drawn set is declared. Production supplies all three, and no current partial caller exists.
- **Impact**: No present runtime path is broken, but the type contract allows a future caller to silently violate D5/D6 rather than failing at compile time.
- **SuggestedFix**: Group the three operations under one optional preview capability object, or otherwise make the all-or-none relationship explicit in the type.
- **Status**: open
- **Triage**: pending; downgraded from specialist WARN because the full production wiring is the only current caller

## Cross-round disposition

- **B1-R1**: fixed in its original form — the index cursor is gone. The fairness obligation remains open through the different pruning mechanism in B1-R3.
- **B2-R1**: fixed for ordinary declared `held` entries past `cap`. Exact retention remains open through the separate timeout/`outstanding` mechanism in B2-R3 and the rows-mode lifetime warning W1-R3.
- **W1-R1**: fixed — excluded rows use synchronous map reads and the async preview array contains at most the granted identities.
- **S1-R1**: fixed — no-override tests pin 16 grants and all rows below the default.

## Invariant inventory

- **Fair grant rotation**: searched stable rows, persistent rows under changing membership, alternating absence, new arrivals, back-pruning, empty projections, and wraparound. Stable/persistent membership and the queue size bound are safe; alternating absence plus arrival churn is affected by B1-R3.
- **Exact retained lifetime**: searched declared/undeclared paths, cap overflow, ordinary removal, empty declaration, timeout/outstanding state, redraw, rows/presence modes, and detach. Undeclared LRU and ordinary declared `held` eviction are safe; timeout/outstanding is affected by B2-R3 and the no-rows mode boundary by W1-R3.
- **One-projection work bound**: searched one/many worktrees, duplicate claims, cadence hits, rejections, timeout, and excluded-row processing. At most the granted identities are invoked asynchronously and the service's outstanding work remains capped; round-1 W1 is closed.

## Inline support review

The changed tests contain no `.only` or `.skip`, and changed async test calls are awaited. Coverage now pins the default budget, cap-exceeding steady retention, persistent-row churn, and pruning that must not delete a currently drawn row. It does not cover the alternating absent row that B1-R3 starves, timeout/outstanding retention across `retain([])`, or the rows-mode falling edge.

## Recorded verification evidence

`bun run asm change verify-status bound-the-looks-one-projection-starts` records tasks 1_1, 1_2, and 2_1 verified with exit 0; task 2_1 is scope-unchanged. The caller additionally reports type check, `biome check src` at the 0-error/14-warning baseline, 5538 unit tests, the I10 gate, and both esbuild bundles green. Per review policy, no verify command or test suite was rerun; only two disposable targeted probes were used for B1-R3 and B2-R3.

## Specialist results

- `asm-review-logic` — retention state, timeout/outstanding paths, queue fairness, and cache hot/cold behavior — `gpt-5.6-sol[1M]` — B2-R3.
- `asm-review-performance` — drawn/order/held/outstanding growth axes and projection fan-out — `gpt-5.6-terra[1M]` — no finding; confirmed W1-R1's promise fan-out is closed on the steady path.
- `asm-review-contracts` — declared/undeclared seams, production wiring, obligations, and tests — `sonnet[1M]` — S1-R3 after adjudication.

---

## Author triage

### B1 — **AuthorStatus**: accepted. Thrash stop — the same invariant has now survived two fix attempts

**AuthorTriage**: Confirmed by my own trace before the chair's report arrived, and the sequence needs
one element the report leaves implicit: a **served-then-departed** id parked ahead of a
**never-served** one.

| Projection | Drawn | Order after | Granted |
|---|---|---|---|
| P0 | `Z, A` | `[A, Z]` | Z |
| P1 | `A, C, X1` | `[Z, C, X1, A]` | A |
| P2 | `A, X2` | `[Z, A, X2]` — C pruned | A |
| P3 | `A, C, X3` | `[Z, C, X3, A]` | A |
| P4 | `A, X4` | `[Z, A, X4]` — C pruned again | A |

`Z` is absent forever but sits at the front, so it occupies the only surviving absent slot; `C` is
pruned on every absence and re-enters at the back. Without `Z`, `C` is the frontmost absent id and
survives — which is why the round-1 fix's own tests pass.

The defect is one sentence: **pruning infers claim from position, and position stops meaning claim
once ids can be absent.** Serving moves an id to the back and arrivals append behind it, so a row
that was served and left outranks a row that has never been served at all.

Thrash stop reached: this is the second fix attempt to fail the same invariant — no drawn row is
starved — after the index cursor in round 1. The fix also needs D7 restated rather than
re-implemented: D7's text still says the order "removes ids no longer drawn", which the round-1 build
already had to contradict, and the correct rule needs explicit claim metadata rather than any
positional rule. That is a changed `D#`, so it is not remediation.

### B2 — **AuthorStatus**: accepted, same handback

**AuthorTriage**: Confirmed structurally in code I wrote: `retain` iterates `held.keys()` and deletes
from `held` alone, while `line` reads `held.get(entryId) ?? outstanding.get(entryId)`. A session
whose look was abandoned at its deadline therefore keeps its line through `retain([])` and can
present a pre-absence line when redrawn.

D5 claims the declared set is EXACT — that is the whole argument for preferring it to the LRU — and
it is not exact across the timeout boundary. `outstanding` deliberately outlives eviction (WT-011.3
put it there so a stalled session could not be released), so the two lifetimes genuinely disagree and
D5 has to say which wins. That is a change to D5, not a patch under it.

### W1 — **AuthorStatus**: accepted, folded into the handback

**AuthorTriage**: True and slightly worse than stated: the empty declaration sits *after*
`previewFromVault`'s `if (!read) return`, so a caller wiring `retainSessionPreviews` without
`sessionPreview` never declares anything at all. The falling edge needs an owner outside the
enrichment pass, which is the same seam B2 reopens.

### S1 — **AuthorStatus**: accepted, folded into the handback

**AuthorTriage**: Correct. The three operations are one capability and the type says they are three;
production supplies all three only by convention. Cheap to encode once the seam is being restated
anyway.

---

## Author re-triage, after oracle review

The oracle was asked for a direction and found a third failure — in the fix I had proposed for B1.
Recorded here because it changes the triage above, not because it confirms it.

**My proposed rule was wrong.** "Never-served outranks every served id" starves the opposite
population: budget 1, `A` served once, then `[A,X1]`, `[A,X2]`, … each grant the never-served `X`
and `A` — continuously drawn — is never served again. I had moved the starvation from intermittent
rows to persistent ones and would have shipped it.

**The requirement itself is unsatisfiable.** Bounded state, fairness for identities that disappear
and return, and unbounded identity churn cannot hold together: a bounded order must eventually
forget an absent id, and after forgetting it cannot tell its return from a new arrival. The spec
delta's "No row SHALL be excluded on every projection while others are looked at repeatedly" claims
exactly that combination. B1 is therefore not a queue bug at all — it is a contract that was written
without a feasible mechanism, and both fix attempts were attempts to implement an impossibility.

**B2 is also deeper than triaged.** Dropping the `outstanding` fallback from `line()` does not close
it: `preview()` resolves `held.get(id) ?? outstanding.get(id)` and `touch()`es the recovered object
back into `held`, so the stale line returns by that path. Clearing `outstanding` instead would undo
WT-011.3's guarantee that a stalled session cannot be re-read. The exclusion/timeout ordering, the
finalizer's unconditional re-seat, and the generation-mismatch return path all need to agree before
"exact" is true.

**Consequence for the thrash-stop choice.** Option 3 cannot honestly reach implementation approval:
B1's resolution is a spec narrowing, so a fix commit carrying it changes the frozen contract and
round 2 already established what happens then. The live options are a scope cut or a designed fix on
a narrowed contract — both of which are the user's call, not mine.
