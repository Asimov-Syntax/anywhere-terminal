# Tasks: prove-entry-reconstruction-on-windows

The reconstruction recipe in `docs/design/worktree-create.md` § 2.4 writes into git's own
administrative directory and was verified on macOS only. Every one of its four files carries a path,
one of them absolute. A platform where it half-works is worse than one where it plainly fails.

- [x] 1_1 Record the macOS control the Windows run is diffed against
  - **Refs**: docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: The recipe's result on the platform it was designed against is captured verbatim
    - Verify: command node scripts/verify-windows-worktree-entry.mjs
  - **Plan**:
    1. `asimov/changes/prove-entry-reconstruction-on-windows/evidence/darwin-control.txt` holds the RESULT block from running the existing harness on darwin.

- [ ] 1_2 Execute the recipe on Windows and record the answer
  - **Deps**: 1_1
  - **Refs**: docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: The Windows RESULT block is recorded in § 2.4, verdict either way
    - Verify: manual run scripts/verify-windows-worktree-entry.mjs on a Windows machine and record its RESULT block
  - **Plan**:
    1. On a Windows machine with git and node, run `node scripts/verify-windows-worktree-entry.mjs` in a clone of this repository and keep the RESULT block.
    2. `docs/design/worktree-create.md` § 2.4 records the verdict beside the macOS control — and, if the recipe does not work there, states that adoption is refused on Windows with the captured failure as the reason rather than offered and left to fail.
  - **Boundary**: The harness is not modified to make a platform pass. If it fails on Windows, the failure is the finding.
