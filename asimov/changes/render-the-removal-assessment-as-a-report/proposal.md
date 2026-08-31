# Proposal: render-the-removal-assessment-as-a-report

## Why

The host assesses twelve checks and sends all of them, and the dialog renders only the failing ones —
so a report where a check could not run looks exactly like one where it passed, on the single action
that cannot be undone. The force button is currently withheld outright whenever any check is
unproven, which makes a worktree with an unreadable `git status` unremovable rather than removable
with a warning.

## Appetite

M (≤3d)

## Scope

### In scope

- Rendering every check the assessment reported, with its own outcome — passed, failed, unproven, or
  not applicable — the orphan proofs included.
- Choosing the confirmation control from the check classes the host sent: none, typed, or ordinary.
- Retiring the blanket withhold-on-unproven guard in favour of the typed confirmation.

### Out of scope

- The assessment itself: what is checked, how it is evaluated, what each check means. WT-013.1 and
  WT-013.2 own that and it is already on the wire.
- Branch deletion after a successful removal — that is WT-013.3, gated on this task's report being
  the thing a user reads before they get there.
- Anything the host does after the confirmation: re-evaluation, execution, partial-failure reporting.

### Must not

- Re-derive which checks refuse, which are confirmable, or which are proofs. The class is on the
  wire so the rule lives in one place; a safety rule implemented twice is one that will disagree
  with itself.
- Render an unproven check as passed, or a not-applicable check as either.
- Let a proof — withheld, unproven, or failing — refuse a removal or demand a typed confirmation.
- Edit `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`; they are owned by an
  external design pass.

## Risk Level

MEDIUM — it is presentation only and adds no capability, but it decides what a user is told before
authorizing an irreversible deletion, and it retires an existing safety guard in favour of a
different one.
