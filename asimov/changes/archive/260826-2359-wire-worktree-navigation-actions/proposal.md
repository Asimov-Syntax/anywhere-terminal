# Proposal: wire-worktree-navigation-actions

## Why

The Worktree panel draws both context menus, their item sets, and their deliberate omissions —
and every item reaches nothing. WT-005.1 is the task that makes the offer true for the
read-only half of the action inventory, leaving the mutating half to WT-005.2 and the launch
half to WT-005.3.

Discovery found the offer is not merely unimplemented but structurally easy to leave
unimplemented: the two providers each enumerate worktree message types by hand, and the type
`surface-subagent-history-rows` added last is in neither list, so that feature is inert in
production while its unit tests pass. This change routes worktree messages by membership rather
than by memory, which is what stops the seven types it adds from repeating it.

## Scope

In: the seven read-only actions of [worktree-actions.md](../../../docs/design/worktree-actions.md)
§ 2 — focus pane, open session preview, open folder (both modes), reveal in OS, copy path, open
terminal here, copy resume command; configurable row activation and its manifest setting; the
provider routing seam; extraction of the shared context-menu shell.

Out: mutating actions and the safety model (WT-005.2); launching or resuming an agent into a
worktree (WT-005.3); the create form. `Copy resume command` is in scope despite not being named
in the blueprint's Goal line: § 2 classes it read-only, the blueprint's own Notes name it among
the three that "already have host implementations", and its menu item is already drawn.

## Appetite

M. The action bodies are thin — most are id-resolving wrappers over handlers that already
exist. The weight is in the routing seam, the resolution contract, and the menu extraction.

## Risk

MEDIUM. No destructive operation, no user-supplied value reaching git. The risk is
misresolution — an action running against a target the user did not see — and regression in the
vault panel from the shared-shell extraction.
