# Proposal: render-the-removal-assessment-as-a-report

## Why

The host assesses twelve checks and sends all of them, and the dialog renders only the failing ones —
so a report where a check could not run looks exactly like one where it passed, on the single action
that cannot be undone. The force button is currently withheld outright whenever any check is
unproven, which makes a worktree with an unreadable `git status` unremovable rather than removable
with a warning.

The report is now reached from the menu, but its ordinary callback posts the same fingerprint-free
removal request any caller may post directly. The service treats that request as immediate permission
when the fresh assessment is clean. Confirmation is therefore a panel convention, not a host-enforced
precondition: the destructive boundary still has a clean-path door that never proves a dialog was
answered.

## Appetite

M (≤3d)

## Scope

### In scope

- Rendering every check the assessment reported, with its own outcome — passed, failed, unproven, or
  not applicable — the orphan proofs included.
- Choosing the confirmation control from the check classes the host sent: none, typed, or ordinary.
- Retiring the blanket withhold-on-unproven guard in favour of the typed confirmation.
- Making a report fingerprint the only authority to execute any removal, while the host — not the
  panel — chooses ordinary or forced Git execution from fresh evidence.

### Out of scope

- The assessment itself: what is checked, how it is evaluated, what each check means. WT-013.1 and
  WT-013.2 own that and it is already on the wire.
- Branch deletion after a successful removal — that is WT-013.3, gated on this task's report being
  the thing a user reads before they get there.
- Changing the check set, execution-time re-evaluation rule, fingerprint subset rule, or partial-failure reporting.

### Must not

- Re-derive which checks refuse, which are confirmable, or which are proofs. The class is on the
  wire so the rule lives in one place; a safety rule implemented twice is one that will disagree
  with itself.
- Render an unproven check as passed, or a not-applicable check as either.
- Let a proof — withheld, unproven, or failing — refuse a removal or demand a typed confirmation.
- Let a fingerprint-free request execute, let the webview choose Git's force mode, or treat a
  fingerprint's presence as permission to force a clean worktree.
- Mint executable authority for a refusal or an unavailable assessment.
- Edit `docs/ui/create-worktree.html` or `docs/ui/worktree-create-dialog.css`; they are owned by an
  external design pass.

## Risk Level

HIGH — it decides what a user is told before an irreversible deletion and moves the authorization
boundary so no removal can execute without a report fingerprint. The change adds no deletion
capability, but a mistake can either restore the confirmation bypass or force a clean removal.
