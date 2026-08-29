# Audit — Worktree view vs Orca reference (visual + UX)

Run 2026-08-29 against HEAD (`1f3abc7d`), comparing the shipped Worktree view and its
create dialog with Orca reference screenshots supplied by the user (projects list,
filter popover, create dialog). Code claims are grep-verified at HEAD; screenshot
claims describe the user's running build. **Nothing here is fixed** — this file exists
so the findings survive.

Severity split: § A is a bug at HEAD, § B is comparative UX debt worth paying,
§ C is what Orca has that PLAN.md defers *by design* (not debt), § D answers the
three open UX questions raised in the same session.

---

## A. Bug — `hidden` is silently defeated by author CSS

### A1. "This folder only" and the toolbar "+" ignore their `hidden` toggles

`VaultPanel.syncView()` already does the right thing:

- `VaultPanel.ts:528` — `this.folderToggleEl.hidden = worktree` (hide the checkbox in
  the Worktree view; the tree is already folder-scoped, so the filter has nothing to
  scope).
- `VaultPanel.ts:531` — `this.createWorktreeBtn.hidden = !worktree` (show "+" only in
  the Worktree view).

Both are dead. The UA rule `[hidden] { display: none }` is user-agent origin; any
author-origin `display` on the same element overrides it regardless of specificity:

- `vaultPanel.css:254` — `.vault-folder-toggle { display: inline-flex; … }`
- `vaultPanel.css:123` — `.vault-header__search-btn { display: inline-flex; … }`
  (the class the create button reuses, `VaultPanel.ts:447`)

No stylesheet in `src/` or `media/` declares a `[hidden]` reset (grep: zero hits).

**Effect:** the checkbox stays visible — and checked — while the Worktree view is
active (confirmed by the user's screenshot), and the "+" is visible in the three
session views where it has no meaning.

**Why no test caught it:** `VaultPanel.test.ts` asserts nothing about either
element's `hidden` state, and jsdom asserts the *property*, not computed style, so a
property-level test would still pass while the pixel lies.

**Fix shape:** one `[hidden] { display: none !important; }` reset in the shared
stylesheet, plus a check that other `hidden` writers in the webview aren't relying on
the same broken mechanism. `statusEl` (`VaultPanel.ts:529`) happens to work only
because `.vault-status` sets no `display` (`vaultPanel.css:281`).

---

## B. Comparative findings — where Orca reads better

### B1. Flat, same-weight rows bury the two live worktrees under twelve dead ones

The user's own screenshot demonstrates it: `main` and `huybuidac/hadern-analysis`
(the rows with agents) sit above ~12 idle `worktree-agent-*` rows rendered at
identical visual weight, names hard-truncated. Orca solves this with a "Hide
sleeping" filter; PLAN.md defers the filter popover, but the 80% fix needs no
popover: **dim agent-less rows** or gather them under one disclosure row
("12 idle worktrees ▸"). Cheap, no protocol change.

### B2. One hollow-circle glyph for every state

Working, idle, and unknown all render the same ○. Orca's status column (green check
/ amber / red dot) is scannable in one second. WT-002.1's own acceptance says "state
is legible by shape alone" (PLAN.md:169) — at the row level that currently holds for
*row kind*, not for *activity*, and activity is the thing a user scans for.

### B3. Agent rows carry no last-activity preview

Orca shows one truncated line of the agent's last message plus relative time
("Xong. Sweep sạch: mọ… · 5m"). Our rows show title + time only. The hook pipeline
(WT-006.3, done) already distinguishes turn states; a last-status line is the
cheapest glanceability win left.

### B4. Two visual languages in one list

Agent-bearing rows get card backgrounds; the idle tail is flat rows. Nothing tells
the user *why* the top two are special — the emphasis reads as selection, not as
"has agents". Pick one: either every worktree is a card, or presence is expressed
inside a uniform row (glyph + count), not by changing the row's container.

### B5. Create dialog is git-plumbing-first

