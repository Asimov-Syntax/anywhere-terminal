# 260823-claude-session-title

## Symptom — IMMUTABLE
The reporter's words, unedited. If this needs changing, the report was
misrecorded; open a new session rather than rewriting history.

> claude hiển thị sai tên title của session, trong AI Vault, claude không hiển thị theo tên session, có vẻ nó ưu tiên message đầu tiên?

## Current focus — OVERWRITE
Closed. Repro + regression green, reconfirmed (stashing the fix turns the repro RED).

## Evidence — APPEND ONLY

- `probe-survey.ts` over 120 recent transcripts: 48 carry an `ai-title`, 51 carry none.
  Of the files that do carry one, the freshest is ALWAYS within the reader's 64 KB tail
  window (deep=0) — the tail read was never the problem.
- `probe-precedence.ts` over the 100 most recent transcripts: **29 carry a
  `{"type":"custom-title","customTitle":…}` record** (the name the user gave the session in
  Claude) and **30 carry a `last-prompt` but no `ai-title`**. The reader ignored both types
  entirely, so ~59% of recent sessions were titled by their first message.
- Ground truth for Claude's OWN precedence, read out of the `2.1.239` binary
  (`strings` → session-summary builder):
  `title = (customTitle || aiTitle) || lastPrompt || summaryHint || firstPrompt`,
  each field taken from the LAST matching trailer record, with an empty string CLEARING it
  (`this.currentSessionTitle = g || undefined`). Claude re-appends the whole trailer
  (`last-prompt`, `custom-title`, `ai-title`, `tag`, `mode`, …) as the session evolves.
- `docs/research/20260707-vault-session-formats.md:97,135` already recorded this
  ("prefer `custom-title` over `ai-title` for Claude Code") — the reader never implemented it.
- After the fix, `probe-realwide.ts` over the 150 most recent real sessions:
  **ok=146, miss=0, noTrailer=4** (the 4 have no trailer at all and correctly fall back to
  the first prompt).

## Eliminated — APPEND ONLY

- *The `ai-title` record sits deeper than the 64 KB tail window.* — surveyed 120 recent
  transcripts; every file containing an `ai-title` has its latest one inside the window
  (deep=0). `readLatestAiTitle` never missed a record that was present.
- *The per-file `(mtimeMs, size)` list cache serves a stale title.* — `probe-real.ts` ran
  `readClaudeSessions` with NO `prev` cache and reproduced the same wrong titles; every
  session that had an `ai-title` matched exactly.
- *Claude ranks a mid-file `/compact` `{"type":"summary"}` record above the first prompt.*
  — it does not: Claude's `summaryHint` is read from the tail trailer, not from a forward
  scan, so a mid-file summary is invisible to it. An intermediate patch that promoted our
  head-scanned `summary` above the first prompt turned `claudeReader.test.ts:39` red; that
  test was defending correct behaviour, and the promotion was reverted rather than the test.

## Root cause — OVERWRITE

`src/vault/readers/claudeReader.ts:294` built the entry title as
`aiTitle ?? firstUserMessage`, and `readLatestAiTitle`
(`src/vault/readers/claudeRecords.ts:103`) parsed only `{"type":"ai-title"}` out of the tail
— so the two other trailer records Claude ranks in front of the first prompt, `custom-title`
(the user's own session name, which Claude puts ABOVE its generated title) and `last-prompt`,
were dropped, and every session that had one but no `ai-title` fell all the way through to
the first message.

Fix: `readLatestTailTitles` collects all three from the same single 64 KB tail read
(last record of each type wins, empty string clears — Claude's own semantics), and the entry
title is `customTitle ?? aiTitle ?? lastPrompt ?? firstPrompt`.

## Not settled by this session

- The extension's own vault rename (`VaultCustomNameRegistry`) is still a serve-time overlay
  for Claude: `defaultNativeRenamers` (`VaultService.ts:119`) covers opencode/codex only, so
  renaming a Claude row in the vault does NOT write a `custom-title` record back into the
  transcript and Claude will not show it. That is a feature gap, not this bug.
- The list title for a live session now tracks `lastPrompt`, so a row's title changes as the
  user types new prompts — that is exactly what Claude's own picker does, but it is new
  behaviour for the vault list.
- `tsconfig.json` now excludes `asimov`: session repro scripts import from `src` while living
  outside `rootDir`, which made `bun run check-types` fail with TS6059. Verified clean before
  and after.
