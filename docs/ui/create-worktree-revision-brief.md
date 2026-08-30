# Revision brief — "Create worktree" dialog

**Date**: 2026-08-30
**Target**: `docs/ui/create-worktree.html`

---

# Pass 3 — the current request

Pass 2 landed all six pass-2 items. Verified in the file: the badge slot is split (a linked row
carries both `writes to main` and its source file, and 8b carries both `copied on Windows` and its
source), provenance survives aggregation across single / collapsed / expanded, screen 17 draws a
merged model with a struck-through excluded path, ports moved their source into the badge slot,
screen 18 gives the losing provider one quiet row with the correct "never edits orca.yaml"
promise, and 19 / 19b separate unreadable from empty.

Three things remain. Two are corrections; one is scope that arrived after pass 2 was drawn.

## 3.1 Screen 19 mislabels its own case

The screen currently reads:

> **Could not be read** — `.vscode/worktree.json` could not be read — extends points at
> `asimov/worktree.yaml`, which does not exist. Nothing will be copied, linked or run.

`.vscode/worktree.json` **was** read. That is how its `extends` target is known. What failed is
the target, and the design treats `missingExtends` as a distinct problem from `unreadable`
precisely because the consequences differ: a native file whose `extends` is missing still applies
its own inline `copy` / `link` / `setup` keys, so "nothing will be copied, linked or run" is false
whenever the file has any.

Draw the two cases apart:

- **`extends` target missing** — the native file is fine; the inherited half is gone. The section
  states what was lost and **still lists whatever the inline keys contribute**, each with its own
  source badge. Header wording should say the extends target is missing, not that the file could
  not be read.
- **The file itself unreadable / malformed** — what 19 draws now, but attached to a file that
  genuinely failed to parse. 19b's malformed example (`unexpected key copyFiles at line 12`) is
  already the right shape.

## 3.2 Ports now state numbers the extension actually owns

Settled since pass 2: **the extension allocates.** It probes free ports, excludes any value a
sibling worktree's `.env.worktree` already claims, and writes `.env.worktree` into the new
worktree. So `ASIMOV_PORT_APP=5183` is legitimate — pass 2 drew it correctly ahead of the decision.

One state this creates and pass 2 could not have known to draw: **the dialog's number is a preview,
and the applied number is authoritative.** Ports are re-probed immediately before the file is
written, so a port taken in between changes. That must be reported rather than silently swapped —
the user was shown 5183 for the express purpose of remembering it.

Add it to screen 7's family (the post-create result on the worktree row), not to the dialog: one
line stating the port changed and what it changed to. It is an outcome, not a form state.

## 3.3 Reuse / reattach / recover are now first-class

Settled since pass 2: fresh / **reuse** / **reattach** / **recover** are four first-class states,
not one state plus three git errors. Pass 2 covers fresh, reuse (via the combobox), and shows a
branch checked out elsewhere as a disabled row with its owning directory. The other two are not
drawn at all.

Draw them as **states of the combobox selection**, resolved before submit — never as a dialog that
appears after a failure:

- **Reattach** — the branch exists and a worktree was registered for it, but the registration was
  pruned while the directory survived. Selecting it offers to reattach rather than create a
  near-duplicate. Name the directory that will be reattached.
- **Recover** — a directory exists at the destination with no `.git` pointer: crash debris from an
  interrupted create. Offer to remove the debris and continue. This one deletes something, so it
  states exactly what will be removed and does not proceed on a bare "Create".

Both belong in the same field-local amber register as the existing collision line — the user is
still choosing a source, and neither is an error yet.

One rule from the research to honour in both: **the base ref is contractual.** It is refused for
reuse and recovery rather than silently ignored, because a base that will not be applied must not
sit in the form looking as though it will. When a reuse or recover selection is active, Base is
disabled with a one-line reason.

## 3.4 Setup checkboxes start unchecked

Settled since pass 2: a default-on checkbox that the user did not clear is **not consent** to run a
command a checked-in provider file supplied. Every `Run setup` checkbox in every screen starts
unchecked.

Consequence to draw: screen 4b's "nothing to wait for" state is now the *default* state of a fresh
dialog, not an unusual one. Screen 4 still shows the checked case — the user turned it on.

## 3.5 Three removal screens contradict the safety model

