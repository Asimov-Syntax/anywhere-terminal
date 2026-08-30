# Proposal: prove-a-task-can-run-where-the-worktree-is

## Why

The provisioning design admits a setup step of kind `task`: a `.vscode/tasks.json` entry in a newly
created worktree, run through VS Code's own task system so it keeps its identity. Reading
`mainThreadTask`'s implementation says the task system cannot target a directory that is not a
workspace folder — a foreign folder scope collapses to the current workspace's first folder or to
none at all. If that holds on the version users run, the variant is unbuildable and three design
documents plus two PLAN tasks currently describe something that does not exist.

## Appetite

M (≤3d)

## Scope

### In scope

- An extension-host test lane that actually runs: the repository has `@vscode/test-cli` installed
  and a `test` script, but no config, no cache in either checkout, and only the `yo code` sample.
- One host test that answers the question on the engine floor this extension declares, and records
  what it observed rather than a verdict.
- Propagating that recorded answer through the blueprint, whichever way it comes out.

### Out of scope

- Broad extension-host coverage. One question is being answered; a second test is a later decision.
- Migrating any existing Vitest test off `src/test/__mocks__/vscode.ts`.
- CI wiring beyond a runnable script.
- Implementing any provisioning step, including the `shell` variant the `task` variant may collapse
  into.

### Must not

- Leave any document asserting behaviour the experiment did not observe.
- Treat the source read against the `vscode` checkout at 1.122.0 as the answer. The declared engine
  floor is `^1.105.0`, and the branch in question is version-specific by nature.
- Delete the `task` variant on a partial result. Either the test observed the folder the task
  received, or the question is still open.

## Risk Level

LOW — nothing shipped depends on the answer, and the destructive half (removing a designed variant)
is a documentation change gated on evidence this change produces. The residual risk is spending the
appetite on harness setup and running out before the question is answered, which is why the harness
task is scoped to one config and one test.
