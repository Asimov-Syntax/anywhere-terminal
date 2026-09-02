## 1. Stop the write-through, stop the foreign delete

- [x] 1_1 Stage the Cursor replacement exclusively, under an unpredictable name — verified: pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/agent-hook-installation/spec.md#a-replacement-is-staged-where-nothing-can-be-waiting-for-it; design.md D1
  - **Acceptance**:
    - Outcome: A symlink waiting at the staging name is refused, not written through
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. In `src/cursor/CursorHookInstaller.ts`, add an injectable `randomBytes` dependency beside the existing injected `now`, defaulting to `node:crypto`'s.
    2. In the same file, name the temporary in `atomicReplace` from 16 bytes of that dependency rendered as hex, replacing the `this.now()` segment, matching `lockedJsonFile.ts:120-124`.
    3. In the same method, replace the `this.fs.writeFile(temporaryPath, ...)` call with `this.fs.open(temporaryPath, "wx", mode ?? 0o600)`, write the contents through the returned handle, `chmod` through the handle when `mode` is defined, and close it in a `finally` before the rename.
    4. In `src/cursor/CursorHookInstaller.test.ts`, add a witness against a real temp directory that pre-places a symlink at the injected staging name pointing at a decoy file, asserts the replace fails, and asserts the decoy's contents are unchanged. Arm-check it by restoring `writeFile` and confirming the decoy IS overwritten.
    5. In the same test file, add a witness asserting the staging name contains neither the injected clock value nor the name a second staging of the same file produced.

- [x] 1_2 Give Cursor the shared lock instead of its own — verified: pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts src/cursor/CursorHookInstaller.runtime.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/agent-hook-installation/spec.md#a-release-removes-only-the-lock-the-operation-still-identifies; design.md D2
  - **Acceptance**:
    - Outcome: Cursor leaves a lock in place when the name no longer identifies the one it took
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts src/cursor/CursorHookInstaller.runtime.test.ts
  - **Plan**:
    1. In `src/cursor/CursorHookInstaller.test.ts`, extend the memory double FIRST: give handles returned by `open` a `stat` returning `{ isFile, dev, ino, nlink, mode }` at bigint precision, and give `lstat` the same fields, so `LockedFile` never falls through to the real `node:fs/promises` it spreads in at `lockedJsonFile.ts:80`.
    2. In the same test file, add a witness asserting a real temporary directory is untouched after a full install run, so a future partial double fails loudly instead of silently mixing filesystems.
    3. In `src/cursor/CursorHookInstaller.ts`, delete the private `acquireLock` and `lockPath` methods and the inline `unlink` release inside the private `withLock`.
    4. Rewrite that `withLock` to build a `LockedFile` on `this.options.configPath` with the installer's injected `fs`, `sleep` and `platform`, call its `withLock`, and capture the `LockRelease` in a local through the `onLockReleaseFailed` callback.
    5. After it returns, apply the existing `lockReleaseFailed(result)` transform when that local is set, so callers keep receiving `reason: "lock-release-failed"` exactly as WT-012.22 left it.
    6. Check the import against both `src/agentHooks/install/lockedJsonFile.ts` and `src/utils/lockedFile.ts` — peer commit `132d20ce` relocates it and is not on this branch — and record which one this branch used in workflow.md Notes.
    7. In the same test file, add a witness substituting a stable different file at the lock name before release, asserting the substitute survives and the result carries `lock-release-failed`.
    8. In the same test file, add a witness that schedules the substitution INSIDE the injected `lstat`'s return, so it lands between the comparison and the unlink, and assert the substitute IS unlinked. This is R2 and it stays red-by-design: name it so, and assert the current behaviour rather than a fix.

- [x] 1_3 State the four races where the code is — verified: bash -c 'f=docs/design/worktree-provisioning.md; for k in openat renameat R1 R2 R3 R4; do grep -q -- "$k" "$f" || { echo "missing $k"; exit 1; }; done' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: design.md D3; design.md D4
  - **Acceptance**:
    - Outcome: Section 7 names all four races, the declined syscall, and each one's remedy
    - Verify: command bash -c 'f=docs/design/worktree-provisioning.md; for k in openat renameat R1 R2 R3 R4; do grep -q -- "$k" "$f" || { echo "missing $k"; exit 1; }; done'
  - **Plan**:
    1. In `docs/design/worktree-provisioning.md` § 7, add one bullet in the voice of the bullets already there, carrying the R1-R4 table from design.md D3: for each, the mechanism that leaks, its trigger, and what a user can do about it.
    2. In the same bullet, name `openat` and `renameat` as the declined mechanism and record that both are `undefined` in this runtime, so a future Node exposing them is the reopening condition.
    3. In the same bullet, record that `0o600` on a lock is POSIX hygiene rather than a security claim, and does not produce an owner-only ACL on Windows, citing the existing note at `src/vault/VaultCacheStore.ts:191-196`.
    4. In `src/agentHooks/install/lockedJsonFile.ts`, extend the file header comment with one sentence pointing at that bullet for R2 and R3, which live at lines 291 and 190 of this file.
    5. In `src/cursor/CursorHookInstaller.ts`, add one comment line at the `LockedFile` delegation pointing at the same bullet for R4, rather than restating it.

