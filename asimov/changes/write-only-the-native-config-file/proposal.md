# Proposal: write-only-the-native-config-file

## Why

Every provisioning file the extension can read today is read-only to it. A user who clears an
inherited entry in the create form changes that one create and nothing else — the next create
offers the entry again, because the only place the preference could live is a file the extension
refuses to write. `[Configure…]` is the affordance that gives the preference somewhere to go.

The reason it is a separate task rather than a line in the read work is the file it must NOT
write. A provisioning file belongs to the tool that defined it; recording our dialog's opinion in
`asimov/worktree.yaml` would put our preferences in another tool's file, destroy its comments, and
surprise every other consumer of it (worktree-provisioning.md § 6).

## Scope

- `[Configure…]` in the create dialog, and the host-side write it triggers.
- Recording an unticked inherited entry as an exclusion in `.vscode/worktree.json`.
- Recording a switched source as that file's `extends`, creating the file when there is none.
- Re-reading and re-offering after a successful save, so the form describes the file on disk.

## Non-goals and must-nots

- **Must not write any path but `.vscode/worktree.json`** (plus its own lock and temporary), under
  any operation, in any repository state.
- **Must not re-serialize an existing configuration.** Edits are text edits against the original
  bytes; a parsed-and-reprinted file loses every comment.
- **Must not accept a path, a key or file text from the webview.** The webview names items by the
  ids the host issued and nothing else.
- No editor for provisioning entries. The dialog renders an entry's mode as a verb rather than a
  control, so there is no mode change to record; see design.md D6.
- No re-inclusion of an already-excluded path. Excluded rows are non-interactive, so the state is
  not reachable; undoing an exclusion is an edit to the file.
- Ports and setup steps are not written. `exclude` removes inherited entries by path and neither is
  an entry; a setup step's unticked state is its default rather than a preference (D6).

## Appetite

M. One new host module, one wire message, one dialog control, and the tests that hold the
never-write property.

## Risk

MEDIUM-HIGH, and it is the write itself rather than the feature. The target is a checked-in file
the user's editor and git may both hold, sitting beside files the extension must leave untouched,
and every path that reaches it originates in untrusted provider text.
