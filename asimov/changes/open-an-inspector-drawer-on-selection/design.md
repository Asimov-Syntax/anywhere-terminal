# Design: open-an-inspector-drawer-on-selection

## Decisions

### D1: The drawer is a sibling of the tree, and the controller owns the column

`WorktreeController.element` becomes a flex column holding the tree element and the drawer element;
it is that column, not the tree, that `VaultPanel` mounts as its worktree body.

`WorktreeView.element` is the `role="tree"` node itself. A detail region inside it would be a
non-`treeitem` child of a tree, and moving the drawer above the tree or into the panel shell would
put it outside the element `VaultPanel` shows and hides as one. The column is the smallest node
that owns both halves and keeps the single `display` toggle working unchanged.

### D2: The drawer is not modal, and does not take focus

Opening leaves focus where it was; the drawer is reachable by Tab in DOM order after the tree.
Closing returns focus to the worktree row only when focus was inside the drawer.

`worktreeDialogShell.openDialogShell` is the wrong reuse here despite offering a ready focus trap:
it is a scrim plus a modal card, and a trap would make the tree above the drawer unreachable —
which is exactly what § 3.7 caps the drawer's height to prevent. The blueprint task's phrase
"focus is trapped correctly" is read as the non-modal contract § 6 states in full — *"focus
survives every disclosure toggle, the drawer opening, and a scope change"* — not as a modal trap.

### D3: Open state is the drawer's own, and selection is unchanged

| Event | Selection | Drawer |
|---|---|---|
| Activate an unselected worktree | moves | opens on it |
| Activate the already-selected worktree | unchanged | opens (reopens after a dismissal) |
| Close control, or Escape inside the panel body | unchanged | closes |
| Scope chip cleared, or the selected worktree leaves the tree | cleared | closes |

`WorktreeView.select` returns early when the selection has not moved, so re-activating a row could
never reopen a dismissed drawer. The view therefore gains one dep, `onInspect(worktreeId)`, raised
on **every** worktree-row activation under the rollout, while `onSelectWorktree` keeps firing only
on a move. Two events because they answer two questions: what is scoped, and what is being read.

Order inside `select` matters and is fixed:

1. rollout gate off → return, raising neither;
2. selection unchanged → `onInspect`, return;
3. selection moved → `onSelectWorktree`, then move the field, then `onInspect`.

`onInspect` goes **last** on a move. The existing code announces the scope before mutating its
field precisely because that callback can throw (`WorktreeView.ts:415`); inspecting first would
leave the drawer describing a worktree the selection never reached.

### D4: One action-item builder serves the menu and the drawer

`WorktreeContextMenu.worktreeItems` moves out to `worktreeActionItems(info, actions, opts)` in its
own module, returning the same `ContextMenuItem` list. The menu renders it as menu items; the
drawer renders each item as a button, dropping separators. `opts.repoScoped` is `true` for the
menu and `false` for the drawer, which is what withholds create and prune from a surface that is
about one worktree.

Every gating rule — `missing` withdraws the openers, `kind === "main"` withdraws remove, an absent
capability makes the item absent rather than inert — is then stated once. Growing a parallel set is
the failure mode this change was flagged for; the drawer never sees a `WorktreeMenuActions` key it
must remember to gate.

### D5: The drawer reuses the tree's agent renderers, parameterized by role

