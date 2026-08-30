# Tasks: prove-a-task-can-run-where-the-worktree-is

## 1. Answer the question

- [x] 1_1 Make the extension-host test lane runnable on the declared engine floor — verified: pnpm run compile-tests && pnpm exec vscode-test && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D1, design.md D2
  - **Acceptance**:
    - Outcome: The host lane starts a real Extension Host and reports a passing suite
    - Verify: command pnpm run compile-tests && pnpm exec vscode-test
  - **Plan**:
    1. Create `./tsconfig.test.json` extending `tsconfig.json` and overriding `module` to `CommonJS`, `moduleResolution` to `Node10`, and `include` to the host-test directory only — the base config emits ESM `import` into a package with no `"type"`, which Node parses as CommonJS and rejects.
    2. Move `src/test/extension.test.ts` to `src/test/host/extension.test.ts` and replace its body with one `suite`/`test` asserting `vscode.workspace.workspaceFolders?.length === 1` — a check that fails if the host opened nothing, unlike the `[1,2,3].indexOf(5)` sample it removes.
    3. In `package.json`, point the `compile-tests` script at the new config so the host lane emits only host tests; the Vitest suites under `src/test/` must not reach the runner, because they import `vitest` and would fail under Mocha.
    4. Create `./.vscode-test.mjs` with `files` set to the compiled host-test glob, `version` set to the floor `engines.vscode` declares — `1.105.0`, never `stable` — and `workspaceFolder` set to the repository root so the host opens exactly one folder.
    5. In `vitest.config.mts`, replace the `src/test/extension.test.ts` entry in `test.exclude` with the host-test directory, so the Vitest lane skips the whole host lane rather than one filename — the existing entry exists for exactly this reason and moving the file breaks it.
    6. Run `pnpm run compile-tests && pnpm exec vscode-test` and confirm the host starts and the suite passes — never `pnpm run test`, whose `pretest` hook runs `biome check --write --unsafe src/`; the compile output and the editor download directory are already covered by `.gitignore`, so neither is added to it.

- [ ] 1_2 Record the directory a task scoped outside the workspace actually runs in
  - **Deps**: 1_1
  - **Refs**: design.md D1, design.md D3
  - **Acceptance**:
    - Outcome: The working directory of a foreign-scoped task is recorded for both scope forms
    - Verify: integration src/test/host/taskScopeOutsideWorkspace.test.ts
  - **Plan**:
    1. In `src/test/host/taskScopeOutsideWorkspace.test.ts`, create a directory under `os.tmpdir()` that is not the opened workspace folder, and a marker file path inside it.
    2. Build a `vscode.Task` whose execution is a `vscode.ShellExecution` with **no** `options.cwd`, running a command that writes the shell's own working directory to the marker path.
    3. Run it twice: once with the task's scope set to a `WorkspaceFolder` object constructed for the temporary directory, once with `vscode.TaskScope.Workspace`.
    4. For each run, await `vscode.tasks.onDidEndTaskProcess` for that execution before reading the marker, and fail with a distinct message on timeout so a hang is not reported as a wrong directory.
    5. Assert on the recorded path and put the observed value in the assertion message, so both outcomes name the directory that was used.
    6. Remove the temporary directory on the happy path; never write outside `os.tmpdir()`.

- [ ] 1_3 Make every document agree with what was recorded
  - **Deps**: 1_2
  - **Refs**: design.md D4
  - **Acceptance**:
    - Outcome: No blueprint document describes a setup step kind the experiment disproved
    - Verify: manual read design.md § Outcome, then grep docs/ for the `task` setup-step variant and confirm its presence matches the recorded verdict
  - **Plan**:
    1. Append an `## Outcome` section to `design.md` stating the observed directory for each scope form and the verdict it supports.
    2. When and only when the verdict is that a foreign-scoped task does not receive the foreign folder, remove the `task` variant from the `ProvisionSetupStep` union in `docs/design/worktree-provisioning.md`, from the apply step in `docs/design/worktree-apply.md`, and from `docs/design/worktree-rpc.md`.
    3. In the same case, restate the `.vscode/tasks.json` provider row in `docs/design/worktree-provisioning.md` § 3.3 as contributing shell steps whose command comes from the task entry, and say that identity is not preserved and why.
    4. In the same case, update `docs/PLAN.md` WT-012.11's Notes and Acceptance so neither names a task-system step, and mark WT-012.13's own Status per the workflow.
    5. On any other verdict, leave all four documents unchanged and record in `## Outcome` what stopped the answer from being conclusive.
  - **Boundary**: no change to any `src/` file
