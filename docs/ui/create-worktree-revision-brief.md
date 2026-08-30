# Revision brief — "Create worktree" dialog

**Date**: 2026-08-30
**Target**: `docs/ui/create-worktree.html`

---

# Pass 4 — the current request

Pass 3 landed 3.1 (`extends` target missing, now 19 / 19b / 19c), 3.2 (screen 7b, the port preview
is not a promise), and drew the new selection screens 20 / 21 / 22 / 23. It did **not** land 3.4
(setup checkboxes unchecked), 3.5 (three removal screens contradict the safety model), or 3.6
(the ignored-content row). Those three carry forward unchanged and are restated at the end.

The new work in this pass is that **the model behind screens 20–23 has changed since they were
drawn**, in two ways that a redraw cannot paper over.

## 4.1 There are five branch modes and a separate destination axis, not four selections

Screen 23's caption reads "The four selections in the omnibox" and its closing note says:

> Reattach and Recover are states of a branch, so they are badges in the same list — not extra
> sources and not a fifth tab

That is the part that changed. The design now resolves **two independent values**, because a branch
can be occupied and a destination can be occupied and neither implies the other:

| Question | Values |
|---|---|
| **Branch mode** | `fresh` · `fresh-detached` · `reuse` · `reattach` · `adopt` |
| **Destination disposition** | `free` · `debris` |

`debris` is what the UI calls **Recover**, and it is a property of the **destination**, not of the
branch. It composes with every branch mode: recovering debris and then reusing an existing branch is
a legitimate combination that the current drawing cannot express, because it spends the branch badge
on Recover.

So:

- The omnibox badges become **Reuse · Reattach · Adopt** (plus the "create new branch" row and the
  disabled "checked out in `<dir>`" row already drawn). Recover leaves the omnibox.
- **Recover moves to the Destination row**, as an occupied-destination state in the same amber
  register, shown *whichever* branch mode is selected. Screen 21 already draws the right content —
  entry count, size, age, "nothing here is tracked by git", the explicit checkbox, the red
  `Delete and create`. It is the placement that changes, and the fact that the branch line above it
  keeps whatever mode the user chose instead of reading "A folder is already at this destination".
- Update the caption and the closing note to match. "Five modes and a destination state" is the
  sentence; the note that they are badges rather than a tab bar is still right and worth keeping.

## 4.2 Screen 20 is drawing Adopt and calling it Reattach

Screen 20's caption is "registration pruned, directory survived" and its field line reads
"Directory exists, **not registered** — will reattach". That is a precise description of a state,
and it is not reattach. It is the state the design now calls **Adopt**, and the two are different
enough that they cannot share a screen.

Both were verified against git 2.50.1; this is behaviour, not preference.

| State | Git's view | What runs |
|---|---|---|
| **Reattach** | The administrative entry **survives**; its recorded path is stale. Git flags the worktree `prunable` | `git worktree repair <path>` |
| **Adopt** | The administrative entry is **gone**. A populated checkout survives | Nothing in git does this. The entry is reconstructed by hand, then `repair`, then `reset --mixed` |

`git worktree repair` cannot do the second: it reads the id out of the worktree's `.git` file and
then requires the administrative directory to already exist, so it fails with *"unable to locate
repository"*. And `git worktree add` refuses the non-empty directory with *"already exists"* — a
check that runs before `--force` is consulted, so no amount of forcing reaches it.

### Redraw screen 20 as Adopt

Keep its shape. Change the wording and add the two things adopt owes the user that reattach does not.

**One — state what adopt cannot bring back.** Everything that lived in the deleted administrative
directory is gone with it, and none of it can be recovered from the surviving files. This is
declared, never detected — a check that cannot fail is worse than a stated limitation. The files
themselves are untouched, and the screen should lead with that before the list, or the list reads as
data loss:

- staged changes become unstaged (the index lived there — content intact, staging decision gone)
- any in-progress rebase, merge, bisect or cherry-pick is no longer running; files are left as that
  operation last wrote them
- `ORIG_HEAD`, per-worktree refs and the worktree's own reflog are empty
- the worktree is adopted **unlocked**

Draw this as a quiet informational block inside the field-local amber region, not as a warning list
with icons — nothing here is a risk the user can avert, it is a description of what they get.

**Two — the branch-claimed refusal, as its own state.** `git worktree add` refuses a branch already
checked out elsewhere. Reconstructing the entry by hand bypasses that check entirely and git says
nothing: two entries claim the branch, both commit, and the second commit lands on top of the first
carrying a tree that silently reverts it. No conflict, no warning, a linear history.

So adopt verifies no live worktree holds the branch **before writing anything**, and a claim is a
**hard refusal** — no confirmation path, no typed override, in the manner of the active-agent case
in 4.5 below. Draw it as a second variant of screen 20 (call it 20b): the directory is named, the
owning worktree is named, `Adopt` is **absent** rather than disabled, and the offered way forward is
`Create separate` at a deduplicated path — the same escape hatch screen 20 already has.

### Draw real Reattach as a new screen

Reattach is the `prunable` case and deserves its own small screen (20c or wherever it sits): the
directory is named, the line says the registration is stale rather than missing, the repair is
one command, and **nothing is lost** — so it carries none of the adopt disclosure. It keeps
`Create separate` and it keeps "Bring over — Skipped", both of which screen 20 already draws
correctly.

## 4.3 Screen 22 puts Recover on the wrong side of the contract

Screen 22 lists four rows and disables Base on three of them, including:

> Recover — debris removed, then the existing branch is checked out
> Base: `main` — Not applied while recovering

