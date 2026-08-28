# 260827-worktree-row-derived-slug

Supersedes 260827-worktree-agent-untitled.

## Symptom (verbatim)

> sao lại hiện là cyberk-skills-f9 nhỉ? nhìn nó vô lý thế
> nhìn nó thảm hại quá, dào xem /Users/huybuidac/Projects/ai-oss/orca lấy tên như nào,
> có thử tự ưu tiên gì ko, làm gì phải nghĩ sáng tạo đâu

Screenshot: two different panes under `main` both read `cyberk-skills-f9`.

## Repro

`bun run asimov/debug/260827-worktree-row-derived-slug/repro.ts` — two registry
entries carrying `name: "cyberk-skills-f9", nameSource: "derived"` and a vault that
can title both sessions.

```
OBSERVES 1: RED — expected "Fix the worktree row titles", got "cyberk-skills-f9"
OBSERVES 2: RED — expected "Hadern attribution analysis", got "cyberk-skills-f9"
```

## Root cause

The precedence the previous session shipped is inverted. `presenceProjector` titled a
row from the pid registry's `name` first and consulted `deps.sessionTitle` only for a
row the registry had left unnamed — so the vault path essentially never ran.

That `name` is usually `nameSource: "derived"`: a slug claude computes off the
directory. Every session in one repo gets the same one, which is exactly what the two
identical rows were showing.

## What orca does (the reason no invention was needed)

`/Users/huybuidac/Projects/ai-oss/orca` never reads `~/.claude/sessions` at all — grep
finds no such read, and one unrelated `nameSource` hit. It titles a claude session from
the transcript, asserted in
`src/main/ai-vault/session-scanner-claude-title.test.ts`:

> prefers the latest generated ai-title over the first user prompt, but a custom-title
> wins over both

Claude's transcript carries those as records — confirmed on disk:
`{"type":"ai-title","aiTitle":"Lỗi 500 khi login social Google",…}` and
`{"type":"custom-title","customTitle":"FINISH-WORKTREE-OVERNIGHT",…}`.

This repo already implements that order — `src/vault/readers/claudeReader.ts:341-344`,
`tail.customTitle ?? tail.aiTitle ?? tail.lastPrompt ?? fields.title`, commented as
"Claude's own display precedence". The projection just never asked for it.

## Eliminated

1. The registry name is unusable in principle → a user-SET name is fine
   (`FINISH-WORKTREE-OVERNIGHT` matches the transcript's own `custom-title`). Only the
   derived slug is noise — and the vault already returns the custom title anyway, so the
   registry name is redundant when good and misleading when derived.
2. orca orders it differently → it does not read the registry at all.
3. The vault's title is the wrong string → it is the same order orca settled on.

## The fix (verified)

`src/worktree/presenceProjector.ts` — the vault pass now retitles EVERY row whose
session it can name, instead of filling only the unnamed ones. The registry name and the
pane title stay as fallbacks for a session with no readable transcript.

Cache: `TITLE_REFRESH_MS = 60_000`. A title is not static — claude generates one a few
turns in, and a rename can land at any time — so caching it for the life of the window
would pin the row to whatever it was called first; re-reading every pass would open a
transcript every five seconds. A read that fails keeps the previous answer, because an
unreadable transcript is not a session that lost its name.

Verified: `--reconfirm`, regression `bun run test:unit` green, inherited repro
(260827-worktree-agent-untitled) still green, `tsc --noEmit` clean.

## Still open — a SEPARATE fault, not fixed here

**Two panes, one session.** In the screenshot both rows under `main` carry the same
delegations ("Adversarial review of Q3 options", "Code review"), so both panes resolved
to one `entryId`. `resolveClaudeSession` step 2 (`src/session/resolveClaudeSession.ts:86-90`)
matches every live registry entry whose `cwd` equals the pane's and picks the newest by
mtime — with no exclusivity, so two panes sitting in one directory both claim it. The
projector's `claimed` set only suppresses duplicate EXTERNAL rows; it never makes a pane
claim exclusive.

The right title makes this more visible, not less: both rows will now read the same
real title. Fixing it needs a decision this session did not have evidence for — which
pane wins a contested session, and what the loser shows.

## Unrelated drift (second occurrence)

`bun run lint` (`biome check --write --unsafe src/`) again rewrote three untouched files,
including the behaviour change in `src/webview/worktree/worktreeFormat.ts:23`
(`/^[|/\\-]\s+/` → `/^[|/-]\s+/`, dropping `\` from the spinner frame class). Reverted again.
