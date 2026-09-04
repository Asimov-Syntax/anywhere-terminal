# Proposal: state-the-create-choices-without-explaining-them

## Why

The create form explains its own controls back to the user. A row labelled **Copy**, next to the path
it would copy, then spends a wrapped paragraph saying that Copy creates an independent file at that
path — three restatements of one checkbox. Three suggested `.env` rows turn a short list into half a
dialog, and the same habit repeats on the save-defaults button and the wait-for-setup checkbox, whose
note runs into the label with no break at all. The user asked for it flat and short, with an icon hint
at most.

## Appetite

S (≤1d)

## Scope

### In scope

- The host text on suggested provisioning rows — the three sentence templates in
  `suggestProvisioning.ts` — and how a row renders it.
- The note under **Save current choices as defaults**.
- The note beside **Wait for setup to finish before starting the agent**, including its missing break.

### Out of scope

- Which rows are suggested at all, and the workspace-package scan that finds them — that shipped as
  `find-env-files-the-workspace-declares` and is not reopened here.
- The blocked-reason line under the form ("Waiting to check this selection."), which is its own
  change: `read-an-invalid-branch-name-as-an-error`.
- The notes that describe a LIVE relationship between rows — `wt-brow-yield`, `wt-brow-contested`,
  `may be the same file as …`. Those say something the user cannot read off the row itself.
- Provisioning behaviour of any kind. Nothing about what a create does changes.

### Must not

- Drop the secret-file signal. "may contain secrets" is the only thing on screen marking a row as a
  secret, and this change moves it rather than removing it.
- Make a suggested row start checked. The `suggestion` field's PRESENCE is what keeps it opt-in
  (`messages.ts:857-863`), so the field survives however short its text becomes.
- Lose the accessible description on the save button. It is `aria-describedby` today because a screen
  reader announcing the button alone hears the half of the sentence that sounds complete
  (round-1 F014); an accessible name or description must still carry what the visible note carried.
- Let a shortened note change which choices are persisted, or which setup step gates the agent.

## Risk Level

LOW — display text and one rendering path; no provisioning, persistence or selection logic moves. The
two things that could go wrong are both named as Must-nots: losing the secrets signal, and losing the
save button's accessible description.
