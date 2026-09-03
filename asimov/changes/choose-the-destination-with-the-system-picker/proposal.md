# Proposal: choose-the-destination-with-the-system-picker

## Why

The create form states its destination and lets a user override it — by typing a full absolute path
into a text field inside a collapsed disclosure. That is the only way to put a worktree somewhere
else, and it asks the user to produce a path from memory in a field that shows nothing about where
they are. Every other place this product asks for a folder opens the system picker instead
(`fileTreeHost.ts`). The create form should too.

## Appetite

S (≤1d)

## Scope

### In scope

- A visible action beside the destination that opens the system folder picker and puts the chosen
  folder into the destination the form already has.
- The picked folder reaching the create through the SAME untrusted `path` field the typed override
  already uses, so nothing about how a destination is validated changes.
- A picker the user cancels leaving the form exactly as it was.

### Out of scope

- Changing how a destination is derived, shortened, validated, or displayed.
- Remembering a chosen folder across creates, or writing it to any configuration.
- A picker anywhere but the create form.

### Must not

- Give the webview a path the host will not re-resolve. The picked folder is a suggestion into an
  untrusted field, never an authorization.
- Let a picker that is open, cancelled, or failed leave the form in a state where Create is armed on
  a destination the user did not see.
- Change what happens when a destination is occupied, held, or would collide — those answers belong
  to the host and stay where they are.

## Risk Level

LOW — the picked value enters an existing untrusted field whose validation is unchanged. The new
surface is one request and one reply.
