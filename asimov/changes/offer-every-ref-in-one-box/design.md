# Design — offer every ref in one box

> Refs: [worktree-create.md](../../../docs/design/worktree-create.md) § 4, § 4.1, § 4.2, § 4.4;
> [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.1, § 2.2, § 2.3

## Decisions

### D1 — The refs arrive as their own message, on the provisioning precedent

`WorktreeCreateDefaults` is answered per settled branch edit — § 2.1's `requestWorktreeCreateDefaults`
is "sent again whenever the branch settles, because the path is derived from it". A ref list on that
message would be re-sent on every keystroke that settles, to answer a question that did not change.

**Chosen:** a separate pair, `requestWorktreeRefs { repoId }` → `worktreeRefs { repoId, refs, truncated }`,
wired exactly as the provisioning offer already is: the dialog opens without it, binds an applier
(`bindRefs`, beside `bindProvisioning`), and gains the list when the answer lands. The precedent is
already stated in `WorktreeCreateDefaults.provisioning`'s own comment — absent is NOT "there are
none", and the two say different things. Here that distinction is load-bearing: a repository with no
branches other than the one checked out is a real state, and it must not look like an enumeration
that has not answered yet.

**This extends the blueprint** — § 2.1 and § 2.2 have no ref message — and is carried to blueprint
sync.

Rejected — riding `worktreeCreateDefaults`: it re-sends a whole ref list per settled keystroke, and
it would put the answer on the one message § 4.4 constrains to destination fields only ("whatever
the reply grows to carry, only the destination is what was asked for").

Rejected — enumerating refs in the webview: it has no git.

### D2 — Held-by is derived from the listing already in hand, and names a directory, not a path

**Chosen:** for each ref, the host consults the repository's own `WorktreeInfo[]` — which already
carries `branch` and `displayPath` per worktree — and attaches the owning worktree's directory NAME.
No second git call: the listing that answers "which worktrees exist" already answers "which branches
they hold", and asking git twice invites the two answers to disagree about one instant.

The badge carries a name rather than a full path, on the shipped `collidedWith` precedent (§ 4.2:
the host applies the shortening, and the form renders what arrives). A badge is the narrowest slot
in the form; a full path in it is the "second full path" § 4.2 exists to delete.

§ 2.2's `worktreeCreateResolution.blockedBy` carries `{ ownerPath }` for the per-query case. That
message is WT-012.8's and answers one typed selection; this one answers a LIST, where every row
needs its own state at once. The two are not the same field and are named apart deliberately —
**this refinement is carried to blueprint sync**, so § 2.2 records that the list says `ownerName`
and the resolution says `ownerPath`, rather than leaving a reader to assume one shape.

### D3 — The enumeration is bounded, and a truncated list says so

Refs grow with a repository's history and nothing prunes them. `gitCommandRunner` already bounds
every invocation on time and buffer (`DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_BUFFER_BYTES`), so the
failure mode is not unbounded memory — it is a buffer overflow that kills the child and answers
nothing, on a repository whose only sin is being old.

**Chosen:** `git for-each-ref --format=%(refname:short) --count=<MAX_REFS> refs/heads/`, with
`MAX_REFS` a recorded constant, and `truncated: true` on the answer when the cap was hit. The form
states that the list is partial. Typing a name the list does not contain still creates it — the
create-new row is always present and is not gated on the enumeration — so a truncated list degrades
to exactly today's behaviour rather than to a dead end.

Rejected — no cap, relying on the runner's buffer: the overflow is silent to the user and arrives as
"no refs", which is indistinguishable from an empty repository.

### D4 — The combobox is the only source of new-versus-existing

`draft.branchMode` is `"new" | "existing" | "detached"` and is set today by the Advanced section's
branch-source control. Once picking a ref means "existing" and picking the create-new row means
"new", that control and the combobox both write one field.

**Chosen:** the combobox owns `new` and `existing`; the Advanced control keeps only what the
combobox cannot express, which is `detached`. This is the rule `WorktreeCreateDialog.ts` already
applies to `openAfter` in as many words — "one wire value, never two sources for it".

§ 4's table lists "branch source" among Advanced's contents. Narrowing it to the detached toggle
**extends the blueprint** and is carried to blueprint sync.

### D5 — A held ref is unsubmittable in the draft, not merely disabled in the DOM

**Chosen:** the submit guard reads the selection, not the element. A disabled option is a rendering;
the thing that must not happen is a draft carrying a branch another worktree holds, and a rendering
cannot be the guard for it — a keyboard path, a restored value, or a list that answered late all
reach submit without going through the disabled attribute.

Rows are marked `aria-disabled`, not `disabled`: the row must stay announced and reachable, because
its whole purpose is to tell the user WHY that branch is unavailable and which directory has it.
Removing it from the list would return to the failure this task deletes — a name that looks free.

### D6 — Plain listbox markup, not the vendored VS Code `List`

`src/vendor/vscode/` holds a virtualized list widget, used by `src/webview/fileTree/Tree.ts`.

**Chosen:** plain `role="combobox"` + `role="listbox"` markup. The vendored widget virtualizes for
thousands of rows and brings its own focus and keyboard model; this list is bounded by D3 and lives
inside a dialog that already owns a focus trap and an Escape contract. Two focus models in one modal
is the regression the proposal names, and virtualization buys nothing against a capped list.

Rejected — the vendored `List`: it is the right tool for the file tree and the wrong one here, and
reaching for it because it exists is applying a pattern rather than choosing one.

### D7 — The list owns Escape only while it is open

**Chosen:** when the listbox is open, Escape closes the list and stops there. When it is closed,
Escape reaches the dialog and dismisses it, exactly as today. Arrow keys move the active option
while open and are not intercepted while closed.

Called out as its own decision because the dialog's dismissal, focus order and focus trap are
covered by existing tests that a new keyboard handler can satisfy structurally while breaking
behaviourally — the combobox is inserted at the lead input, which is where focus lands on open.

## Failure-surface inventory

| Resource | Owns writes | Serialization | Crash mid-write | Failed / malformed read | Two racing hosts |
|---|---|---|---|---|---|
| Local refs (`refs/heads/`) | The user's own git, and any other process using the repository | n/a — read-only here | n/a — nothing here writes | Fails **open**: no list, and the form behaves as it does today. The create-new row is not gated on the enumeration, so a failed read costs discovery and never the ability to create | A branch created or deleted between the enumeration and submit yields a list about a moment that has passed; git's own refusal at `worktree add` is the backstop, and § 2.2 already says that message is surfaced verbatim |
| The worktree listing (for held-by) | `WorktreeDiscovery`, not this change | n/a — read-only here | n/a | A degraded listing yields refs with no held-by marks. That fails **open** — toward offering a branch git may refuse — which is deliberate: the alternative is marking every ref held on a bad read and refusing the whole repository | A worktree added or removed mid-flight can leave a ref marked held by a directory that is gone, or unmarked when it is not. Both are stale-badge states, and neither can authorize anything: D5 puts the guard on the submitted draft and git refuses the race |

Nothing in this change writes to either, so there is nothing to roll back.

**Not covered, and deliberately:** WT-013.1's round-5 finding that a read outliving its deadline is
abandoned rather than cancelled. This change adds no filesystem read — the enumeration is a git
invocation through the bounded runner, on the create path rather than inside the removal
assessment — so it does not touch that finding's mechanism. It stays open and unwaived.

## Interfaces

```ts
/** One selectable ref in the create dialog's list. */
export interface WorktreeRef {
  /** Short name, e.g. `feat/search`. */
  name: string;
  /**
   * The NAME of the directory whose worktree holds this branch, when one does.
   * Absent means no worktree holds it. Never a path — see D2, and § 4.2's rule
   * that the host applies the shortening.
   */
  heldBy?: string;
}

export interface WorktreeRefsMessage {
  type: "worktreeRefs";
  repoId: string;
  refs: readonly WorktreeRef[];
  /** The cap was hit and the list is partial — the form says so (D3). */
  truncated: boolean;
}
```

`heldBy` is deliberately not a boolean plus a separate lookup: the reason a row is unavailable and
the row itself travel together, so a form cannot render one without the other.
