# Proposal: separate-detail-completeness-signals

## Why

The vault session preview's "↑ Load older messages" button never disappears and never yields more content on OpenCode and Cursor (CLI and IDE): every click grows the requested limit by 400, the reader returns the same items, and the button re-renders. Claude and Codex are correct. The cause is that `VaultSessionDetail` carries two independent completeness signals — `truncated` (a larger limit would return more) and `partial`/`limitedReason` (the read dropped source records no limit can recover) — and three producers feed both from one input, so an unrecoverable source omission is reported as a pageable one.

## Appetite

S (≤1d)

## Scope

### In scope

- The three producers that conflate the two signals: Cursor CLI (both return paths), Cursor IDE, OpenCode.
- The existing spec requirement that mandates the conflation, so the durable spec stops contradicting the fix.
- Per-provider test coverage at two limits, plus one cross-layer webview regression proving the affordance disappears.
- Renaming `cursorTranscript.ts`'s local `MAX_TIMELINE_ITEMS` (500), which shadows the exported name in `detail.ts` (400).

### Out of scope

- Making `contentKind` required or deriving it inside constructors, and removing the `entry.agent === "cursor"` fallback in the preview — owned by `unify-vault-detail-contract`, which lands after this.
- Splitting metadata-only details onto their own constructor — same owner.
- Raising any reader's fixed source window, or changing `PREVIEW_LIMIT_STEP` / `MAX_DETAIL_LIMIT`.
- Claude and Codex reader truncation logic, which is already correct and is the reference.

## Risk Level

MEDIUM — the fix touches the flag every provider's preview pagination reads, and one legitimate case (Claude) requires both flags true at once, so an over-eager fix that forces one flag off when the other is set replaces this bug with its mirror image.
