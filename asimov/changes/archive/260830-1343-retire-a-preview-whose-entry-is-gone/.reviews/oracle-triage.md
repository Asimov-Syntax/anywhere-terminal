# Oracle triage — planning round

## F2 (BLOCK) — a null `getEntry` cannot confirm deletion — ACCEPTED

Verified at source, and the reader says it outright:
`src/vault/readers/codexReader.ts:594` — `return null; // query-error → unresolved (caller treats
null as unknown-entry)`. `claudeReader.ts:468-484` collapses an unlocatable path, an unparseable
file, and any thrown build error into the same `null`. `VaultService.getEntry` documents `null` for
"an unknown agent or an unresolvable session".

So "only a null `deps.entry` produces `gone`" is not the rule I thought I was writing. A transient
SQLite query error would retire a live session's line — the precise confusion this task exists to
end. A truthful mechanism needs `found | absent | unknown` from the readers, and only `absent` may
retire.

## F1 (BLOCK) — the unreadable-transcript contradiction is unresolved — ACCEPTED AS STATED,
## resolved against the blueprint rather than the spec

I tried to read the blueprint's clause as covering only the timeout. It does not:
`worktree-subsystem-debts.md` § 2.5 says plainly "an unreadable file keeps the last known line and
backs off". `worktree-agent-presence` § "An agent row's preview line says what its session last did"
says a row whose transcript cannot be read "SHALL carry no preview line at all", and
`sessionPreviewService.test.ts:427` asserts exactly that, citing round-1 W1. The oracle is right that the delta modified neither
— it asserted a reading in a Notes line and moved on.

Resolved by reading § 2.5's own citation. It says the kept line is "per § 2.3", and § 2.3 — in its
prose and in the code WT-011.3 shipped — grants that only to a look that **times out**: "a look that
times out is a look that achieved nothing". A read that *fails* runs `forget` and retires the line.
§ 2.5 over-generalised from unresponsive to unreadable. The accepted requirement stands, both tests
stand, and the blueprint clause is now corrected instead of the spec.

## F3 (BLOCK) — the 30 s bound is not achievable — ACCEPTED

`preview` returns the cached line without starting a check while an abandoned look is still
outstanding, and `sessionPreviewService.test.ts:839` proves a row holds its line 100 s past that.
A pull-based service can promise "the first eligible look after the interval", not a wall-clock bound.

## F4, F5 (WARN), F6 (SUGGEST) — ACCEPTED

Transitions and scheduling under-specified: record the time of every CONCLUSIVE check (found or
absent), schedule `gone` on its own cadence rather than feeding no-ops through the miss ladder, and
name the `gone → unresolved → resolved` recovery. Aggregate cost is per held session, so concurrent
Codex rows can synchronize history walks. Test list adopted.

## Consequence

There is no credible slice left inside the blueprint's size. F2's fix is new API surface across the
vault readers, `VaultService`, and the extension wiring; F1 needed no reversal after all.

So the split is mechanical, not a product-scope fork: acceptance, order, and releasability are
unchanged, and nothing accepted is cut. WT-011.8 owns the lookup contract; WT-011.5 depends on it
and is parked until it lands.
