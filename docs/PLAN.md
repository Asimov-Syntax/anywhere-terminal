# Implementation Plan — Worktree-First Workbench

> **Consumer**: `asimov-plan` — reads one task, reads its linked design doc, scans the codebase, triages a lane, then writes `asimov/changes/<change-id>/`.
> **Rule**: tasks describe WHAT and WHERE, never HOW. No source-file paths, no function names, no test commands. (Design Ref links to `docs/` are the WHERE, and are required.)
> **Status lifecycle**: blueprint writes `todo` → asimov-plan sets `in_progress` after Gate 2 → asimov-build sets `done` after implementation approval.

**Scope**: the remaining Worktree-view work identified by
`docs/audit/2026-08-29-worktree-ui-vs-orca.md` — the truthfulness ceiling on inferred activity,
the glanceability findings, and the worktree-first workbench redesign.

`docs/PLAN.v4.md` is the shipped record of WT phases 0–7 (discovery, panel shell, live tree,
agent presence, actions, hook pipeline, hardening). Its task IDs remain the tracker keys for
that work; this plan continues the same `WT` epic from Phase 8 and Stage 6.

Closed by the change archived as `restore-view-affordances` and not re-planned here: the
`[hidden]` CSS reset (audit § A1), the `here` → `open` pill rename (§ E1), routing the Worktree
view and the vault session list through the delegated tooltip widget (§ E2), and § D1, which was
the same CSS fix. Audit § B6 (a possibly duplicated agent row) was **dropped by the user** without
reproduction and is not planned. Audit § C is deferred by design, not debt.

## Sync contract

Task heading is `### [WT-<NNN>.<M>]` — epic code, three-digit phase number, task number. The ID is
the tracker sync key: it goes in the issue title and never changes once an issue exists, even when
the task moves phase.

| Field | Type | Notes |
|-------|------|-------|
| **Epic** | code | Carried by the ID prefix; one per plan. `WT` here |
| **Goal** | 1–2 sentences | What this task produces |
| **Design Ref** | links | The section that specifies it |
| **Depends On** | ID list | Comma-separated, or `None`. Becomes `blocked-by` |
| **Stage** | 6–7 | Ship order — what the user can do once it lands. Cuts across phases. Becomes the GitHub milestone |
| **Size** | XS / S / M / L / XL | Complexity + review load, not duration. XS: one concern, no contract change. S: one concern with its own tests/edge cases. M: feature slice across a few modules, or one new contract. L: cross-boundary, security-sensitive, or a heavy acceptance list. XL: split it |
| **Labels** | slug list | `new-api-contract`, `data-migration`, `security-privacy`, `infra`, `new-dependency`, `cross-boundary`, `user-visible-ui`, `re-review`. Or `None` |
| **Notes** | optional | Risk or reuse signal `asimov-plan` cannot see before reading code. Omit when nothing applies |
| **Acceptance** | `; `-separated | Observable outcomes only — the mechanism lives in the design doc. Each item becomes one checklist entry on the issue |
| **Status** | todo / in_progress / done | |

Phase = build order; Stage = ship order; `Depends On` is the only structural relation;
`Stage(task) ≥ Stage(dep)`.

## Design References

| Doc | Scope |
|-----|-------|
| [DESIGN.md](DESIGN.md) § 8–10 | Subsystem architecture, decisions, consistency registry |
| [design/worktree-panel-ui.md](design/worktree-panel-ui.md) | Panel body, two-level toggle, row anatomy, idle tail, inspector, state vocabulary |
| [design/worktree-scope.md](design/worktree-scope.md) | Scope model, the tab-bar filter, the All chip and its attention badge, layout by location |
| [design/worktree-activity-ceiling.md](design/worktree-activity-ceiling.md) | The confirmation ceiling on inferred `running` |
| [design/worktree-actions.md](design/worktree-actions.md) § 3.2.1–3.2.2 | Create form presentation and where create is offered |
| [design/worktree-agent-presence.md](design/worktree-agent-presence.md) | Evidence model the rows and the scope join both read |

**Reference artifact**: `docs/ui/worktree.html` is the visual reference for Phase 10. It is
uncommitted at the time of writing and **cannot render** — its entire `wk-*` design language
lives in a `worktree-workbench.css` that exists nowhere in the repo. Commit it as the reference
only once it renders standalone; a reference no reviewer can open is not one. Where it and a
design doc disagree, [worktree-panel-ui.md](design/worktree-panel-ui.md) § 7.7 records the
resolution.

