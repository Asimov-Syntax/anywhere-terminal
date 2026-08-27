# 260827-worktree-agent-untitled

## Symptom (verbatim)

> tại sao các session đều bị untitled nhỉ?

Screenshot: every agent row in the Worktree view reads `(untitled)` — panes in this
window (`main`, with `~`) and rows badged `OTHER WINDOW` alike — while their PAST
DELEGATIONS render real titles ("Adversarial review of Q3 options", "Code review").

## Repro

`bun run asimov/debug/260827-worktree-agent-untitled/repro.ts`

Drives the production wiring (`createPresenceProjectorDeps` → `createPresenceProjector`
→ `agentRowTitle`) against a throwaway `CLAUDE_CONFIG_DIR` holding two registry files
written the way claude 2.1.239 writes them, `name` included.

Baseline:

```
OBSERVES 1: RED — a session running in another window shows its name: expected "hadern-analysis-a7", got "(untitled)"
OBSERVES 2: RED — a pane in this window shows its session name: expected "cyberk-skills-f9", got "(untitled)"
```

## Root cause

`WorktreeAgentRow.title` has exactly one producer in the whole codebase: the pane's
OSC terminal title.

- `src/worktree/presenceProjector.ts:257` and `:444` — `title: pane.title`, the
  decoration-stripped OSC title the webview reports.
- `src/worktree/presenceProjector.ts:363-377` — `externalRows()` builds its row
  literal with **no `title` field at all**. An other-window row is structurally
  incapable of carrying one.
- `src/vault/readers/runningSessions.ts:15-28` — `RunningClaudeSession` parses
  `pid`/`sessionId`/`cwd`/`startedAt`/`entrypoint` and **drops the registry file's
  `name`**, so even a producer that wanted the session name has nowhere to read it.

The remaining half is external to this repo: **claude 2.1.239 never sets an OSC title**.
`LC_ALL=C grep` over the binary finds a single `ESC ] 0 ;` occurrence, inside a terminal
capability-probe string — no `ESC ] 2 ;` at all. So `pane.title` stays `undefined` for
every claude pane, and `agentRowTitle()` (`src/webview/worktree/worktreeFormat.ts:193`)
falls through to `"(untitled)"`.

Both scopes therefore render the placeholder for the same reason: the row's title is
sourced from a channel claude does not use, and the channel that DOES name the session
(`~/.claude/sessions/<pid>.json` → `"name": "hadern-analysis-a7"`) is never read.

The delegation children look titled because they come from a different path entirely —
`rosterFromDetail()` reads titles out of the vault transcript (`src/worktree/delegations.ts:24-45`).

## Eliminated

1. `stripDecorations()` eating a real title → it strips only a LEADING frame run; the
   field is `undefined` at the source, so nothing is stripped.
2. The webview pane-evidence reporter failing to forward titles → the chain
   `reportTitle → PaneEvidenceStore.report → pane.title` is wired end to end
   (`src/webview/main.ts:129`, `src/session/PaneEvidenceStore.ts:147-165`); there is
   simply no title to forward.
3. A failed registry read → the read returns `kind: "ok"` and the external rows DO
   render (with the `other window` chip). Only the name is missing.

## Not settled by this run

Which name a row should show is a product choice, not a fact the evidence decides:

- **registry `name`** (`~/.claude/sessions/<pid>.json`) — claude's own session name,
  user-visible, stable, already read once per rebuild. Claude-only; codex/opencode
  panes would stay untitled.
- **vault title** — `VaultSessionSummary.customName ?? title` (`src/vault/types.ts:216,245`),
  what the Vault list already shows. Works for every agent the vault reads and honours a
  user rename, but costs a vault read per row.

Also observed while reading: `WorktreeAgentRow.preview` and `.model`
(`src/worktree/presenceTypes.ts:66,68`) have no producer anywhere either — the tree view
renders both (`worktreeTreeView.ts:378-400`) and they are always empty. Same class of
gap, not part of this repro.

## Scope

`src/worktree` for the projection; `src/vault/readers/runningSessions.ts` if the registry
name is the chosen source.

## Side-effect risk

`worktreeRenderSignature.ts:87` folds `stripDecorations(r.title)` into the render
signature — giving rows a title that changes (a rename, a vault re-read) starts
re-rendering the tree on that change. A per-poll-changing title would repaint at poll rate.

## The fix (verified)

Reporter's choice: registry name first, vault title as fallback.

- `src/vault/readers/runningSessions.ts` — `RunningClaudeSession.name`, parsed from the
  registry file, trimmed, bounded at `MAX_SESSION_NAME_CHARS` (200), absent rather than
  `""` when the field is missing/blank/not a string. `RunningSessionIndex` gains
  `bySessionId`, so a caller holding the id a resolution returned reads the rest of that
  record without re-scanning.
- `src/worktree/agentIdentity.ts` — `SessionLookup`/`IdentityOutcome` carry the resolved
  session's `name` alongside `entryId`, spread into every proven outcome so a rank-1
  launch pane sitting on a resolved session is titled too.
- `src/worktree/presenceDeps.ts` — `resolve()` reads the name off the index the
  resolution already consulted; a titled pane costs no read of its own.
- `src/worktree/presenceProjector.ts` — window rows take `identity?.name ?? pane.title`;
  external rows take `session.name`; a new optional `sessionTitle(entryId)` dep fills any
  row the registry left unnamed, memoized per session for the life of the window, evicted
  against the live row set, and swallowing its own read failure.
- `src/extension.ts` — `sessionTitle` wired to `vaultService.getEntry`, `customName || title`.

Verified: `--reconfirm` (repro RED with the fix stashed, GREEN with it), regression
`bun run test:unit` 4340 tests green, `tsc --noEmit` clean.

## What this run did NOT fix

- **Non-claude panes stay untitled.** Rank 2 answers `claude` only, so a codex/opencode/
  cursor pane has no `entryId` and therefore neither a registry name nor a vault fallback
  to reach. It still shows the pane's terminal title or the placeholder. Closing that needs
  rank 3 (process recognition), which `docs/PLAN.md` defers.
- **A rename after the first vault read** does not reach the row until the window reopens.
  Registry-named rows never pay this; the fallback trades it for one read per session.
- `WorktreeAgentRow.preview` / `.model` still have no producer.

## Unrelated drift found

`bun run lint` (`biome check --write --unsafe src/`) rewrote three files this change never
touched, one of them a **behaviour change**: `ASCII_FRAME` in
`src/webview/worktree/worktreeFormat.ts:23` went from `/^[|/\\-]\s+/` to `/^[|/-]\s+/`,
dropping `\` — a documented spinner frame — from the class. All three were reverted.
