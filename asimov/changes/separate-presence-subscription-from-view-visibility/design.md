# Design: separate-presence-subscription-from-view-visibility

## Context

`worktreeViewVisibility` is a boolean, and three decisions read it:

```
webview                     host (WorktreeHost)                    projector
--------                    -------------------                    ---------
setVisible(b) ──message──▶  state.visible
                            showing = visible && displayed
                              ├─▶ postTo(surface, …)          push tree + presence
                              └─▶ reconcileScan()  ──arm──▶   project({external:true})
                                                                ├ registry read + externalRows
                                                                ├ titleFromVault()      ← per row
                                                                └ previewFromVault()    ← per row
```

The count a scope carries is built from `externalRows`. Titles and previews are drawn on rows and
nothing else consumes them. So the two costs the boolean fuses have different consumers, and only
one of them survives a collapsed rail.

## Decisions

### D1 — The message carries a level, not a second boolean

`WorktreeViewVisibilityMessage` gains `level: "rows" | "presence"`, optional and defaulting to
`"rows"`.

A second boolean beside `visible` would have four states, two of which are nonsense
(`visible: false, presenceOnly: true`). A level makes the invalid state unrepresentable and keeps
one field answering one question. `visible: false` continues to mean no subscription at all, so
the stop path is unchanged and every sender that omits the field behaves exactly as it does today.

Rejected: a separate `worktreePresenceSubscription` message. It would give two lifecycles to keep
in step, and the ordering between them would become a thing to reason about on every edge.

### D2 — The host tracks the level per surface; the scan follows subscription, enrichment follows drawing

`anyShowing()` is unchanged: any subscribed, displayed surface arms the scan, because presence is
what a `"presence"` subscriber is there for. A new `anyDrawingRows()` answers the narrower
question, and the host passes it into the projection.

This is the whole of B1's fix. A collapsed scoped rail keeps the registry read and `externalRows`
— which is what the count needs — and stops paying per-row title and preview enrichment, which
nothing on screen is reading.

### D3 — `ProjectOptions` gains `enrich`, defaulting true

```ts
export interface ProjectOptions {
  external?: boolean;
  /**
   * Run per-row title and preview enrichment. False when no attached surface is
   * drawing rows: the presence a scope's count is built from comes from the
   * registry pass, and titles and previews are drawn on rows or not at all.
   */
  enrich?: boolean;
}
```

`project()` skips `titleFromVault` and `previewFromVault` when it is false. Nothing else moves —
in particular ranking still updates, because `rank` is computed from `lastActivityAt` on the rows
themselves and a stale ranking would reorder groups the moment the rail reopened.

### D4 — In the controller, body work keys on drawing, subscription keys on either

The controller keeps two fields: what the panel asked for, and whether a scope needs presence. The
level posted is `"rows"` when the panel asked for the body, `"presence"` when only the scope needs
it, and no subscription at all when neither.

The lifecycle rule, which is where the reverted attempt went wrong: **everything that acts on the
body keys on the panel's request falling to false, never on the subscription ending.** That covers
the `pendingCreate` cleanup and body-only refresh eligibility. A late create response must not be
able to mount a form over a body the panel has left, and whether some scope still wants presence
has nothing to do with that.

## Failure-surface inventory

The change touches no mutable resource whose failure outlives the request: no file, store, lock or
spawned process is written. It narrows work done inside an existing in-memory projection.

- **Who owns writes** — n/a, no durable write is added or moved.
- **What serializes concurrent access** — unchanged. The projection is already one-at-a-time
  (`presenceProjector.ts`, "the projector is stateful"), and this adds no second entry.
- **Crash mid-write** — n/a.
- **Failed or malformed read** — unchanged. Skipping enrichment removes reads; it adds none, and
  a row with no preview is already a normal row (`lastActivity.ts` D3).
- **Two racing hosts** — n/a, one host per window, unchanged.

One state does deserve naming: a surface that flips `"presence"` → `"rows"` finds rows whose
enrichment was skipped for as long as nobody drew them. The rail reopening already requests a
fresh tree, and the next projection enriches; until it lands the rows show no preview, which is
the same thing they show before the first projection of any session.

## Risks

| Risk | Mitigation |
|---|---|
| Repeating the reverted attempt's B2 — body lifecycle behind the subscription | D4 states the rule in the direction that failed, and task 2 tests the create path specifically |
| A surface left at `"presence"` when it should draw | The level is recomputed from the same two inputs on every edge, not accumulated |
| Enrichment skipped while a surface IS drawing | `anyDrawingRows()` is a host-side OR across surfaces, so any drawing surface enriches for all |