## Phases Overview

```mermaid
flowchart LR
    P8[P8<br>Truthful activity] --> P9[P9<br>Glanceability]
    P8 --> P10[P10<br>Worktree-first workbench]
    P9 --> P10
```

| Phase | Est. | Key Deliverable |
|-------|------|-----------------|
| P8 — Truthful activity | ~2-3d | Every state is legible by shape, and a row stops spinning once nothing has confirmed it |
| P9 — Glanceability | ~4-6d | The list surfaces the two worktrees that matter, each row says what just happened, and creating one is a worktree question rather than a git one |
| P10 — Worktree-first workbench | ~9-13d | Selecting a worktree scopes the surface to it, behind a setting until the composition is whole |

| Stage | What the user gets |
|-------|--------------------|
| 6 | A list that can be scanned in one second and rows that stop overstating |
| 7 | Pick a worktree and the workbench follows it |

> P10 is detailed here because its design is settled, not because it is next. Per the revision
> rule, reassess it against what P8 and P9 actually shipped before planning its first task.

---

## Phase 0 — Prerequisites

**Empty, deliberately.** This is a re-baseline of a shipped subsystem inside a released
extension. Every dependency — git, the built-in `vscode.git` extension, the hook runtime, the
release path — is already in place and already proven by the work in `docs/PLAN.v4.md`. There is
nothing to provision.

---

## Phase 8 — Truthful Activity

> **Goal**: the state vocabulary carries meaning by shape, and no row claims work on evidence that has stopped moving.

### [WT-008.1] State Legible by Shape

| Field | Value |
|-------|-------|
| **Goal** | Give every activity state its own shape in the tree, so working, waiting, idle, unknown, and exited are distinguishable at a glance and without colour |
| **Design Ref** | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 7.2, § 3.2, § 3.3 |
| **Depends On** | None |
| **Stage** | 6 |
| **Size** | S |
| **Labels** | user-visible-ui |
| **Notes** | WT-002.1's acceptance already claimed "state is legible by shape alone"; at HEAD that holds for row kind, not for activity, which is the thing users scan for. This settles the glyph shapes § 7.6 leaves to the building task, and WT-008.2 adds one member to the vocabulary it establishes — do not settle five shapes in a way that leaves no room for a sixth |
| **Acceptance** | Each activity state renders a distinct shape on both the worktree row's leading glyph and the agent row's state glyph, using one vocabulary rather than two; `unknown` is distinguishable from `idle`, because one is an absence of evidence and the other is a positive claim; the shapes stay distinct with colour removed and under reduced motion, and no two states collapse to the same static form; the worktree row still shows the strongest state among its agents, by the documented precedence; the change moves no wire value and adds no field |
| **Status** | in_progress |

### [WT-008.2] Confirmation Ceiling on Inferred Activity

| Field | Value |
|-------|-------|
| **Goal** | Stop a row animating `running` once its state has stood unchanged past the ceiling with nothing but terminal output behind it, degrading it to an unconfirmed claim rather than to idle |
| **Design Ref** | [worktree-activity-ceiling.md](design/worktree-activity-ceiling.md); [worktree-panel-ui.md](design/worktree-panel-ui.md) § 4, § 7.2, § 6.1; [DESIGN.md](DESIGN.md) § 8.4 (the ceiling invariant is added by this task) |
| **Depends On** | WT-008.1 |
| **Stage** | 6 |
| **Size** | M |
| **Labels** | user-visible-ui, re-review |
| **Notes** | Risk: this is a truthfulness fix, and the three obvious shortcuts are all wrong. Downgrading the activity to `idle` swaps one false claim for another and moves a value every consumer reads; measuring staleness from the row's last-activity stamp measures the very bytes the ceiling exists to see through. And the clock measures unchanged-activity age, not time since confirmation — the design says so explicitly, because describing it as the latter makes the doc promise a grace period the mechanism does not give. The design also **narrows** WT-004.0 rather than satisfying it whole, and that narrowing is the single most important thing for the review round to agree with |
| **Acceptance** | A row claiming `running` on output inference alone stops animating once its state has stood unchanged past the ceiling, and says how long and on what evidence; the claim degrades to unconfirmed and never to idle, and the activity value, the evidence tuple, and every message shape are unchanged; a row backed by a fresh agent report, an external registry row, and any state other than `running` are never marked unconfirmed at any age; a report arriving on a degraded row restores it on the same push, and a change of activity restarts the clock, while a change of *source* does not — a run already past the ceiling is unconfirmed the moment its report ages out, with no grace period; a clock that has not run, or that runs backwards, yields a confirmed row rather than manufacturing staleness; the view re-derives confidence on one scheduled deadline rather than an interval, re-arms it on every push and clears it on disposal, and performs no DOM work when the re-derivation moves nothing; the elapsed hint has no clock of its own; the unconfirmed and animated forms stay distinguishable under reduced motion; the ceiling invariant enters the truthfulness table with a test that goes red when it is violated |
| **Status** | done |