## 2. What round 1 sent back

- [x] 1_4 Stage through the shared replacement instead of a copy of it — verified: pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts src/cursor/CursorHookInstaller.runtime.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_3
  - **Refs**: specs/agent-hook-installation/spec.md#a-replacement-is-staged-where-nothing-can-be-waiting-for-it; design.md D1
  - **Acceptance**:
    - Outcome: A failed staging discards only a temporary it still owns
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts src/cursor/CursorHookInstaller.runtime.test.ts
  - **Plan**:
    1. In `src/cursor/CursorHookInstaller.ts`, add a private helper returning a `LockedFile` on `this.options.configPath` built with the installer's injected `fs`, `sleep`, `platform` and `rename`, and use it from both the lock delegation and the staging, following `ClaudeHookInstaller.ts:359`.
    2. In the same file, delete `atomicReplace` entirely and call `stageReplacement(contents, mode)` then `commit("replace")` in its place, discarding on a failed commit.
    3. In the same file, delete the now-unused `randomBytes` dependency plumbing if nothing else reads it, and keep `now` only if another caller still does.
    4. In `src/cursor/CursorHookInstaller.test.ts`, add witnesses that fail the handle write, the chmod, and the replace after a successful exclusive create, each asserting the call reports failure and the user configuration is unchanged.
    5. In the same test file, add the F001 witness: after the exclusive create, substitute a different object at the staging name, force the replace to fail, and assert the substitute SURVIVES. Arm-check by restoring an unconditional unlink and confirming it is deleted.
    6. In the same test file, keep the existing symlink and unpredictable-name witnesses passing unchanged — they are the contract, not the mechanism.

- [x] 1_5 Stop delegation from creating a configuration directory Cursor never made — verified: pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: An absent config parent still refuses, and nothing is written
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. In `src/cursor/CursorHookInstaller.ts`, check the configuration file's parent directory before taking the lock and return the `lockUnavailable` value unchanged when it is absent, restoring the policy `LockedFile.acquireLock`'s recursive `mkdir` overrode.
    2. In `src/cursor/CursorHookInstaller.test.ts`, add a witness that `install()` against an absent parent returns `lock-unavailable` with the unresolved paths, and that the parent is still absent afterwards. Add the matching `uninstall()` case.

- [x] 1_6 Make the hybrid-filesystem guard able to fail — verified: pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_4, 1_5
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: An operation the Windows double omits raises instead of reaching the real filesystem
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. In `src/cursor/CursorHookInstaller.test.ts`, replace the temp-directory guard with a fail-fast double: wrap the memory filesystem so any property the fixture does not implement throws naming the operation, rather than being filled from the real `node:fs/promises` at `lockedJsonFile.ts:80`.
    2. In the same test file, add a witness that the wrapper throws for a deliberately omitted operation, so the guard itself is shown to fail when it should.

## 3. What round 2 sent back

- [ ] 1_7 Decline to create the parent, rather than checking for it
  - **Deps**: 1_6
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: A parent removed between the check and the lock is not recreated
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts src/agentHooks/install/lockedJsonFile.test.ts
  - **Plan**:
    1. In `src/agentHooks/install/lockedJsonFile.ts`, add `createParent?: boolean` to `LockedFileDependencies`, defaulting to `true` so `ClaudeHookInstaller` and `writeNativeConfig` keep their current behaviour.
    2. In the same file, skip the `mkdir(dirname, { recursive: true })` in both `acquireLock` and `stageReplacement` when that option is `false`.
    3. In `src/cursor/CursorHookInstaller.ts`, pass `createParent: false` from the `locked()` helper and DELETE the parent `stat` precheck in `withLock` — with no creation, the exclusive open returns `ENOENT` and `acquireLock` already answers `undefined`.
    4. In `src/cursor/CursorHookInstaller.test.ts`, add a witness that removes the parent directory between the acquisition attempt and the open, asserting the result is `lock-unavailable` and the parent is still absent.
    5. In `src/agentHooks/install/lockedJsonFile.test.ts`, add a witness that the default still creates a missing parent, so the two existing consumers are pinned.

- [ ] 1_8 Make the double's omissions throw on the path production takes
  - **Deps**: 1_7
  - **Refs**: design.md D2
  - **Acceptance**:
    - Outcome: An unmodelled operation fails the test instead of reaching the real filesystem
    - Verify: command pnpm exec vitest run src/cursor/CursorHookInstaller.test.ts
  - **Plan**:
    1. In `src/cursor/CursorHookInstaller.test.ts`, replace the `Proxy` with explicit throwing stubs as own properties for every `LockedFileSystem` operation the fixture does not model, so a spread copies them instead of dropping them.
    2. In the same test file, replace the direct-property-read witness with one that omits a modelled operation and drives `CursorHookInstaller.install()`, asserting the throw names the operation — the arm-check runs through production, not against the fixture object.