`renderAgentRow` and `renderSubagentSection` hardcode `role="treeitem"` / `role="group"`, which is
invalid outside a `role="tree"`. Both gain a `role` option (defaulting to today's value) so the
drawer can present the same rows inside a `role="list"`. `renderAgentRow` also gains
`showModel`, default `false`.

The alternative — a second, compact drawer row — would re-litigate the external-scope chip, the
absent-icon rule, the confidence marker, and the two age clocks, all of which cost review rounds in
the renderer that already has them.

### D6: The drawer draws delegations without a second disclosure, from one request set

The tree hides an agent's delegations behind a chevron and reads the roster on first expansion. The
drawer shows the section for every agent it presents, and asks for any roster not yet held.

`rosterKey` and the asked-once set move out of `WorktreeView` into
`src/webview/worktree/worktreeRosterRequests.ts`, which **both** surfaces share. Two instance-local
sets could not deduplicate across surfaces at all — each would ask once for the same key — and an
inspector-local set would also lose the reconciliation the view already does: it drops a key whose
row left, so a session that returns can be read again (`WorktreeView.ts:762`). A permanent set
would grow over historical sessions and suppress a needed re-read.

Requests are **collected during a render and dispatched after the DOM is committed**.
`renderListing`'s docstring warns that a synchronously answering dependency would re-enter a
half-built render; the drawer adds a second caller on that path, so the deferral becomes the
module's rule rather than a property of who happens to answer over `postMessage`.

An agent row with no `entryId` has no session to ask about. `rosterKey` returns nothing for it, and
`renderSubagentSection(undefined, …)` would leave it on "Reading…" for ever, so the drawer draws an
explicit no-session state for those rows instead.

The read is bounded by the agents of **one** worktree — live panes in this window plus live
registry sessions attributed to it (`presenceProjector.externalRows` enumerates running sessions,
not session history) — so this is not a growth axis over time and needs no cap of its own.

### D7: The drawer guards its repaint on a scoped signature, and is told when confidence moves

The drawer re-renders only when a signature over **the selected worktree and its presence rows**
moves. `worktreeSignature` is not that signature: it also hashes `gitAvailable`, the unreadable
count and reasons, and each repo's label, main path and degradation
(`worktreeRenderSignature.ts:30-66`), none of which the drawer draws — so feeding it a one-worktree
slice would still rebuild the drawer when an unrelated repository's listing failed. The row and
worktree field encoders are therefore lifted into `worktreeScopeSignature(info, rows, now)`,
exported beside `worktreeSignature`, which keeps composing them so there is still one answer to
"what counts as a change".

The drawer does not ride the tree's render pass: `WorktreeView.render` calls `replaceChildren` and
restores focus by a row key only `NAV_ROWS` rows carry, so a drawer rebuilt there would drop focus
out of any control the user was on.

Confidence changes with the clock rather than with a push (`worktree-panel-ui.md` § 6.1), and the
view already owns the one-shot timer for it. Rather than arm a second timer, `WorktreeView` raises
`onCeilingTick` after it re-derives confidence, and the controller refreshes the drawer from it —
one timer, one owner, and the two surfaces cannot disagree about a claim at any moment. Both read
the same injected `now`.

Focus inside the drawer is preserved across its own re-render by re-focusing the node carrying the
same `data-focus` key. Every focusable thing the drawer draws gets one — the close control, each
action button, each agent row, each subagent row — not only the action buttons.

### D8: The model returns to the render signature, unconditionally

`worktreeSignature` keys `row.model` again. It is not conditioned on whether a drawer is open:
§ 6.1 requires the key to cover every field of every wire shape, and a signature that depends on
what is currently mounted is a second rule to keep right.

### D9: Escape is handled on the column, and defers to an open overlay

The drawer's Escape listener is bound to the controller's column element, acts only while the
drawer is open, and returns without acting while a session preview is open — which the panel
reports through a new `PreviewController.isOpen()`, delegating to the shell flag that already
exists (`FloatingPreviewShell.ts:113`), in the same shape as the shipped `isContextMenuOpen` dep.

DOM containment is **not** what makes this safe. `FloatingPreviewShell.show()` never moves focus,
so an Escape pressed with a preview open still targets whatever is focused underneath — a tree row
inside the column. The vault preview binds its own listener on `document` in the **bubble** phase
(`captureCloseListeners ?? false`), so without the guard the column would run first, close the
drawer, and `stopPropagation` would then stop the preview from closing at all — one keypress
closing the wrong layer.

The worktree dialogs need no guard: their capture listener stops propagation before the event
reaches the column (`worktreeDialogShell.ts:76`). The vault search input is outside the column and
consumes its own Escape (`VaultPanel.ts:360`), so an Escape typed there exits search and leaves the
drawer open, which is the intended reading of "the panel body it occupies".

The residual is recorded in the Risk Map: `SubagentPreviewPopup` opts into `captureCloseListeners`
and disposes itself in the capture phase, so `isOpen()` already reads false by the time the same
event bubbles to the column. Closing that hole means an Escape-ownership protocol shared by every
overlay in the webview — a new invariant owner spanning surfaces this change does not own, and so
its own change rather than a fix folded in here.

### D10: The column carries the flex contract, and the cap is asserted from source

`.wt-tree` scrolls today because it is a direct child of `.vault-body` — a constrained flex column
— and carries `flex: 1 1 auto; min-height: 0`. Wrapping it makes those properties inert unless the
wrapper repeats the contract, so `.wt-body` takes
`display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; min-width: 0`. Without it
the tree grows to content height and is clipped by the panel instead of scrolling.

The drawer takes `max-height: 50%` with `overflow-y: auto` and `flex: 0 0 auto`. jsdom applies no
stylesheet, so both halves of the chain are asserted by reading `worktreePanel.css` — the technique
the reduced-motion and focus-reveal contracts already use in `WorktreeView.test.ts`.

### D11: The model rides inside the title cell

`.wt-arow` declares exactly seven grid tracks (`worktreePanel.css:388`) and pins every root child
that is not the preview to row 1, so a model element appended at the root would create an eighth,
implicit column on the drawer's rows. It is appended **inside the title element** instead: no track
is added, no rule is overridden, and `showModel: false` leaves list rows byte-identical.

### D12: The drawer is hidden, not unmounted

The inspector element is mounted once and carries `hidden` while closed, including while the
rollout setting is off. One contract, asserted one way — "present but not shown" — rather than a
plan that says hidden in one place and absent in another. Turning the rollout off at runtime closes
it: `setWorkbench` today only refreshes the tree, and `worktree-panel-ui.md` § 2.3 requires every
participant to recompose on both edges.

## Interfaces

```ts
// src/webview/worktree/worktreeActionItems.ts
export function worktreeActionItems(
  info: WorktreeInfo,
  actions: WorktreeMenuActions,
  opts: { prunableCount: number; repoScoped: boolean },
): (ContextMenuItem | "sep")[];

// src/webview/worktree/worktreeRosterRequests.ts — shared by the tree and the drawer
export function rosterKey(row: WorktreeAgentRow): string | undefined;
export class RosterRequests {
  /** Queue a request for `row` if its key was never asked. No-op without a session. */
  want(row: WorktreeAgentRow): void;
  /** Dispatch what `want` queued. Called AFTER the DOM is committed. */
  flush(send: (row: WorktreeAgentRow) => void): void;
  /** Drop keys no longer live, so a returning session can be read again. */
  reconcile(liveKeys: ReadonlySet<string>): void;
}

// src/webview/worktree/worktreeRenderSignature.ts — added export
export function worktreeScopeSignature(
  info: WorktreeInfo,
  rows: readonly WorktreeAgentRow[],
  degraded: readonly PresenceDegradation[],
  now: number,
): string;

// src/webview/worktree/worktreeTreeView.ts — added options
interface AgentRowOptions { /* … */ role?: string; showModel?: boolean; focusable?: boolean; disclosure?: boolean }
export function renderSubagentSection(
  roster: DelegationRoster | undefined,
  parent: WorktreeAgentRow,
  onActivate: (subagent: WorktreeSubagentRow, parent: WorktreeAgentRow) => void,
  now?: number,
  opts?: { role?: string; rowRole?: string; focusable?: boolean; noSession?: boolean },
): HTMLElement;

// src/webview/vault/PreviewController.ts — added
isOpen(): boolean;

// src/webview/worktree/WorktreeInspector.ts
export class WorktreeInspector {
  readonly element: HTMLElement;
  static mount(deps: WorktreeInspectorDeps): WorktreeInspector;
  open(worktreeId: string): void;
  close(): void;
  isOpen(): boolean;
  /** Redraw from the current envelope; a no-op when the scoped signature is unmoved. */
  setData(tree: WorktreeTree | null, presence: WorktreePresence | null): void;
  /** Re-derive time-dependent claims; same guard, fresh `now`. */
  refresh(): void;
}
```

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Drawer repaint | A poll rebuilds the drawer and drops focus out of a control mid-interaction | D7 — scoped signature, plus a `data-focus` key on every focusable node it draws; verified by asserting the same node object still holds focus, not merely a same-labelled one |
| Drawer repaint | An unrelated repository's listing failure rebuilds the drawer | D7 — `worktreeScopeSignature` hashes only the selected worktree and its rows |
| Stale claim | The drawer keeps presenting `running` after the tree has qualified it | D7 — `onCeilingTick` refreshes the drawer from the view's existing one-shot timer; both read the same injected `now` |
| Escape routing | One keypress closes the wrong layer, or two | D9 — column listener defers to `PreviewController.isOpen()`. **Residual:** `SubagentPreviewPopup` closes in capture and is already gone by bubble time, so that one overlay can still let the same Escape close the drawer. Closing it needs an Escape-ownership protocol across every overlay — its own change |
| Action surface | A drawer button offers what the menu withholds, or acts on a stale target | D4 — one builder, one gating rule; every action posts an id the host resolves |
| Destructive actions | Remove reached from a new surface without its confirmation | D4 — the drawer calls the same `removeWorktree`, which posts `force: false`; the host answers with the blocker set and the shipped confirmation runs unchanged |
| ARIA and keyboard | `treeitem` outside a tree; rows left at `tabIndex -1` and unreachable; an inert chevron and `aria-expanded` beside history that is already shown | D5 — `role`, `focusable` and `disclosure` options; the drawer draws no disclosure semantics at all |
| Delegation reads | The same roster requested twice, never re-requested, or requested from inside a half-built render | D6 — one shared `RosterRequests` with reconciliation, dispatched after the DOM is committed |
| Model in the guard | The model changes and the drawer keeps showing the old one | D8 — keyed unconditionally in `worktreeSignature` and in the scoped signature |
| Model layout | An eighth implicit grid column on the drawer's agent rows | D11 — the model sits inside the title cell; list rows are byte-identical with `showModel: false` |
| Rollout gate | The drawer survives the setting being turned off at runtime | D12 — `setWorkbench` closes it on the disabling edge; opening is already gated by `select`'s `workbench()` check, so there is no second gate to drift |
| Layout | The wrapper makes `.wt-tree`'s flex properties inert and the tree stops scrolling | D10 — `.wt-body` repeats the flex contract; asserted from CSS source alongside the cap |
| Sidebar composition | Selecting in the sidebar collapses the rail (§ 2.4), so the drawer opens unseen | Accepted and intended: the collapse is *choose, then view*, and the drawer is the state the user returns to. Not persisted, so a reload starts with no selection and no drawer |

## Failure surface

| Resource | Answer |
|---|---|
| Persisted webview state | n/a — the drawer persists nothing. Selection is explicit on every open (`worktree-panel` § "A worktree can be selected"), so there is no key to write, no crash-mid-write state, and no read to fail |
| Worktree directories / git registrations | n/a for this change — the drawer raises the shipped mutating handlers unchanged; their writer serialization, confirmation binding, and failure reporting are owned by `worktree-actions.md` § 3 and are not re-implemented here |