---

## Phase 9 — Glanceability

> **Goal**: the list answers "where is work happening" in one second, and the create dialog stops reading like git plumbing.

### [WT-009.1] Fold the Idle Tail

| Field | Value |
|-------|-------|
| **Goal** | Dim agentless worktrees to a single line and collapse them under one disclosure once there are enough of them to bury the worktrees that hold agents |
| **Design Ref** | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 3.6, § 3 ordering, § 8 |
| **Depends On** | None |
| **Stage** | 6 |
| **Size** | S |
| **Labels** | user-visible-ui |
| **Notes** | This is the part of the reference's "hide sleeping" filter that pays for itself; the filter popover itself stays deferred, so resist growing filter state here. The trap is treating "no agents" and "no evidence" as the same thing — a worktree whose presence source failed is unknown, not idle, and folding it hides exactly what the degradation marker exists to show |
| **Acceptance** | Worktrees holding agents render in full and sort ahead of agentless ones, with the existing deterministic order inside each part; an agentless worktree renders as one dim line carrying its branch and marks and no presence block; from the documented threshold upward the agentless ones fold under a single disclosure stating an exact count of what it hides, and below it they stay visible; a worktree whose presence is degraded is never folded and never reads as agentless; a search match inside the fold opens it; the fold's state persists with the rest of the tree and survives a push that changed nothing |
| **Status** | done |

### [WT-009.2] Last-Activity Preview on Agent Rows

| Field | Value |
|-------|-------|
| **Goal** | Give each agent row a second line carrying the last thing that happened in that session, and move the model id off the row |
| **Design Ref** | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 3.3, § 7.1, § 8 |
| **Depends On** | WT-008.1 |
| **Stage** | 6 |
| **Size** | S |
| **Labels** | user-visible-ui |
| **Notes** | The data already exists — the hook pipeline distinguishes turn states and the vault reads transcripts — so this is a rendering task, not a new source. Reuse pressure: the session list already renders a preview line for the same content, and a second formatter is how the two drift. Two things to hold: the preview is decoration-stripped like every other title, and it is a render-signature input, so a preview that changes must repaint while a spinner frame must not |
| **Acceptance** | An agent row renders two lines — identity, marks and age above, the session's latest message or current tool below — and never a third; the preview truncates before the title and neither wraps; a row with nothing to preview renders no empty second line and no placeholder; a spinner frame is neither displayed in the preview nor able to trigger a re-render; the model id no longer appears on any list row and is absent entirely when unknown; the age column and the leading glyphs never truncate |
| **Status** | todo |

### [WT-009.3] Create Form Reads as a Worktree Form

| Field | Value |
|-------|-------|
| **Goal** | Restructure the create dialog around the branch name, state the destination once, and reveal the agent block only when the user has asked for an agent |
| **Design Ref** | [worktree-actions.md](design/worktree-actions.md) § 3.2.1, § 3.2 |
| **Depends On** | None |
| **Stage** | 6 |
| **Size** | M |
| **Labels** | user-visible-ui |
| **Notes** | The path transparency is a safety property, not clutter — the host states the free path it will actually take before a filesystem write is authorized, and that must survive the restructure rather than be traded for tidiness. What changes is that it is stated once instead of twice, in a dialog whose own tree deliberately shows no path on any row. The always-visible agent block currently contradicts an "After creating: Nothing" selection sitting directly above it |
| **Acceptance** | The branch name is the lead input with nothing above it, and submission stays blocked until it validates; the resolved destination appears exactly once, shortened, with the exact value reachable without leaving the dialog, and a collision states the suffixed result without restating a full path; the agent block is absent unless the user chose to start an agent, and appears when they do, with the dangerous posture labelled and never preselected; base ref, branch source, and the path override live behind a collapsed advanced section; the host still supplies and displays the free path it will take before the action can be authorized; focus order, the focus trap, and dismissal behave as they did |
| **Status** | todo |

