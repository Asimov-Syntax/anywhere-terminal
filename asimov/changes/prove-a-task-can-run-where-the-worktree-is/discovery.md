# Discovery: prove-a-task-can-run-where-the-worktree-is

## Context

`worktree-provisioning.md` § 3.3 reads `.vscode/tasks.json` as a provider, and the apply half runs
its steps as a `task`-kind step so the entry keeps its identity — problem matchers, task type,
variable resolution — rather than being flattened into a command string. That variant exists because
flattening loses what the task system supplies.

The doubt arrived from the API surface: `vscode.tasks.fetchTasks()` is documented as returning tasks
*managed by the editor*, and a worktree the create dialog just made is not a workspace folder. A
worktree is a plain directory on disk until someone opens it.

Two facts make this a change rather than a note. The subject is unimplemented, so settling it now
costs three document edits and settling it during build costs a rewritten spec. And the repository
cannot currently answer it: every test here runs under Vitest against a hand-written mock of the
`vscode` module, which by construction returns whatever the mock says.

## Options

### Option A — Stand up the extension-host harness (Recommended)

Add the missing `.vscode-test` config and one real host test, replacing the `yo code` sample.
Answers the question on the declared engine floor and leaves the repository with extension-host
coverage it has never had — the next two phases are almost entirely dialog and API behaviour, and
each question will hit the same mock wall. Costs a first VS Code download and a second test lane.

### Option B — Accept the source read

Record the `mainThreadTask` finding as a design decision with citations and act on it. Zero
infrastructure. Rejected: the evidence comes from the `vscode` working copy at 1.122.0 while this
extension declares `^1.105.0`, and the code in question is exactly the kind that moves between
releases. WT-012.13's acceptance also asks for a running experiment, so this option requires
amending the blueprint task before satisfying it.

### Option C — Throwaway probe

A scratch extension run once by hand in an Extension Development Host. Answers it at runtime without
adopting anything. Rejected: it needs an interactive session, cannot be re-run when VS Code updates,
and leaves the evidence as a paste rather than something the repository can re-check.

## Reuse — existing code to build on

| What | Where | Why it matters |
|---|---|---|
| `@vscode/test-cli` + `@vscode/test-electron` | `package.json` devDependencies | Already installed; the harness is a config file, not a new dependency |
| `test` script → `vscode-test` | `package.json` | The entry point exists and is wired to nothing |
| `compile-tests` → `tsc -p . --outDir out` | `package.json` | Already emits the JS layout `vscode-test` expects by default |
| `src/test/extension.test.ts` | repo | The sample to replace, and the proof that `suite`/`test` (Mocha TDD) is the expected style for host tests |
| `src/test/fixtures/repoFixture.ts` | repo | Existing fixture helper for building throwaway git repositories |

## Key Findings

**The host harness has never run.** `package.json` declares `test: vscode-test` and both
`@vscode/test-cli` and `@vscode/test-electron`, but there is no `.vscode-test.mjs` (or `.js`) config
anywhere, no `.vscode-test/` download cache in this worktree or in the main checkout, and no `out/`.
`src/test/extension.test.ts` is the generator's sample, asserting `[1,2,3].indexOf(5) === -1`.
`.gitignore` already covers `out` and `.vscode-test/`, so the scaffolding anticipated this and it was
never finished.

**Everything that runs today runs against a mock.** `src/test/__mocks__/vscode.ts` backs the Vitest
suites, including the two named `*.integration.test.ts`. Those integrate the extension's own layers,
not the editor. No test in the repository exercises a real `vscode` API.

**What the source says, on 1.122.0.** `$fetchTasks` delegates to `this._taskService.tasks(filter)`,
which enumerates configured workspace folders. `$executeTask` has two branches: the handle branch,
for a task previously fetched, resolves the folder through `getWorkspaceFolder(uri)` and rejects with
`No workspace folder` when that is null; the DTO branch, for a task the extension constructed, does
not require workspace membership and runs. So an extension-built task *executes*. What it does not
get is its folder: `TaskSourceDTO.to` sets `workspaceFolder` from `getWorkspaceFolder(URI.revive(scope))
?? undefined` for a URI scope, and for a numeric non-Global scope falls back to
`workspace.getWorkspace().folders[0]`. Either way the task is bound to a folder that is not the
worktree, silently.

**The version gap is the reason this is not already answered.** The read above is of a checkout at
1.122.0; `engines.vscode` is `^1.105.0`.

## Gap Analysis

| Component | Have | Need | Gap |
|---|---|---|---|
| Host test runner | `test: vscode-test`, deps installed | A config naming the compiled test glob and the VS Code version | One config file |
| Host test content | `yo code` sample | A test that builds a `vscode.Task` for a directory outside the workspace and reports the folder it received | Replace the sample |
| Version pinning | `engines: ^1.105.0` | The runner to fetch that version, not `stable` | One config field |
| Answer propagation | Three design docs and two PLAN tasks describe the `task` variant | Every one to agree with what the test observed | Edits gated on the result |