These are real conflicts with the design, found in review. The design is right and the mockup needs
to follow it.

- **Screen 14 shows a typed confirmation with `Agent "Claude Code" is active here`.** An active
  agent is a **hard refusal** — there is no confirmation path at all, and no `Remove worktree`
  button. Redraw that row as a refusal state: the report is shown, the action is not offered, and
  the user is told to stop the agent first. Move the typed-confirmation example to a screen whose
  failures are confirmable risks (dirty, untracked, locked, ignored content).
- **Screen 14 shows `Also delete branch` disabled** with "Unavailable while the branch is
  unmerged." The contract says the control is **absent** when the merge proof is false or
  unproven — a disabled control invites the user to go looking for a way to enable it, which is
  exactly the reconsideration this gate exists to prevent.
- **Screen 15 says `Terminals in this folder were closed`.** Panes are never killed. Removing a
  worktree leaves them running in a deleted directory — that is what a terminal does and what the
  user authorized. The line should say the terminals were left running.

## 3.6 One new check to draw: ignored content

`git status --porcelain` says nothing about ignored files, and this dialog deliberately creates
them — `.env.worktree`, copied config, installed dependencies, build output. A report where every
check passed, followed by deleting a `node_modules` and a copied `.env`, omitted the thing that
mattered most.

Add an ignored-content row to the removal report, as a confirmable risk. It has three states worth
drawing: a count and size, a "could not be determined" under budget, and the case where the
material is what **this dialog** provisioned — "the 4 files this worktree was set up with" is a
different sentence from "1.2 GB of ignored content", and the report should be able to say either.

## Constraints (unchanged)

- 480px, no horizontal scroll.
- Keep the `.cw-*` CSS vocabulary and the dark VS Code palette. Add classes rather than restyling
  existing ones, so earlier screens stay pixel-identical.
- Keep the screen-numbering scheme and the `mockup-label` caption convention.
- Update the closing "What changed, and why" and "Decisions to confirm" blocks.

## Settled — do not reopen

- Excluded paths are **not** counted in the section summary. Pass 2 raised this as an open
  alternative; the model keeps excluded entries in a separate list, so the count is correct as
  drawn.
- Destination label and value on two lines.
- Default destination stays `…/.claude/worktrees/<name>`.
- Two-line Bring over rows.
- Mixed provenance is click-to-expand.

---

# Pass 2 — completed, kept for the record

Pass 1 was drawn while audit §D — what the Bring over section reads — was still open. It is now
decided, and the decision changed the section's information model.

## What changed

The Bring over section reads a **normalized model assembled from multiple providers**, not a
single config file.

| Provider | File | What it contributes |
|---|---|---|
| asimov | `asimov/worktree.yaml` | `copy[]`, `link[]`, `ports{}`, `setup[]` |
| orca | `orca.yaml` | `scripts.setup`, `worktree.sharedDirectories[]` (link only, gitignored dirs) |
| orca | `.worktreeinclude` | line-delimited paths, **copy** semantics |
| VS Code | `.vscode/tasks.json` | tasks marked `runOn: "worktreeCreated"` — read as a *convention*, no API |
| Anywhere Terminal | `.vscode/worktree.json` | native; may `extends` any of the above, and/or declare its own |

The native file merges over what it extends:

```jsonc
{
  "extends": "asimov/worktree.yaml",
  "copy": [".env.local"],
  "exclude": [".code-review-graph"]
}
```

**Merge rule**: additive, deduped by path, inline wins on a path collision, `exclude` removes an
inherited entry. Consequence for the UI: **provenance is per entry, not per section.**

## The six items, all delivered

1. **Split the badge slot** — every row's badge names the file that said so; `writes to main` and
   `copied on Windows` became a separate warning chip. A linked row carries both.
2. **Provenance survives aggregation** — single source keeps pass 1's shape; mixed collapses to a
   `2 sources` badge that is the disclosure; expanded gives per-path provenance.
3. **New screen — merged configuration** (17), including an excluded path.
4. **New screen — several providers present, one chosen** (18), as one quiet row, with switching
   rewriting `extends` and never touching the other framework's file.
5. **Ports** — source file back in the badge slot, numbers in the meta line.
6. **Empty and broken are different states** (19, 19b) — the section names the file, says what was
   lost, offers to open it, and Create stays enabled.