### [WT-009.4] Create Is Offered Where the Intent Arrives

| Field | Value |
|-------|-------|
| **Goal** | Add a per-repo create control on group headers and a create action in the body of each empty state, alongside the existing toolbar button and context-menu item |
| **Design Ref** | [worktree-actions.md](design/worktree-actions.md) § 3.2.2; [worktree-panel-ui.md](design/worktree-panel-ui.md) § 3.1, § 5 |
| **Depends On** | WT-009.3 |
| **Stage** | 6 |
| **Size** | S |
| **Labels** | user-visible-ui |
| **Notes** | Four entry points, one dialog and one action behind them — a second create path is how the safety model acquires a hole. The header control must be reachable by keyboard, not hover only, or it is invisible to the users most likely to want it. A repo with only its main checkout is a distinct empty state from a workspace with no repo at all, and it is the one that needs the CTA |
| **Acceptance** | The group header offers create on hover and on keyboard focus, opening the form already scoped to that repo, and appears only where group headers are rendered; the empty states for a repo with one worktree and for a workspace with none carry the create action in the body; the toolbar button and the context-menu item are unchanged; every entry point opens one dialog and runs one action, differing only in the repo it opens on; the toolbar button remains absent from every sessions body |
| **Status** | todo |

---

## Phase 10 — Worktree-First Workbench

> **Goal**: selecting a worktree makes the surface about that worktree — its panes in the tab bar, its detail under the tree — behind one setting until the composition is whole.

### [WT-010.1] Scope a Surface's Tab Bar to the Selected Worktree

| Field | Value |
|-------|-------|
| **Goal** | Make selecting a worktree filter that surface's own tab bar to the panes inside it, named by a chip that can always be escaped |
| **Design Ref** | [worktree-scope.md](design/worktree-scope.md) § 2, § 3.1, § 3.2, § 3.4, § 6, § 7; [worktree-panel-ui.md](design/worktree-panel-ui.md) § 6.1, § 7.3, § 2.3; [DESIGN.md](DESIGN.md) § 8.4 (the hides-only-what-is-proven invariant is added by this task) |
| **Depends On** | WT-008.1 |
| **Stage** | 7 |
| **Size** | L |
| **Labels** | user-visible-ui |
| **Notes** | The redesign's thinnest end-to-end slice, so it lands first. It needs no new protocol: the workbench is already one webview document and pane→worktree attribution already reaches the view, so this is a filter over a list the extension owns. The risk is in what the filter hides — a pane whose directory is unknown or outside every worktree produces no presence row at all, and hiding it would make it unreachable from a tab bar the user cannot tell is filtered. Registers the rollout setting, which no manifest declares yet. The attention badge and the behaviour when a scope holds nothing are deliberately WT-010.2's, so a defect in either cannot hold this slice hostage |
| **Acceptance** | Selecting a worktree filters this surface's tab bar to its panes, and changes no other surface, no process, and nothing the host holds; a pane presence could not attribute stays visible in every scope, while one attributed elsewhere is hidden; a scope that is set is always named on screen, and the control that clears it is reachable whenever it is — including when the panel is collapsed; clearing the scope restores every tab it hid; the card treatment marks the selected worktree and only it, so emphasis no longer reads as selection where the user selected nothing; a removed or pruned scoped worktree drops the scope with a reason, while a `missing` one keeps it; scope persists per surface, absent means all, and an id no longer in the tree resolves to all; two surfaces hold different scopes with neither following the other; a push that changes no attribution performs no tab-bar DOM work; the hides-only-what-is-proven invariant enters the truthfulness table with a test that goes red when it is violated; everything here is inert while the rollout setting is off |
| **Status** | todo |

### [WT-010.2] Nothing Hidden Goes Unheard

