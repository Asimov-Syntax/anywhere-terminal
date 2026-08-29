# Design: source-the-agent-row-preview

## Decisions

### D1: A narrow tail reader over file-backed transcripts, not the detail reader

The preview is read by a new reader that seeks the **end** of a transcript and walks backwards to the
first record it can use. It does not go through `vault/readers/detail.ts`.

The detail path is the obvious reuse and it is the wrong one. `detail.ts:617-629` derives
`latestMessage` from a fully classified transcript: `claudeRecords.ts:177-217` streams every line of
the file to fill a 100-head/4000-tail buffer, `detail.ts:856-868` then caps a 400-item timeline and
12 activity steps, and `claudeReader.ts:195-259` finalizes the pair with no cache behind it. That is
a whole-file read and a full classification to produce one line of at most 120 characters, per row,
per scan — the data-scale trap the PLAN task names by name.

A tail read is bounded by construction: one positioned read of the file's last bytes, split on
newlines, parsed from the end. Cost does not grow with transcript size, which is the axis that
actually grows here — a long-running session's transcript reaches tens of megabytes while its last
message stays one line.

### D1a: Coverage is file-backed transcripts only, and that is a stated limit

**Covered: Claude JSONL, and Codex when its rollout file exists.** Not OpenCode, not Cursor.

This is a property of what the providers expose, not a shortcut. A Codex entry carries
`sessionPath` from `rollout_path`, and locating its rollout is `pickRolloutPath`'s existing
decision — the index's path when it is contained, **else a scan by uuid** over
`~/.codex/sessions/**` (`codexReader.ts:1071-1094`). The scan is the expensive half: that tree
grows with history and is never pruned, so a session it cannot resolve must not be retried on the
freshness cadence. How often that scan may run is D2's, not this decision's. An OpenCode entry exposes no transcript path at all — its content is
SQLite `message`/`part` rows (`opencodeReader.ts:157-177`) — and Cursor deliberately exposes none,
because its own accepted requirements forbid a listing from opening `store.db`
(`agent-session-index` § "Cursor indexing is metadata-only").

The alternative was a provider-adapter per source. Rejected: the SQLite adapters would need bounded
SQL and blob decoding, could not inherit "one positioned read, flat in transcript size", and for
Cursor would require modifying an accepted metadata-only requirement this change has no reason to
touch. An uncovered row shows no preview, which § D3 already establishes as a normal row.

```ts
/** One session's last activity, already bounded. `null` = nothing usable here. */
export function readLastActivityLine(
  transcriptPath: string,
  format: "claude" | "codex",
  /** Test seam only — production always takes the default. */
  open?: (p: string) => Promise<FileHandle>,
): Promise<string | null>;
```

### D1b: One usable-record predicate per format, and a stated scan budget

The two covered formats do not share a schema, so the walk needs one predicate each — Claude admits
a non-sidechain, non-meta `user`/`assistant` record (`detail.ts:610-645`); Codex requires an
`event_msg` whose `payload.type` is `user_message` or `agent_message`
(`codexReader.ts:813-898`). The reader takes the format, never guesses it from the content.

The walk is bounded twice over, because "return the last message" and "never read the head" cannot
both hold unconditionally — a single record can be larger than any window:

- The tail window starts at a fixed size and doubles up to a **cap**. A record that has not been
  fully seen by the cap is given up on: the reader returns `null`.
- `null` is the same answer as "no usable record", and the caller treats it identically. A row with a
  pathological last record shows no preview rather than costing an unbounded read.

The line is bounded with the vault's existing `boundedPreview` helper — the same ≤120-char
newline-stripping bound the title preview already uses, so the two previews the spec now admits are
bounded by one implementation.

### D2: The preview service owns the stamp, the cache, and the rate

One owner, and it is **not** the projector. The projector gets the same optional, one-argument dep
shape `sessionTitle` already has (`presenceProjector.ts:130-160`) and stays ignorant of files:

```ts
sessionPreview?(entryId: string): Promise<string | undefined>;
```

Everything the freshness question needs lives behind that call, in a small service wired at
`extension.ts:712` beside `sessionTitle`:

| Concern | Answer |
|---|---|
| Freshness | `(mtimeMs, size)` against the stamp held for that `entryId`. Equal → return the held line, open nothing. This is the vault list path's own gate (`claudeReader.ts:373-440`, `storeStamp.ts:13-41`), not a new one — `mtimeMs` alone is not enough because coarse mtime granularity can hide two writes in one tick |
| Retry rate | Separate from the interval below, and deliberately so. Re-checking a known file is a `stat`; resolving one that is not there yet is D1a's uuid scan over a history-sized tree, and the vault lookup that precedes it is another. Consecutive looks that achieve nothing decay their own retry; a look that confirms a stamp or completes a read puts the entry back on the interval. The entry that produced a resolved target is held beside it, so a healthy row's re-check asks neither the vault nor the store where its transcript is (round-3 B1-R3) |
| Rate | A minimum re-check interval per `entryId`. A full projection can run at the 150 ms cap (`WorktreeHost.ts:55-63`), and without this the `stat` count is rows × ~6.7/s during continuous pane activity. Freshness the user can perceive is seconds, not milliseconds |
| Duplicate reads | One in-flight promise per `entryId`; concurrent askers await it rather than each opening the file |
| Eviction | LRU bound on entry count. The projector cannot evict for the service — it holds no stamp and passes no alive set — so the bound is the service's own |