The absolute path appears twice (field + collision paragraph) in a dialog whose tree
view never shows a path (WT-002.1 acceptance: "no row exposes a filesystem path",
PLAN.md:169). The Agent/Permissions/First-prompt block is always visible while
"After creating" says **Nothing** — contradictory. Orca: smart single input,
`Advanced ∨` collapsed, path never shown. Keep our path transparency (it is a
WT-005.2 safety property — the host states the free path it will take) but compress:
one shortened resolved-path line with full path on hover, and reveal the agent block
only when "After creating" ≠ Nothing.

### B6. Possible duplicate agent row (needs repro)

The screenshot shows `main` with **two identical rows**: same title
("18 vòng review trong session e49fe5a3"), both "now". Two panes resuming one
session would legitimately render twice; one pane counted twice would violate
WT-004.0 ("surfaces reporting the same pane agree", PLAN.md:223). Not judged here —
reproduce with the pane list open before calling it either way.

---

## C. Orca features that are deferred by design — not debt

All already recorded in PLAN.md's Deferred section (PLAN.md:390-405): the filter
popover (hide sleeping / default branch / automation-created), group-by and sort-by,
create-from-issue/PR/URL, and Orca's "Run on" machine picker (out of scope entirely
— this extension is single-host). Losing these comparisons is a decision, not a gap.
B1 above is the one place the deferral leaks: the *reason* for "hide sleeping"
exists today even though the popover doesn't.

---

## D. The three open UX questions

### D1. Hide "This folder only" when the Worktree segment is active

Already the shipped intent — see A1. The work item is the CSS `[hidden]` fix, not a
behaviour change.

### D2. Should Worktree be separated from the three session segments?

Yes — the current control mixes two semantics in one row. Recent/Agent/Folder are
**grouping modes of one body**; Worktree **swaps the body**. The design doc says so
itself ("a fourth segment that swaps the panel body, not a fourth grouping mode",
worktree-panel-ui.md § 2), and the width squeeze is the visible symptom: four
segments no longer fit, so CSS drops labels on unselected ones
(`VaultPanel.ts:417-419`).

| Option | Shape | Cost | Verdict |
|--------|-------|------|---------|
| Status quo | 4 flat segments | 0 | Semantic mismatch + label squeeze stay |
| **Two-level** | Primary `Sessions \| Worktrees` toggle; Recent/Agent/Folder becomes a grouping control shown only in Sessions (compact segmented or dropdown) | Persisted-state migration is trivial — `view` and `groupMode` are already independent keys (worktree-panel-ui.md § 2.1) | **Recommended** — honest semantics, labels fit again, Worktree gains toolbar room for its own controls ("+", future filter) |
| Separate sidebar view | Worktree leaves the vault panel | High | Contradicts the shipped D-decision that it is the vault's fourth segment; not worth reopening |

Orca avoids the problem by having only one body (projects) with grouping in a
popover — closer to the two-level shape than to ours.

### D3. Where does "Create worktree" go?

The toolbar "+" already exists, Worktree-view-only by intent
(`VaultPanel.ts:444-452`) — currently leaking into session views via A1. Placement
recommendation, in addition to fixing A1:

1. **Keep the toolbar "+"** as the primary affordance (matches VS Code view-title
   conventions; Orca's is the same top-right `+`).
2. **Per-repo-group hover "+"** on the group header row. The dialog needs a repo
   anyway in multi-repo workspaces; launching from the group pre-answers it and
   matches the native SCM view's per-repo actions.
3. **Empty-state CTA** — the "no worktrees yet" state should carry the create button
   in the body, not ask the user to find a 20px icon in the toolbar.
4. Context menu "New Worktree…" already exists on rows — keep, it is the
   discoverable path for keyboard/menu users.

---

## E. Second pass — badges, tooltips, spinner (2026-08-29, same HEAD)

### E1. `here` and `LOCKED` mean what, and why two `here`s

| Mark | Source | Meaning |
|------|--------|---------|
| `main` pill | `worktreeFormat.ts:94-96` — `info.kind === "main"` | The repository's main worktree |
| `here` pill | `worktreeFormat.ts:97-99` — `info.inWorkspace` | A **workspace folder** is this worktree or lies inside it (`WorktreeDiscovery.ts:172-174`) |
| `LOCKED` badge | `worktreeFormat.ts:110-112` — `info.locked` | `git worktree lock` is set; `prune` will skip it. Reason, when git gives one, is in the badge's tooltip |

Two `here` badges is **correct, not a bug**: a multi-root workspace with two
folders open — the repo root and one worktree — makes both `inWorkspace`. What is
wrong is the *word*. "here" reads as "the pane you are in", so two of them looks
like a contradiction. The tooltip says the real thing ("This worktree is a
workspace folder", `worktreeTreeView.ts:177`) but the tooltip does not render
(E2). Rename to `open` / `in workspace`, or split into two distinct marks if
"the active pane's worktree" is worth its own pill.

### E2. Every tooltip in the Worktree view is dead

The view sets 16 `title` attributes (`worktreeTreeView.ts:100,114,142,177,185,221,239,272,348,365,383,392,400,492,523`), including the
one that answers the path question: `row.title = worktreeTooltip(info)`
(`worktreeTreeView.ts:142`), whose text is branch + `displayPath` + lock reason +
"directory is missing" (`worktreeFormat.ts:203-212`).

None of them appear, and the codebase already knows why. `src/webview/ui/Tooltip.ts:3-5`
states it outright: *"Native browser `title` tooltips don't render reliably inside
VSCode webviews (long OS-dependent delays; some platforms suppress them)"* — which
is why `attachTooltip()` exists, with a 300 ms delay, body-mounted so no
`overflow: hidden` clips it, and `aria-describedby` for screen readers.

Who uses it: `FileTreePanel.ts` (6), `previewHeader.ts` (3), `VaultPanel.ts` (2),
`renderAtoms.ts` (1). Who does not: **the entire Worktree view, and the vault's
session list** (`vaultListView.ts:76,100,114,145,290` are all raw `.title =`) —
which is exactly the set of surfaces the user reports as having no hover hint.

**Fix shape:** route the worktree tree's rows through `attachTooltip`, disposing
with the row. The content already exists and already includes the real path, so
this is a delivery fix, not new information. Note the design's "no row exposes a
filesystem path" rule (worktree-panel-ui.md § 3.2) explicitly carves the tooltip
out as one of the two places the path does live — showing it on hover is the
design, not a deviation from it.

### E3. The spinner has no ceiling — a pane can spin forever

Chain, HEAD:

1. `explainLiveActivity` (`paneEvidence.ts:113-127`) returns `running` when
   `semanticWorking || outputActive`.
2. `outputActive` is *any* output inside `OUTPUT_IDLE_WINDOW_MS = 1500`
   (`paneEvidence.ts:19`, `PaneEvidenceStore.ts:250`).
3. `readActivity` (`presenceProjector.ts:646-669`) lets a **fresh** hook report
   override inference, where fresh means `< TURN_FRESHNESS_MS = 60_000`
   (`PaneEvidenceStore.ts:87`, `presenceProjector.ts:629-635`).
4. `.wt-state--running` is `animation: wt-spin 0.9s linear infinite`
   (`worktreePanel.css:214`).

So the only thing that ever stops the spin is 1.5 s of pty silence. An agent TUI
that animates its own spinner emits output continuously, so `outputActive` never
falls — and once the hook report ages out at 60 s, inference takes back control
and keeps it spinning indefinitely. There is **no upper bound anywhere**: nothing
in `src/` caps how long a row may claim `running`.

Worse for truthfulness: after 60 s the row is spinning on *the agent's animation*,
not on evidence of work. That is the failure mode WT-004.1's acceptance names
directly — "never from a spinner" (PLAN.md:237) — currently enforced for
*identity* but not for *activity*.

**Fix options, cheapest first:**

1. **Webview-side ceiling.** `row.stateStartedAt` already reaches the view
   (`worktreeFormat.ts:40-42`), so a row whose `activitySource !== "hook"` and
   whose `stateStartedAt` is older than N minutes can render a static
   "working (unconfirmed)" glyph instead of an animation. No protocol change, no
   host change, and it degrades honestly rather than lying quietly.
2. **Raise the bar for inferred `running`.** Require sustained output rather than
   any output in a 1.5 s window — a pure animation has a tiny, regular byte
   volume that a threshold can distinguish from real work.
3. **Keep the hook report authoritative for longer while a turn is open.** A
   `working` report expiring at 60 s is right for *staleness* but wrong for a
   long tool call that emits no events; a heartbeat, or a longer freshness window
   for `working` specifically, closes it. Needs a spec delta.

Option 1 alone answers the user's ask ("5 minutes with nothing new → stop
spinning") and is the only one with no contract change.

### E4. Related: the same 1.5 s rule drives the terminal tab indicator

`OUTPUT_IDLE_WINDOW_MS` is shared (`shared/paneEvidence.ts`), so whatever ceiling
lands must be applied where both surfaces read it, or the worktree row and the tab
will disagree — which WT-004.0's acceptance forbids ("the worktree row and the
terminal tab derive running from the same rules and cannot disagree",
PLAN.md:223).

---

## F. Redesign round — feasibility + scope decision (2026-08-29)

The Claude Design overhaul landed as the new `docs/ui/worktree.html` (12 scenes:
workbench compositions ×3, state vocabulary, sessions second level, degraded,
empty, skeleton, create ×2, remove, refusals). Feasibility was checked against the
shipped architecture before accepting the direction.

### F1. The composition is one webview — nothing opens in the editor

The whole workbench the mockup draws already lives in a single extension-owned
webview: `webviewHtml.ts:689-703` renders `#tab-bar`, `#terminal-container`
(xterm), and `#vault-panel` in one DOM, identical across sidebar / panel / editor
(`data-terminal-location` is the only difference). "Select a worktree → scope the
tabs" is therefore an internal filter over the extension's own tab list — no
VS Code editor or native-terminal API involved. Pane→worktree attribution already
exists (WT-004.1 presence).

Layout caveat: the two-column rail+terminal composition fits the **panel** and
**editor** locations. The **sidebar** (~300 px) keeps the stacked layout; a
worthwhile sidebar behaviour is rail auto-collapsing after selection
("choose → view"), giving the same mechanism two location-appropriate feels.

### F2. Decision — scope model 1 (self-scoped, single surface). ACCEPTED

Selecting a worktree scopes **that surface's own tab bar**. Scope is per-surface
state (sidebar on `main` while the panel is on a feature worktree is legal and
useful). No new protocol; no new concepts.

One mockup gap to carry into implementation: a pane outside the current scope can
go `waiting` invisibly. The "All" escape chip needs an attention badge
("All · 2 ●") so an out-of-scope agent asking for approval is never silent.

### F3. Considered, out of scope for this round

| Model | Shape | Why deferred |
|-------|-------|--------------|
| 2 — Cross-surface sync | Sidebar rail broadcasts `scopeChanged` via the host; other surfaces follow | Technically fine (host-as-hub RPC exists, WT-001.2 / WT-004.0 pattern) but semantically expensive: panes belong to one surface, so a sidebar "remote control" needs a *primary terminal surface* concept, and multi-panel/editor fan-out needs a policy. Revisit as an opt-in "Sync scope across surfaces" setting — with a shared host-held scope every surface follows, no primary needed |
| 3 — Editor tab per worktree | Selecting a worktree opens/focuses a dedicated AT editor tab | Closest to Orca's feel but proliferates tabs, and the editor surface is second-class today — 15 of 16 vault messages unhandled there (2026-08-26-editor-provider-gaps.md A1). That debt must be paid before any default UX bets on the editor. Acceptable later as a manual "Open worktree as tab" action, never as the selection default |

### F4. Doc/plan follow-ups the accepted direction forces

- `worktree-panel-ui.md` § 2 defines the view as the vault's *fourth segment*;
  the accepted layout demotes sessions to a second-level toggle and adds the
  scoped tab bar — a spec rewrite, not a drift note.
- Tab-bar scoping is outside every existing WT-* task; it needs its own PLAN.md
  entry (new message family for scope state is webview-local under model 1, but
  the tab bar's join against pane→worktree attribution still needs a task and
  acceptance of its own, including the out-of-scope-waiting badge).
- The A1 `[hidden]` CSS fix and the E2 tooltip routing remain valid regardless of
  the redesign and should not wait for it.