| Field | Value |
|-------|-------|
| **Goal** | Count the hidden panes that need a human on the escape control, and settle what a selection does to the active pane and to a scope holding nothing |
| **Design Ref** | [worktree-scope.md](design/worktree-scope.md) § 3.3, § 4.2, § 4.3; [DESIGN.md](DESIGN.md) § 8.4 (the no-invisible-filter invariant is added by this task) |
| **Depends On** | WT-010.1 |
| **Stage** | 7 |
| **Size** | M |
| **Labels** | user-visible-ui, re-review |
| **Notes** | This is the task that makes the filter safe, and it is separated from the filter itself so its correctness is reviewed on its own. Two traps: a badge that is always present is a badge nobody reads, and a count drawn from one evidence source under-reports, because the two sources covering `waiting` do not cover the same panes today. Selection is navigation here — pinning the active pane was considered and rejected in the design, because it creates an attribution outcome the join does not have and makes the empty-scope region unreachable in the common case |
| **Acceptance** | Hidden panes that are waiting raise a count on the escape control, from either evidence source, and no badge renders when there are none; clearing the scope from the badge yields a tab bar holding every pane the count named; the badge uses the same attention vocabulary a waiting row uses, not an error treatment; selecting a worktree activates its first in-scope pane, leaves an already-in-scope active pane where it is, and shows the empty-scope region when the scope holds none; the previously active pane keeps running across the change and returns when the scope is cleared; the empty-scope region offers the two things worth doing there, carries no error styling, and never clears the scope the user chose; the no-invisible-filter invariant enters the truthfulness table with a test that goes red when it is violated |
| **Status** | todo |

### [WT-010.3] Two-Level Worktrees / Sessions Toggle

| Field | Value |
|-------|-------|
| **Goal** | Replace the four flat segments with a primary Worktrees / Sessions toggle, demoting Recent / Agent / Folder to a grouping control shown only inside Sessions |
| **Design Ref** | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 2, § 2.1, § 2.2, § 2.3; [DESIGN.md](DESIGN.md) § 9 D28 |
| **Depends On** | WT-010.1 |
| **Stage** | 7 |
| **Size** | M |
| **Labels** | user-visible-ui |
| **Notes** | No migration exists to write: the two persisted keys are already independent and already carry these exact values, and inventing one would be the bug. The current label-dropping CSS is a symptom of the squeeze this removes, so it goes with it rather than surviving as dead style. Both control levels are tab-like and must keep their roles, labels, and keyboard semantics rather than becoming buttons that happen to look selected |
| **Acceptance** | One primary control switches the body and always shows both values labelled; the grouping control renders inside the sessions body and nowhere else; state written by an older build keeps its meaning with no migration and no key change; the default-body rule is unchanged — a persisted choice wins, otherwise a workspace with a repo opens on worktrees and one without opens on sessions; both levels expose tab semantics to assistive technology and are fully keyboard operable; the shipped four-segment control remains in place while the rollout setting is off |
| **Status** | todo |

### [WT-010.4] Rail Composition and Layout by Location

| Field | Value |
|-------|-------|
| **Goal** | Give the panel and editor locations a two-column rail beside the terminal, and the sidebar a rail that collapses after a selection |
| **Design Ref** | [worktree-scope.md](design/worktree-scope.md) § 5; [worktree-panel-ui.md](design/worktree-panel-ui.md) § 2.3, § 7.1 |
| **Depends On** | WT-010.1, WT-010.3 |
| **Stage** | 7 |
| **Size** | M |
| **Labels** | user-visible-ui |
| **Notes** | One mechanism, two location-appropriate feels — not two implementations. The surfaces differ today only by a location attribute on the document, and that is the seam to use rather than a second layout path. The auto-collapse is a consequence of an explicit selection, never a timer, and must be reversible by the same control that performed it |
| **Acceptance** | The panel and editor locations render the rail beside the terminal region with both visible at once; the sidebar keeps the stacked layout and collapses the rail on an explicit selection, reversibly, staying expanded until the next selection once the user reopens it; scope behaves identically in every layout; the escape control survives a collapsed rail; layout animations respect reduced motion; the shipped layout is unchanged while the rollout setting is off |
| **Status** | todo |

### [WT-010.5] Worktree Inspector Drawer