Two problems. It asserts recover implies an existing branch, which 4.1 just removed; and it disables
Base for a case where Base **is** applied. The rule is that Base is refused for the branch modes
that take their starting point from something that already exists — `reuse`, `reattach`, `adopt`.
Clearing debris and then cutting a fresh branch is an ordinary fresh create that happened to need
the ground cleared first, and its Base is live and editable.

Redraw 22 as **five branch-mode rows** — fresh (editable), fresh-detached, reuse, reattach, adopt —
with the disposition stated separately as a line saying that recovering debris does not change any
of them. Adopt's reason line: *"Not applied — the checkout keeps whatever it was on."*

## 4.4 One conflict already visible inside pass 3

Screen 22 says recover checks out "the existing branch"; screen 21's own field line says "A folder
is already at this destination, and git does not know it" with no branch mode at all; the closing
note says "recovery makes a fresh worktree, so provisioning runs normally". Three different answers
to what recover does to the branch. 4.1 settles it — recover does nothing to the branch — and all
three places should say so.

## 4.5 Carried forward from pass 3, not yet done

Unchanged from the pass-3 brief; restated so this document is the only one that needs reading.

**Setup checkboxes start unchecked.** Five of the six `Run setup` checkboxes in the file are still
`checked`. A default-on checkbox the user did not clear is not consent to run a command that a
checked-in provider file supplied. Every one starts unchecked, and screen 4b's "nothing to wait for"
becomes the *default* state of a fresh dialog rather than an unusual one.

**Screen 14 contradicts the removal safety model in two places.**

- It shows `Agent "Claude Code" is active here` alongside a typed confirmation and a live
  `Remove worktree` button. An active agent is a **hard refusal**: no confirmation path, and the
  button is **absent**. Redraw that row as a refusal — the report is shown, the action is not
  offered, the user is told to stop the agent first. Move the typed-confirmation example to a screen
  whose failures are confirmable risks (dirty, untracked, locked, ignored content).
- It shows `Also delete branch` **disabled** with "Unavailable while the branch is unmerged". The
  contract says the control is **absent** when the merge proof is false or unproven. A disabled
  control invites the user to go looking for a way to enable it, which is the exact reconsideration
  this gate exists to prevent.

**Screen 15 says `Terminals in this folder were closed`.** Panes are never killed. Removing a
worktree leaves them running in a deleted directory — that is what a terminal does and what the user
authorized. The line says the terminals were **left running**.

**The ignored-content row is still missing.** `git status --porcelain` says nothing about ignored
files, and this dialog deliberately creates them — `.env.worktree`, copied config, installed
dependencies, build output. A report where every check passed, followed by deleting a `node_modules`
and a copied `.env`, omitted the thing that mattered most. Add it to the removal report as a
confirmable risk, with three drawable states: a count and size; a "could not be determined" under
budget; and the case where the material is what **this dialog** provisioned — "the 4 files this
worktree was set up with" is a different sentence from "1.2 GB of ignored content", and the report
should be able to say either.

## 4.6 Three states the design has and the file does not

Each of these is a contract the design already fixed; none is drawn.

**A removal check has four outcomes, and screens 13 / 14 draw three.** They cover passed, failed,
and unproven. The fourth is **not applicable**, and conflating it with unproven is a bug the user
feels: unproven **blocks**, not-applicable must not. A worktree on a detached HEAD has no branch, so
"Branch merged into `main`" is not unproven — there is nothing to prove, and treating it as unproven
would refuse a removal that is perfectly safe. Draw it as its own quiet row, visually distinct from
the `?` that blocks: the check is named, the reason is one clause ("no branch — detached HEAD"), and
it carries no weight in the decision.

**A stale offer requires a second submission, and nothing says so.** What the dialog offers to copy,
link and run is a snapshot the host resolved and holds. If the provider files change while the
dialog is open, submitting the old snapshot would run something the user never saw. The contract is
that the dialog resolves a fresh model, presents it, and **requires the user to submit again** —
it does not create, and it does not provision, on the submission that discovered the change.

Draw it: a field-local notice in the Bring over section saying the configuration changed on disk and
what is shown has been re-read, with the primary button returning to its un-submitted state. The
same shape covers the removal report, where **any** change to the assessment re-prompts — not only a
larger set of blockers. A check that flipped from failed to passed re-prompts too, because the user
authorized a specific report, not an outcome.

**`fresh-detached` has no dialog state.** It appears in screen 22's mode list after this pass, but
there is no drawing of the dialog with it selected. It needs no new machinery — Base is applied, no
branch is created, and the After-creating block is unchanged — so one variant line on an existing
screen is enough. What matters is that the removal screens can then show the not-applicable branch
row above, which is the state it produces.

## Constraints (unchanged)

- 480px, no horizontal scroll.
- Keep the `.cw-*` CSS vocabulary and the dark VS Code palette. Add classes rather than restyling
  existing ones, so earlier screens stay pixel-identical.
- Keep the screen-numbering scheme and the `mockup-label` caption convention.
- Update the closing "What changed, and why" and "Decisions to confirm" blocks.

## Settled — do not reopen

- Excluded paths are not counted in the section summary.
- Destination label and value on two lines; default destination stays `…/.claude/worktrees/<name>`.
- Two-line Bring over rows; mixed provenance is click-to-expand, per row, not remembered.
- Provenance labels are file paths, not framework names.
- Reattach and adopt both skip Bring over; recover does not.
- The port preview is not a promise (7b), and the extension is what allocates.

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
