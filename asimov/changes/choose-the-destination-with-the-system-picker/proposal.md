# Proposal: choose-the-destination-with-the-system-picker

## Why

The create form states its destination and lets a user override it — by typing a full absolute path
into a text field inside a collapsed disclosure. That is the only way to put a worktree somewhere
else, and it asks the user to produce a path from memory in a field that shows nothing about where
they are. Every other place this product asks for a folder opens the system picker instead
(`fileTreeHost.ts`). The create form should too.

A picker alone would not have worked. The probe refuses any destination that does not resolve inside
the configured create root, so a folder chosen anywhere else was discarded and the derived path used
in its place — silently. The refusal is right and stays: the probe's answer says whether a path is
occupied, so honouring an arbitrary one turns it into an existence oracle for the whole filesystem.
What was missing is the observation that the host itself opens the dialog, so it already knows the
folder without being told, and a folder the user personally selected in an OS dialog is consent the
host issued rather than a claim the webview made.

## Appetite

S (≤1d)

## Scope

### In scope

- A visible action beside the destination that opens the system folder picker.
- The chosen folder becoming the folder the worktree is created IN: the worktree keeps the name
  derived from its branch, and the host resolves collisions under the chosen folder exactly as it
  does under the configured root.
- The host holding the folder it handed one create form — as the resolution its own dialog produced —
  and deriving under it for that form and repository only.
- A picker the user cancels leaving the form exactly as it was.

### Out of scope

- Saying why a destination was refused. A typed override outside the create root is still dropped in
  silence; that is the follow-up change `say-why-a-destination-was-refused`, which owns the refusal
  for typed and picked destinations alike.
- Widening what a TYPED override may name. Only a folder this host handed this form is honoured
  outside the configured root.
- Changing how a destination is shortened or displayed, or how collisions, occupancy and holds are
  answered.
- Remembering a chosen folder across creates or forms, or writing it to any configuration.
- A picker anywhere but the create form.

### Must not

- Resolve any path a message carried in order to decide where a destination is derived. The form
  states that it is using the folder; only the host's own record says which folder that is.
- Let a folder handed to one form authorize a destination for another, or outlive the form's
  retirement.
- Compose or send a destination from the webview. The form states a flag; the host states the path.
- Change what happens when a destination is occupied, held, or would collide — those answers belong
  to the host and stay where they are.
- Weaken any destructive confirmation or provenance boundary, or the merged WT-012.6/.10/.11/.15
  contracts.

## Risk Level

MEDIUM — the change deliberately widens a boundary a prior review round installed (round-3 B8). The
widening is bounded by a host-issued record with a form's lifetime, and the risk is that the bound
leaks: a consent that survives its form, is reachable from another form, or is claimable by a message
rather than issued by the host. Each is a ledger row in design.md with its own witness.
