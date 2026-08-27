# Proposal: wire-worktree-mutating-actions

## Why

The worktree panel already draws every mutating affordance — the create form, the remove
confirmation with its blocker list, and the refusal that offers no confirm button — but every
blocker it displays is fixture-derived, so nothing has been evaluated by anything. The panel
currently claims a safety model it does not have. This change makes the host actually evaluate
what is at risk, and makes the actions run.

## Appetite

L (≤2w) — matches the blueprint's Size L. The mutation surface is small; the safety model around
it is not, and the safety model is the deliverable.

## Scope

### In scope

- Create, remove, lock, unlock, and prune, each re-resolving its target host-side from an id.
- Host-side blocker evaluation for removal, and the fingerprint round trip that binds a
  confirmation to the blocker set the user was actually shown.
- The refusal cases that no confirmation can override: the main worktree, a worktree holding an
  agent mid-turn **in this window**, and a worktree containing another registered worktree.
- Create-path validation as an untrusted input — the one action with no host-issued id to
  re-resolve from — including the residual TOCTOU the design already states rather than hides.
- Default create path resolution, including the repo's own layout beating our default, and the
  `info/exclude` write a root inside the main worktree requires.
- Per-repo serialization, forced rebuild after every attempt including failures and timeouts, and
  the `indeterminate` outcome for when git and the filesystem disagree.
- Registering whichever `anywhereTerminal.worktree.*` settings keys this change needs and the
  manifest does not yet declare.

### Out of scope

- **Launching an agent** — `worktree-actions.md` § 4, and the create form's `openAfter: "agent"`
  mode with its agent picker, permission postures, and seed prompt. WT-005.3 owns that, and its
  fresh-launch registry capability does not exist yet. Create ships here with its other
  `openAfter` modes; the agent mode is rejected by validation until WT-005.3 supplies it.
- **Branch deletion.** `git worktree remove` leaves the branch, and bundling deletion into removal
  would destroy work the user believed was merely un-checked-out (§ 3.3).
- **Killing panes inside a removed worktree.** They are left running in a deleted directory, which
  is what a terminal does and what the confirmation says will happen.
- **Filtering the launch environment.** `PtyManager.buildEnvironment()` clones the whole
  extension-host `process.env` and the agent allowlist merges *over* it rather than filtering.
  Pre-existing, affects every vault launch, and recorded in `worktree-actions.md` § 7 and
  DESIGN.md § 14 D24 — fixing it inside a worktree change would bury a security change in an
  unrelated diff.
- **Closing the create-path TOCTOU.** Narrowed, not closed; the unsupported path-aliasing cases
  (UNC, mapped drives, network mounts) stay documented as unsupported.
- **A recursive remove-with-children.** Containment is refused, not confirmed. An operation that
  removes a parent *and* its registered children would have to evaluate and name every contained
  target and each of its own blockers — a different action from this dialog, not a flag on it.

## Risk Level

HIGH — this is the highest-risk task in the feature. It puts user-supplied refs and paths in front
of git, and `git worktree remove --force` recursively and irreversibly deletes a directory whose
contents may change between the safety check and the delete. Three properties carry that risk:
argv arrays only, host-side re-resolution from ids, and a confirmation bound to a fingerprint so
`force` authorizes exactly the risk the user saw — taken over the **identities** at risk rather than
their counts, because a same-count substitution is otherwise indistinguishable from no change.

Because argv-spy unit tests cannot observe git's actual deletion or its metadata ordering, the
destructive paths where git's own behavior *is* the claim — nested registrations, a locked target's
doubled force, an existing empty target, a killed removal, prune's count — are additionally proved
against temporary repositories.