An earlier draft split this: the projector holding an alive-set-evicted cache in `titleFromVault`'s
shape, the service holding the stamp. Two owners of one question, and the projector could not evict
what it could not see. Reuse the *pass* shape, not the ownership.

**The cache is in memory and dies with the extension host.** No on-disk preview cache: it would be a
mutable resource whose failure outlives the request — owner, serialization, crash-mid-write, egress
clause — to save one tail read per session per window session. The `0o600` list cache
(`VaultCacheStore.ts:192-269`) is untouched.

```
scan ──▶ row has entryId? ──no──▶ no preview
             │yes
             ▼
      sessionPreview(entryId)
             │
             ├─ within re-check interval? ──yes──▶ held line, no syscall
             ├─ stat ──▶ stamp unchanged? ──yes──▶ held line, no open
             └─ tail read (D1/D1b) ──▶ bounded line ──▶ store {stamp, line}
```

### D3: Absence is not degradation

A row carries no `preview` key when it has no resolved session, when its source is not one of D1a's
two, or when the read returns `null`. No placeholder stands in for it.

`degradedSources` must not grow an entry for any of those. That list drives a stale affordance the
user is shown (`worktree-agent-presence` § "A failed presence source degrades its scope rather than
clearing it"); an OpenCode row that never had a transcript path is a normal row, and marking the scan
degraded for it would put a warning on screen for the ordinary case. A preview is optional row
enrichment, never an authoritative presence source — nothing about identity, activity, or ranking
reads it.

### D4: The preview is message text, so it never meets the title's stripper

`stripDecorations` (`worktreeFormat.ts:15-38`) exists for pane titles, where a leading `⠋` or `- ` is
an animation frame an agent printed. `GLYPH_FRAMES` includes `*` and whitespace; `ASCII_FRAME` is
`/^[|/\\-]\s+/`. Applied to prose, both eat ordinary content: `- item` becomes `item`, `* item`
becomes `item`, and a line that is only a marker becomes `""` — which, per WT-009.2's layout, draws
no second line at all. That is round-1 W1, inherited.

The fix is provenance, not a narrower regex. A preview is transcript message text; it is bounded and
newline-stripped by its reader (D1b) and is **not** frame-stripped anywhere. So WT-009.2's
`stripDecorations(r.preview)` calls come out of `worktreeTreeView.ts:559-579` and
`worktreeRenderSignature.ts:87-93`, and `stripDecorations` keeps its present shape for `title`, whose
contract is unchanged and is shared with the host (`worktree-agent-presence` § 3.4). No production
path derives `preview` from a pane title today — only fixtures assume spinner-prefixed preview text,
and those assumptions move with this change.

Narrowing the shared regex was the alternative and is rejected: it would move an accepted contract
this change does not own, to fix a problem that only exists because the wrong stripper was applied.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Preview read | Whole-file read per row per scan | D1 reads the tail only; cost is flat in transcript size |
| Preview read | An oversized single record defeats the bound | D1b caps window growth and gives up as `null` rather than reading unboundedly |
| Preview read | Re-reads a transcript nothing wrote to | D2 gates on `(mtimeMs, size)`; a quiet scan opens nothing |
| Preview read | An unresolvable Codex row re-walks the sessions tree every interval | Consecutive resolution failures decay their own retry; resolving restores the freshness cadence (D1a) |
| Preview read | Growth axis is rows × scans; a 150 ms full projection would make that rows × ~6.7 `stat`/s | D2's per-entry re-check interval bounds syscalls independently of scan rate |
| Preview text | Unbounded text crosses IPC and enters the render signature | D1b bounds with the existing `boundedPreview` before the row is built |
| Preview text | A bulleted line loses its marker, or renders as nothing | D4 removes the title stripper from the preview path entirely |
| Coverage | Silently covering only two providers | D1a states the limit and why; the presence spec admits an uncovered row explicitly |
| Coverage | An uncovered row reads as a failure | D3 keeps `degradedSources` untouched; no preview key, no placeholder |
| Spec | The widening mandates a preview every listing must produce, or licences Cursor reads | The delta makes the preview OPTIONAL and permitted from covered sources; Cursor's metadata-only requirements are untouched and still binding |

## Failure surface

| Resource | Answer |
|---|---|
| Transcript files | Read-only, never written. Two racing hosts both read; there is nothing to serialize |
| Preview cache | In-memory, single-owner (the preview service, D2), dies with the process. No crash-mid-write state exists because there is no write |
| Failed / malformed read | **Fails open**: the row carries no preview and the scan reports no degradation (D3). Closed would mean a warning on screen for a session that simply has not spoken yet |
| Concurrent asks for one session | One in-flight read per `entryId`; later askers await it (D2) |
| On-disk cache | n/a — D2 deliberately adds none; the existing `0o600` list cache is untouched |
