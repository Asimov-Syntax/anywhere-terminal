# Design brief — "Create worktree" dialog (Anywhere Terminal)

## What you are redesigning

The **Create worktree** modal in a VS Code extension sidebar (webview, dark theme, narrow —
assume ~420–520px content width). A developer uses it to spin off an isolated checkout of the
current repo, usually to run an AI coding agent in it while the main checkout stays untouched.

The existing dialog has: `Branch name` (bare text input) → a derived destination path preview →
`After creating` (a `<select>`: Nothing / Open folder / Start an agent) → a collapsed `Advanced`
holding Base ref, Branch source, and Path override.

## What is wrong with it now

1. The destination path is rendered in **editor monospace and wraps across three lines**, so a
   piece of confirmation metadata becomes the visual subject of the dialog.
2. The collision notice is a **long monospace paragraph** ("…/x already exists, so this is created
   as x-2") that repeats the full path a second time.
3. **No branch search.** The user types a branch name blind, with no idea what already exists.
4. The **path override is buried in Advanced**, so anyone who needs a non-default location must go
   hunting for it.
5. Nothing in the dialog acknowledges that a fresh worktree is **born unusable** — no `.env`, no
   `node_modules`, no local config. That is the single biggest real-world pain and the form is
   silent about it.

## Design principles for this dialog

- **Branch first, destination second, path third.** The branch defines the worktree; the path is
  confirmation. Mirror VS Code Quick Open's hierarchy: name prominent, directory as secondary
  metadata, full value on demand.
- **Never let a path grow the modal vertically.** One line, always.
- **Monospace is for editable or copyable values only** (`--vscode-editor-font-family`). A passive
  preview uses the proportional UI font in `--vscode-descriptionForeground`.
- **Native VS Code, not a bolted-on web app.** Use only `--vscode-*` theme tokens — no hard-coded
  charcoal/blue, no rounded marketing cards, no heavy shadows, no second color system. ~8px control
  gaps, 12–16px section gaps, labels directly above inputs, single column, 28–32px control height,
  one primary footer button.
- **Amber is "this will be resolved for you." Red is "this blocks creation."** Do not use red for a
  name collision that the dialog already knows how to fix.
- **Never silently rewrite what the user typed.** Suggest the resolved name; let them accept it.

## Required layout

```
Create worktree                                                            [×]

Branch / source
[ Search branches, or type a new branch name                           ▾ ]
    ┌ dropdown ─────────────────────────────────────────────────────┐
    │ RECENT                                                        │
    │   ✓ main                                    Local · current   │
    │     feat/vault-privacy                      Local             │
    │ REMOTE                                                        │
    │     origin/release/1.4                      Remote            │
    │ ───────────────────────────────────────────────────────────── │
    │   + Create new branch "feat/search" from main                 │
    └───────────────────────────────────────────────────────────────┘

Base: main                                                        [Change]

⚠ feat-search already exists — will use  feat-search-2           [Use name]

Destination   Automatic                    …/anywhere-terminal/feat-search-2
                                                     [Edit] [Copy] [Reveal]

Bring over                                              2 copied · 1 linked
  ✓ Run setup            bun install && bun run db:migrate    asimov/worktree.yaml
  ✓ Allocate 2 ports                                    ASIMOV_PORT_APP, _DB
                                                              [Configure…]

□ Move my uncommitted changes into the new worktree            (7 files)

After creating
( ) Nothing        ( ) Open folder        (•) Start an agent

  ┌───────────────────────────────────────────────────────────────────┐
  │ Agent        [ Claude Code                                     ▾ ] │
  │ Permissions  [ Ask before edits                                ▾ ] │
  │ First prompt                                                       │
  │ [ Sent once the agent's composer is ready…                       ] │
  │                                                            0/2000  │
  │ ☑ Wait for setup to finish before starting the agent               │
  └───────────────────────────────────────────────────────────────────┘

› Advanced   Branch source · Base ref · Path override

                                            [Cancel]  [Create worktree ⌘↵]
```

## Component-by-component requirements

### Branch / source — one combobox, not tabs

A single editable combobox. Typing filters; sections are `RECENT`, `LOCAL`, `REMOTE`, each row
carrying a right-aligned muted badge. The **last** result is always the free-text escape hatch:
`+ Create new branch "<typed>" from <base>`.

Do **not** draw a tab bar (Smart / GitHub / Branch / Name). In a narrow modal, tabs cost vertical
height, split keyboard search across four lists, and force a mode decision before the user is
allowed to type. One omnibox that both searches and creates is the Linear / VS Code pattern.

Also draw: a row for a branch **already checked out in another worktree**, shown disabled with the
directory name as its badge — git permits only one worktree per branch, and the user should see why
a row is unavailable rather than discover it at submit.

### Base — compact, not a full row

A single muted line `Base: main` with a secondary `[Change]`. It matters but is almost always
correct. `Change` opens the same combobox styling.

### Collision — one line, field-local, amber

Directly under the branch field. An amber warning icon, one short sentence, the resolved name in an
**inline code chip**, and a secondary `[Use name]` action. Do not repeat the full path — the
Destination row below already updates to the resolved tail. Never auto-replace the input's value;
only `[Use name]` does that.

### Destination — one line, breadcrumb tail, badge + Edit

Read-only by default. A small `Automatic` badge sits next to the label; the value is a
single-line, end-weighted breadcrumb of the last 2–3 segments (`…/anywhere-terminal/feat-search-2`)
in the proportional UI font, muted, `text-overflow: ellipsis`, never wrapping. Full path is
available via tooltip on hover **and focus**, plus icon buttons `[Edit] [Copy] [Reveal]` (each with
an accessible name).

`[Edit]` swaps the line in place for a monospace single-line input, flips the badge to `Custom`, and
reveals a `Reset to automatic` text button. Show validation (invalid path, non-empty directory,
already a worktree) immediately under that input, not at submit. Draw all three states:
**Automatic**, **Custom**, and **Custom + invalid**.

The Advanced drawer may still list `Path override`, but it must be the *same* value — `[Edit]`
opens and focuses that row. Two routes, one value.

### Bring over — the new section, and the point of this redesign

A fresh `git worktree add` carries **tracked files only**. No `.env`, no `node_modules`, no local
agent config. This section is where the dialog stops pretending that is fine.

It is a **summary with a link out**, not a file editor. Show:

- A right-aligned summary chip: `2 copied · 1 linked` (or `Nothing configured`).
- `✓ Run setup` — a checkbox, the resolved command in a truncated monospace chip, and a muted
  **source badge** naming where it came from (`asimov/worktree.yaml`, or a VS Code task with
  `runOn: worktreeCreated`).
- `✓ Allocate N ports` when configured, listing the env var names it will inject.
- A secondary `[Configure…]` opening the repo's config — the dialog never becomes a settings editor.

**Empty state matters as much as the populated one.** When nothing is configured, this section must
still appear, as a single quiet row: *"This worktree will have no `.env` or `node_modules`."* with a
`[Set up…]` action. Silence here is what produces a broken worktree.

**Copy is the default; link is the deliberate exception.** A worktree should own a mutable local
overlay of `.env`-style files: if a file is linked, an agent editing it inside the worktree writes
straight through to the main checkout, and every other worktree sees the change. So the summary chip
must state which paths are copied and which are linked, and linked paths carry a small muted
`writes to main` note. The per-path choice lives in the repo config, not in this dialog — but the
consequence must be legible here, before the user hits Create.

### Move uncommitted changes — conditional row

Only render when the main checkout is dirty. A checkbox with the file count as a muted suffix:
`Move my uncommitted changes into the new worktree   (7 files)`. Hide the row entirely when clean —
do not draw a disabled checkbox.

### After creating — segmented radios, not a select

Three mutually exclusive options as a segmented radio group: `Nothing`, `Open folder`,
`Start an agent`. A `<select>` hides the fact that a whole configuration panel lives behind the
third option. Selecting `Start an agent` reveals the bordered sub-panel below it.

Inside that panel, `Wait for setup to finish before starting the agent` is **only enabled when
`Run setup` is checked** — draw the disabled state too.

### Setup failure is not a create failure

Draw one extra state: the dialog has closed successfully and setup **failed**. Setup runs after the
worktree exists, and a failed setup must never be reported as a failed create or trigger a rollback.
Show this as a persistent notification/row on the created worktree — a warning icon, one line, and
two actions: `[View output]` and `[Retry setup]`.

### Create from a pull request

A PR is a source, **not a fifth tab**. It lives inside the same combobox: when the typed text is a
PR number (`1234`, `#1234`) or a PR URL, the dropdown grows a `PULL REQUESTS` section above the
branch sections:

```
[ #1234                                                                ▾ ]
    ┌───────────────────────────────────────────────────────────────┐
    │ PULL REQUESTS                                                 │
    │   #1234  Fix vault privacy leak            octocat  · open    │
    │          → pr/1234, base main                                 │
    │ LOCAL                                                         │
    │     feat/1234-retry                                           │
    └───────────────────────────────────────────────────────────────┘
```

Requirements:

- The PR row must show **number, title, author, and state**, and a muted second line naming the
  branch it will create and its base — the user is choosing a checkout, so tell them what they get.
- A PR from a **fork** needs an extra remote. Show that as a muted note on the row
  (`adds remote fork-octocat`), not as a surprise during creation.
- Draw the **not-authenticated** state: one quiet inline row with a `[Sign in to GitHub]` action, and
  branch search still fully working underneath. PR support must never block ordinary use.
- Draw the **loading** state — PR lookup is a network call and is slower than the local branch list.

### Remove worktree — a separate, differently-shaped dialog

Also design the **removal confirmation**. It is the more dangerous surface and currently has almost
no design. It is *not* a mirror of the create dialog: creation is a form, removal is a **report the
user reads before agreeing**.

```
Remove worktree                                                            [×]

  feat/search                          …/anywhere-terminal/feat-search-2

  ✓  No uncommitted changes
  ✓  Branch merged into main
  ⚠  2 terminals still running in this folder
  ⚠  Agent "Claude Code" is active here

  □ Also delete branch feat/search

  ─────────────────────────────────────────────────────────────────────
  Type  feat-search-2  to confirm

  [                                                                    ]

                                              [Cancel]  [Remove worktree]
```

Requirements:

- **Show every check, including the ones that passed.** A green list of satisfied conditions is what
  makes the two warnings legible. Never reduce this to a single "Are you sure?".
- Checks to represent: uncommitted/untracked changes (with a count), whether the branch is merged
  into the default branch, running terminals in the folder, a live agent, and whether the worktree is
  **locked** (git needs a second `--force` for a lock — say so rather than failing).
- **Fail closed.** When a condition cannot be *proven* — the merge state is unknown, a process owner
  cannot be identified — render it as an unknown (`?`) and treat it as blocking, not as a pass.
- The typed-name confirmation appears **only when a check failed**. A clean, merged, idle worktree
  should be removable with one click; a dirty one should cost the user a deliberate act.
- `Also delete branch` is **unchecked by default** and disabled with an explanatory note when the
  branch is unmerged. Deleting a worktree and discarding commits are different decisions.
- Draw a **partial-failure** state: the worktree could not be unregistered, so the directory was left
  in place. Say exactly what remains and offer `[Retry]` and `[Reveal]`. Never claim success.

## Screens to deliver

1. **Default** — empty branch field, nothing configured, clean repo.
2. **Typed + collision** — text entered, amber hint visible, Destination showing the resolved tail.
3. **Fully configured** — dropdown open with all three sections and the create-new row.
4. **Start an agent** — agent sub-panel expanded, `Wait for setup` enabled.
5. **Custom destination** — `[Edit]` active, monospace input, `Custom` badge, `Reset` visible.
6. **Advanced expanded**.
7. **Setup failed** — the post-create warning state.
8. **Empty "Bring over"** — the `[Set up…]` prompt.
9. **Repository row present** — multi-repo workspace.
10. **Pending destination** — resolving, Create disabled.
11. **PR search** — `PULL REQUESTS` section with a fork row.
12. **PR not authenticated** — sign-in row, branch search still usable.
13. **Remove — clean** — all checks pass, no typed confirmation, one click.
14. **Remove — blocked** — warnings, unknowns, typed confirmation, branch checkbox disabled.
15. **Remove — partial failure** — directory left behind, Retry/Reveal.

## Explicitly out of scope

Remote execution host ("Run on"), Linear/Jira **issue**-driven creation and create-from-URL, VM
recipes, default terminal tabs, batch "Create more", and sparse checkout. (Creation from a GitHub
**pull request** is in scope — see above.) These belong to a multi-project
orchestrator; this dialog serves one VS Code workspace.

Note this is **not** the same as a repository selector — see below, which is in scope.

### Repository — conditional first row

A VS Code workspace can hold more than one repository. When it does, the dialog opens with a
`Repository` select above `Branch / source`, with the repo's main-checkout path as a muted hint
beneath it. When the workspace holds exactly one repo, the row is **not rendered at all** — no
disabled control, no single-option select. Draw both cases.

Switching repository re-derives the destination and re-fetches the branch list.

### Async and pending states

The destination is resolved by the extension host, not computed in the form, so it can lag behind
typing. Draw:

- **Destination pending** — a muted skeleton or `Resolving…` on the destination line, with the
  primary `Create worktree` button **disabled** until an answer arrives. The form must never state a
  destination it has not confirmed.
- **Branch list loading** — the combobox in a loading state while refs are fetched, still typeable.
- **Branch list failed** — one quiet inline row offering `Retry`, with free-text branch creation
  still available.

### Cross-platform

Symlinks need Developer Mode or elevation on Windows, and APFS clone-copy is macOS-only. Any UI
string about linking must degrade honestly: on Windows the `link` affordance shows a muted
`copied on Windows` note rather than promising a symlink.
