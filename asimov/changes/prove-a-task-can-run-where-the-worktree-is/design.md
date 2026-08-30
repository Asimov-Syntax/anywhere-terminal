# Design: prove-a-task-can-run-where-the-worktree-is

## Decisions

### D1: The question is settled on the declared engine floor, not on the newest VS Code

The host runner fetches the version this extension declares support for — `engines.vscode` is
`^1.105.0` — rather than `stable`.

The evidence that raised the doubt was read from a `vscode` working copy at 1.122.0, and
`TaskSourceDTO.to` is exactly the kind of internal resolution that moves between releases. An answer
from a newer editor than the floor would not license removing a variant, because the floor is what
users can be running. Where the two versions disagree, the floor is the answer and the disagreement
is itself worth recording.

### D2: The harness is one config and one test, replacing the sample

`.vscode-test` config names the compiled test glob, the version from D1, and a workspace folder to
open. `src/test/extension.test.ts` — the `yo code` sample asserting `[1,2,3].indexOf(5) === -1` — is
replaced rather than left beside the new test.

This is deliberately not the adoption of a second test culture. Vitest against
`src/test/__mocks__/vscode.ts` stays the default and nothing migrates to the host lane. The host lane
exists for questions the mock cannot answer by construction, and this is the first one. Leaving the
sample would mean the lane's first green run proves nothing.

### D3: The test observes the directory the task actually ran in, not a boolean

The extension host cannot read `mainThreadTask`'s internals, so the observation is made from outside:
the test builds a `vscode.Task` whose execution is a `ShellExecution` **with no explicit `cwd`**,
running a command that writes its working directory to a file under the temporary directory. After
the execution ends, the test reads that file and asserts on the path it contains.

Leaving `cwd` unset is the whole point. Setting it would make the shell run in the right place and
tell us nothing about what the task system resolved — the variant's claim is that the task keeps its
identity, and the folder it is bound to is that identity's load-bearing half. Two scopes are
exercised, because the source suggests they fail differently: a `WorkspaceFolder` object built for
the foreign directory, and `TaskScope.Workspace`.

The test records the observed path in its assertion message whichever way it goes, so a failure
report names the directory that was used instead of only saying the expectation missed.

### D4: Propagation is gated on the recording, and a partial result leaves the variant standing

The `task` variant is removed from `worktree-provisioning.md`, `worktree-apply.md`,
`worktree-rpc.md` and the affected PLAN tasks **only** when the test observed a directory that is not
the foreign one. Any other outcome — the task refused to run, the execution never ended, the observed
path was the foreign directory — leaves every document as it stands and records what happened.

An unbuildable variant that survives one release costs a rewritten spec later. A buildable variant
deleted on a misread costs a capability, silently, and nothing downstream would notice it was gone.
The asymmetry is why the destructive half needs the stronger evidence.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Host runner | First run downloads VS Code; a slow or offline machine looks like a hanging test | The download lands in `.vscode-test/`, already in `.gitignore`; the harness task's acceptance is a green run, so the download is paid once inside that task rather than inside the experiment |
| Version pinning | `^1.105.0` may resolve to a build the runner cannot fetch | D1 names the floor explicitly in the config; if the fetch fails, record the nearest fetchable version in the test's message rather than silently falling back to `stable` |
| Shell probe | A `ShellExecution` writing its `pwd` is shell-dependent, and the default shell differs by platform | The probe writes through the shell's own working-directory expansion and the test asserts on the file's contents; it runs on the developer platform only, and the finding it produces is about VS Code's resolution, which is platform-independent |
| Task lifecycle | `executeTask` resolves when the task *starts*, not when it ends; reading the file too early reads nothing | Await `onDidEndTaskProcess` for the execution before reading, and fail the test on a timeout rather than on a missing file — the two have different causes and only one of them is an answer |
| Blueprint propagation | Removing the variant touches four documents; a partial edit leaves them disagreeing | D4 gates the edit on the recorded outcome, and the propagation task's acceptance is that no document names the variant, checked across the whole tree rather than per file |
| `.vscode-test/` cache | Machine-local download cache outliving the run | Single writer (the runner); a crash mid-download leaves a partial extraction the runner re-fetches; a failed read fails open by re-downloading, because it is a cache with an authoritative remote |
| `out/` compiled tests | Build output outliving the run | Single writer (`compile-tests`); gitignored and regenerated wholesale, so a crash mid-write is repaired by re-running rather than by cleanup |
| Temporary directories the test builds | Foreign directory and any repository fixture outlive a crashed run | Created under the OS temporary directory so the OS reaps them; the test removes them on the happy path and never writes outside that root |
