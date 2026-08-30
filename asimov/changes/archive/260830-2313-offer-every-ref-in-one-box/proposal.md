# Proposal — offer every ref in one box

## Why

The create dialog's lead input is a bare text field. It accepts a branch name and nothing else, so
every existing branch in the repository is invisible until the user types its name from memory —
and a name that belongs to a branch already checked out in another worktree looks exactly like a
name that is free, right up until `git worktree add` refuses it after the user pressed Create.

`worktree-create.md` § 4.1 settles the shape: refs and a create-new row live in ONE list, ordered
by what the typed text most likely means. The rejected alternative is on the record — Smart /
GitHub / Branch / Name tabs cost vertical space in a narrow modal, split keyboard search across
four datasets, and force a mode choice before the user has typed anything.

This task builds the box and the list. It does not resolve what a selection MEANS — that is
WT-012.8 — so the failure it removes is the narrow one: a branch git will refuse is refused here,
visibly, before the user commits to it.

## Scope

- One host-side enumeration of the repository's local refs, bounded, answered over a new message
  pair.
- Per ref, whether a worktree already holds it and which directory that is — derived from the
  worktree listing the host already has, not a second git call.
- The lead input becomes a combobox over that list plus an always-available create-new row,
  ordered exact match → prefix matches → create-new.
- A held ref is offered, disabled, and badged with the owning directory; it cannot be submitted.
- Keyboard traversal covers the whole list.

## Non-goals

- **No pull requests.** § 4.1 puts PRs in the same list and § 5 makes a PR a source; both are
  WT-012.9, which depends on WT-012.8. The ordering this task ships leaves the PR slot empty
  rather than filling it — exact, then prefix, then create-new.
- **No mode resolution.** Whether a selection means fresh, reuse, reattach or adopt is WT-012.8's
  `worktreeCreateProbe` / `worktreeCreateResolution`. This task offers a list; it does not decide
  what picking from it will do.
- **No remote-tracking refs.** § 4.1 says "local refs resolve immediately" and names nothing else
  as local. A remote-only branch is a create-new against a base, which is the advanced section's
  existing job.
- **No change to submit semantics beyond the block.** Submission stays blocked until the value
  validates, exactly as it does today; this adds one more reason it can be blocked.

## Must not

- **No edit to `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`.** They are
  owned by an external design pass. If the combobox cannot be built without them, that is a STOP
  and a question for the user, not a quiet edit.
- **No unbounded ref enumeration.** Refs grow with a repository's history; the list is capped and
  says when it was.
- **No path containment written by hand** — `src/utils/pathBoundary.ts` is the only definition.
- **A held ref must not be submittable.** Rendering it disabled is not the guard; the guard is that
  the draft cannot carry it.

## Appetite

L. A new wire pair, a new host reader, and the dialog's lead input replaced — the input every other
control in the form is positioned relative to.

## Risk

MEDIUM, and concentrated in the webview. The lead input is the one control § 4 orders the whole
form around ("nothing above it"), and the dialog's focus order, focus trap, and dismissal are
already covered by tests that a combobox can silently break — a listbox that traps arrow keys or
steals Escape from the dialog is a regression no type check sees.

The host side is low risk: the enumeration is one bounded `git` read through the existing runner,
and the held-by-whom answer is derived from a listing already in hand.

**Not touched, and deliberately:** WT-013.1's round-5 finding that a filesystem read outliving its
deadline is abandoned rather than cancelled. This task adds no filesystem read — the ref
enumeration is a git invocation through `gitCommandRunner`, which is bounded on both time and
buffer, and it runs on the create path rather than inside the removal assessment. It does not make
that finding worse, and it stays open and unwaived.
