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

## 2. Make the one remaining action a push

- [x] 1_3 Land the branch-scoped Windows runner so the spike can be executed without a Windows machine — verified: node -e "const y=require('node:fs').readFileSync('.github/workflows/verify-windows-worktree-entry.yml','utf8'); for (const k of ['windows-2022','verify-windows-worktree-entry.mjs','persist-credentials: false','contents: read','workflow_dispatch']) { if (!y.includes(k)) { console.error('missing '+k); process.exit(1); } }" && pnpm exec tsc --noEmit -p tsconfig.json exit 0
  - **Deps**: 1_1
  - **Refs**: design.md
  - **Acceptance**:
    - Outcome: One workflow runs the committed spike script on Windows and prints its RESULT block
    - Verify: command node -e "const y=require('node:fs').readFileSync('.github/workflows/verify-windows-worktree-entry.yml','utf8'); for (const k of ['windows-2022','verify-windows-worktree-entry.mjs','persist-credentials: false','contents: read','workflow_dispatch']) { if (!y.includes(k)) { console.error('missing '+k); process.exit(1); } }"
  - **Plan**:
    1. Create `.github/workflows/verify-windows-worktree-entry.yml` modelled on orca's daemon-relocation spike workflow: `runs-on: windows-2022`, triggered on push to this branch only plus `workflow_dispatch`, `permissions: contents: read`, a `paths:` filter naming the spike script and the workflow itself, and a `concurrency` group.
    2. In the same file, give it three steps — checkout at v6 with `persist-credentials: false`, setup-node at v6 pinned to Node 22, and a run step invoking the already-committed spike script — with no package install, since that script imports only `node:` builtins.
    3. In the same file, head-comment WHY it exists and that it is the one action that needs a push, so a reader does not mistake it for the repository adopting CI generally.
