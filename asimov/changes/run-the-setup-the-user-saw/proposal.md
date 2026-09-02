# Proposal: run-the-setup-the-user-saw

## Why

The create form already displays setup commands and submits opaque item ids, but the host currently discards selected setup steps. A repository-supplied command therefore has neither an execution path nor the failure and retry state the form promises.

## Appetite

L (≤2w)

## Scope

### In scope

- Redeem selected setup steps from the exact host-held provisioning offer.
- Run them after materialization and ports with documented environment, bounded output, and per-step results.
- Honour the agent wait choice, preserve successful creates on failure, and provide row-scoped output and setup-only retry.
- Record materialization, port, and setup outcomes in the worktree administrative manifest.

### Out of scope

- Persisting trust or selecting setup by default.
- Retrying setup after an extension-host restart.
- Running setup for worktrees this extension did not create.
- Preserving VS Code task identity or dispatching through the task system.
- Rolling back a worktree or earlier provisioning after setup failure.

### Must not

- Execute command text or paths supplied by the webview.
- Re-read provider files after create submission to decide what runs.
- Concatenate a setup script into a shell command line or invent `ASIMOV_CHANGE_ID`.
- Let retry cross a removed-and-recreated worktree identity.

## Risk Level

HIGH — checked-in command execution crosses a trust boundary and must retain exact consent, target identity, sequencing, and process bounds.
