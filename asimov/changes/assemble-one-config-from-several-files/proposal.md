# Proposal: assemble-one-config-from-several-files

## Why

Three adapters can each answer for a repository, and exactly one of them wins. A repository that
uses a framework and wants one more file copied has nowhere to say so: its only options are to edit
the framework's file — which belongs to the framework — or to abandon the framework's answer
entirely. `.vscode/worktree.json` is the place to say "what they said, plus this, minus that".

The merge is what makes the section trustworthy rather than merely populated. Because every row
already names the file that declared it, a merged list stays legible: the user can see that
`node_modules` came from orca and `.env.local` came from their own file, and that a path they
excluded was excluded on purpose rather than lost.

## Appetite

One change. The merge rule, the native file that drives it, and the excluded-row rendering. The
file is read here and written by WT-012.5; nothing in this change materializes anything.

## Scope

### In scope

- `.vscode/worktree.json`: `extends`, the four inline keys `copy`/`link`/`setup`/`ports`, `exclude`,
  and `unknownKey` reporting.
- The merge rule (worktree-provisioning.md § 4.2) in the dispatcher, including dedupe with the
  native entry winning its mode, and setup steps appended without dedupe or reorder.
- Detection: the native file joins the front of the detection order (§ 4.1), including the rule
  that a native file **without** `extends` is the sole active provider.
- Problem taxonomy: `missingExtends` and `unknownKey` alongside the existing `malformed` and
  `unreadable`, each distinct, none discarding the rest of the file.
- Rendering excluded paths as deliberate, and keeping them out of the section's totals.
- Extracting the shared `copy`/`link`/`setup`/`ports` key mapping so the native and asimov readers
  cannot drift, with a structural test proving one owner.

### Out of scope

- Writing `.vscode/worktree.json` — WT-012.5 owns `[Configure…]`.
- Allocating port numbers — WT-012.6.
- Materializing anything, or running a setup step — WT-012.10, WT-012.11.
- The missing root-failure diagnostic (round-2 F009 of the previous change). Carrying "no provider
  was elected, and here is why" needs an owner this change does not have, and it appears in none of
  WT-012.4's acceptance clauses. It stays a follow-up PLAN task.

### Must not

- Must not let a native file inherit without asking. Inline keys never implicitly overlay the first
  detected framework; only `extends` inherits (§ 4.1).
- Must not rewrite an entry's `source`. Not on merge, not on dedupe, not on exclusion (§ 4.3).
- Must not reject a whole file for one bad key.
- Must not let `extends` reach a file outside the repository (§ 7) — and must not hand-roll the
  containment check to do it.
- Must not disable Create for any problem state.
- Must not add an append that charges the shared budget without also enforcing it.

## Risk Level

MEDIUM. Two untrusted checked-in files are now combined into one model, and the combination is what
a later task hands to a shell. The specific hazards: an `extends` target escaping the repository, a
merge that loses provenance so the UI's per-row badge lies about who asked for a command, and the
shared row budget being spent by the inherited model before the native file's own entries — which
would silently defeat the rule that the native entry wins.
