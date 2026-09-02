# Tasks: open-a-provider-file-without-waiting-on-it

## 1. A read that answers

- [x] 1_1 Add the helper that opens nonblocking and proves the handle regular — verified: pnpm exec vitest run 'src/utils/regularFileRead.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#a-configuration-path-that-is-not-an-ordinary-file-is-refused; design.md D1, D2, D3
  - **Acceptance**:
    - Outcome: opening a named pipe through the helper is refused instead of awaited
    - Verify: unit src/utils/regularFileRead.test.ts
  - **Plan**:
    1. Create `src/utils/regularFileRead.ts` exporting `readFlags(c: { O_RDONLY: number; O_NONBLOCK?: number }): number` returning `c.O_RDONLY | (c.O_NONBLOCK ?? 0)`.
    2. In the same file export `openRegularFile(filePath: string, open?: OpenLike): Promise<FileHandle>` which opens with `readFlags(constants)`, awaits `handle.stat()`, and when `isFile()` is false closes the handle and throws `Object.assign(new Error("not a regular file"), { code: "ENOTSUP" })`; `open` defaults to `node:fs/promises`'s `open` so a caller with injected filesystem dependencies can pass its own.
    3. Create `src/utils/regularFileRead.test.ts` with witnesses against a real temporary directory: a `mkfifo` path throws `ENOTSUP`, a directory throws, a hard link to an ordinary file and a symlink to an ordinary file both open and read, and `readFlags` returns `O_RDONLY` alone when the record carries no `O_NONBLOCK`.
    4. Race the pipe witness against a timer so a regression fails the test instead of hanging the suite, skip it when `process.platform === "win32"`, and arm-check by dropping the flag and then the stat.

- [ ] 1_2 Read every provider file through the helper
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#a-configuration-path-that-is-not-an-ordinary-file-is-refused; design.md D2
  - **Acceptance**:
    - Outcome: a pipe named as a source to build on is reported unreadable and declares nothing
    - Verify: unit src/worktree/provisioning/readProvisioning.test.ts
  - **Plan**:
    1. In `src/worktree/provisioning/provisioningDeps.ts`, replace `readBounded`'s `open(filePath, "r")` with `openRegularFile(filePath)` from `src/utils/regularFileRead.ts`, leaving the byte loop and the `finally` close as they are.
    2. In `src/worktree/provisioning/readProvisioning.test.ts`, add a witness building a real repository whose `.vscode/worktree.json` names `asimov/worktree.yaml` and whose `asimov/worktree.yaml` is a named pipe with no writer.
    3. Assert `readProvisioning(createProvisioningDeps(), root)` settles, that a problem with reason `unreadable` names the base, and that the model carries no entry inherited from it — the empty-configuration defeater in design.md's ledger.
    4. Race the call against a timer, skip on win32 with a comment saying why, and arm-check by restoring the plain `"r"` open.

- [ ] 1_3 Read a locked file through the helper, so the lock is never held on a wait
  - **Deps**: 1_1, 1_2
  - **Refs**: specs/worktree-panel/spec.md#a-refused-save-leaves-the-next-save-able-to-run; design.md D4
  - **Acceptance**:
    - Outcome: a save over a pipe target refuses and the next save of that path still runs
    - Verify: unit src/worktree/provisioning/writeNativeConfig.test.ts
  - **Plan**:
    1. In `src/agentHooks/install/lockedJsonFile.ts`, change `readText` to open through `openRegularFile(this.path, this.fs.open)` and read the handle instead of calling `this.fs.readFile`, keeping the existing absence branch that returns `undefined` and closing the handle in a `finally`.
    2. In `src/worktree/provisioning/writeNativeConfig.test.ts`, add a witness that makes `.vscode/worktree.json` a named pipe and asserts `writeNativeConfig` refuses rather than waiting.
    3. Add the raced witness design.md D4 names: an injected `lstat` that returns the real regular-file stat and, before returning, replaces the target with a named pipe — the save must still refuse.
    4. Assert in both that the sibling lock file the locked write creates does not remain, and that an immediately following save of the same path returns a verdict rather than the unavailable a stranded lock would produce.
    5. Race every call against a timer, skip on win32 with a comment, and arm-check by restoring `this.fs.readFile`.