| Field | Value |
|-------|-------|
| **Goal** | Open a capped detail region under the tree on selection, carrying the worktree's path, actions, agents and their models, and its delegation history |
| **Design Ref** | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 3.7, § 3.2, § 6; [worktree-actions.md](design/worktree-actions.md) § 2; [DESIGN.md](DESIGN.md) § 9 D29 |
| **Depends On** | WT-010.1, WT-009.2 |
| **Stage** | 7 |
| **Size** | L |
| **Labels** | user-visible-ui |
| **Notes** | Sized L rather than M: it carries an accessible drawer shell and its focus lifecycle *and* the action surface inside it, and the second is where the risk is. A drawer, not a body swap — at sidebar width, replacing the body makes selection destructive and forces a back control. Reuse pressure is high: every action it offers already has a handler and an id-resolving path, and growing a parallel set is the failure mode. It is also one of only two places a path is shown in full, so the no-path-on-a-row rule has to survive it |
| **Acceptance** | Selecting a worktree opens the drawer and scopes the tab bar from one gesture, and selecting another replaces its contents rather than stacking; the drawer is capped so the tree above stays visible and scannable; it shows the full path, and no list row gains one; every action it offers resolves host-side from an id and runs the same operation as the equivalent menu item, with external agents still never offered focus; the model id appears here and on no row; dismissal is explicit and leaves the scope alone; focus is trapped correctly, returns where it came from, and survives the drawer opening and closing; the drawer is absent while the rollout setting is off |
| **Status** | todo |

### [WT-010.6] Default the Workbench On

| Field | Value |
|-------|-------|
| **Goal** | Flip the rollout setting's default, retire the gate, and remove the superseded control and layout it was protecting |
| **Design Ref** | [worktree-panel-ui.md](design/worktree-panel-ui.md) § 2.3; [DESIGN.md](DESIGN.md) § 10 |
| **Depends On** | WT-010.1, WT-010.2, WT-010.3, WT-010.4, WT-010.5 |
| **Stage** | 7 |
| **Size** | S |
| **Labels** | user-visible-ui, re-review |
| **Notes** | The gate's purpose ends when the composition is whole; leaving it registered leaves two supported layouts to test forever. Removing the old control is the point of the task — a flag flipped but never cleaned up is how a codebase acquires a permanent second UI. Verification requirement, not an observable outcome: no dead style, state key, or unreachable branch is left behind for the retired path, which the review round confirms by reading the diff |
| **Acceptance** | The workbench composition is what a user sees with no setting configured; the superseded four-segment control and the layout branch it guarded are gone rather than merely unreachable; a user who had explicitly set the flag either way lands on the workbench rather than on a path that no longer exists; the registry and the design docs no longer describe the setting as live |
| **Status** | todo |

---

## Deferred

- ~~Cross-surface scope sync~~ — deferred per DESIGN.md § 9 D25. Technically supported by the existing host-as-hub RPC, but panes belong to one surface, so a rail driving another surface needs a *primary terminal surface* concept and a multi-panel fan-out policy. Revisit as an opt-in setting holding one host-side scope every surface follows, which needs no primary.
- ~~An editor tab per worktree~~ — deferred per DESIGN.md § 9 D25. Closest to the reference's feel, but it proliferates tabs and the editor surface is second-class today; that debt is paid before any default UX bets on it. Acceptable later as a manual "Open worktree as tab" action, never as the selection default.
- ~~Sharing activity confidence with the terminal tab~~ — deferred per DESIGN.md § 9 D27. The tab's indicator claims the terminal is producing output, which stays true past the ceiling. Sharing the confidence would mean widening a shipped protocol union and adding an emitter for a surface whose claim is not false. Revisit if that indicator is ever restated as a claim about work.
- ~~Group-by / sort-by / visibility filter popover~~ — still deferred. WT-009.1 takes the one part of "hide sleeping" that pays for itself with no filter state; the popover itself remains a response to a scale this view does not have.
- Everything else deferred for the worktree subsystem stays recorded in `docs/PLAN.v4.md` and is not restated here.

---

> **Sync rules**:
> - Every edge in the Phases Overview corresponds to at least one task's `Depends On`, and every cross-phase `Depends On` appears as an edge.
> - Every task's `Stage` is ≥ the `Stage` of everything it depends on.
> - Task goal/acceptance text must not reference concepts that were changed or removed in the design docs.
