## 1. The collision names a segment

- [x] 1_1 Send the taken candidate's last segment, not its path — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: specs/worktree-panel/spec.md#{a-collision-names-the-result-without-a-second-full-path}; docs/design/worktree-rpc.md#2-messages; docs/design/worktree-create.md#42-collision-states-a-segment-never-a-path
  - **Acceptance**:
    - Outcome: A collided create-defaults answer carries the taken directory name, never a path
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. In `src/providers/WorktreeHost.ts`, send `base` as `collidedWith` instead of `bare`. `bare` is `suggestFreePath(root, base, () => false)`, whose predicate never reports a collision, so it is exactly `join(root, base)` — the segment is already in hand and needs no `basename` call. Keep `bare` for the `path === bare` guard that decides whether a collision happened at all.
    2. Correct the field's doc comment in `src/types/messages.ts`: it says "the unsuffixed candidate", which is what made a path look correct here.
    3. Update the three `collidedWith` assertions in `src/providers/WorktreeHost.actions.test.ts` and the one in `src/extension.worktreeAssembly.test.ts` that expect a full path, and add a case asserting the value contains no path separator.
  - **Boundary**: no change to which answers carry the field — `path === bare` stays the test for whether a collision happened

- [x] 1_2 Stop marking an elision the value no longer has — verified: pnpm exec vitest run 'src/webview/worktree/WorktreeCreateDialog.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: specs/worktree-panel/spec.md#{a-collision-names-the-result-without-a-second-full-path}; docs/design/worktree-create.md#42-collision-states-a-segment-never-a-path
  - **Acceptance**:
    - Outcome: The collision line opens with the directory name, with no leading ellipsis
    - Verify: unit src/webview/worktree/WorktreeCreateDialog.test.ts
  - **Plan**:
    1. In `src/webview/worktree/WorktreeCreateDialog.ts`, drop the `document.createTextNode("…")` prepended to the collision note. It marked a truncation that the shortened value does not have, and it shortened nothing when the value was a whole path.
    2. Correct the `collidedWith` doc comment in `src/webview/worktree/worktreeViewTypes.ts` to say the value is a directory name.
    3. Add a case to `src/webview/worktree/WorktreeCreateDialog.test.ts` asserting the note's text starts with the name — the existing cases assert `toContain`, which a leading `…` satisfies, and that is why this survived.
  - **Boundary**: no rewording of the note beyond the ellipsis — its sentence shape is § 4.2's and is already met
