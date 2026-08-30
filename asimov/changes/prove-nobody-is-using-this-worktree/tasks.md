# Tasks — prove nobody is using this worktree

- [x] 1_1 Read the registry without discarding what it says — verified: pnpm exec vitest run 'src/vault/readers/runningSessions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D3
  - **Acceptance**:
    - Outcome: A record whose process is gone is returned as a dead record rather than skipped
    - Verify: unit src/vault/readers/runningSessions.test.ts
  - **Plan**:
    1. In `src/vault/readers/runningSessions.ts`, extract the per-file parse and validation — the guard that the file stem must agree with the pid it carries, the session-id and cwd guards, the name and startedAt handling — into one helper. It is the whole reason a second reader is safe to add.
    2. `listRunningClaudeSessions` keeps its exact signature, dedupe and live-only filter. Four call sites read it as "live sessions" and none of them changes.
    3. Add a second export returning every well-formed record with `alive`, from that same parse. Dedupe is the live reader's rule and does not apply: two records for one session id are two records here, because the question is whether ANY live process holds it.
    4. Cover in `src/vault/readers/runningSessions.test.ts`: a dead record appears with `alive: false` and is still absent from the live reader; an unreadable directory fails both the same way; a malformed file is skipped by both.
  - **Boundary**: `listRunningClaudeSessions` behaviour is unchanged — the tests that exist for it must pass untouched

- [x] 1_2 One reader for the worktree's own git directory — verified: pnpm exec vitest run 'src/worktree/worktreeGitDir.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: none
  - **Refs**: design.md D6
  - **Acceptance**:
    - Outcome: Both the manifest read and the lock read resolve the git dir through one function
    - Verify: unit src/worktree/worktreeGitDir.test.ts
  - **Plan**:
    1. New `src/worktree/worktreeGitDir.ts`: resolve a worktree's own git directory with `git rev-parse --absolute-git-dir` run inside it, returning the trimmed path or throwing on a non-zero exit. It is not derived from the repo git dir plus a basename — git disambiguates colliding basenames, so that derivation is wrong exactly where two worktrees share one.
    2. `diskIgnoredDeps` in `src/worktree/ignoredMaterial.ts` uses it instead of its inline copy; its existing manifest tests in `src/worktree/ignoredMaterial.test.ts` stay green.
    3. Cover in `src/worktree/worktreeGitDir.test.ts`: the trimmed path on success, a throw on a non-zero exit, and a throw on a timeout.
  - **Boundary**: no behaviour change to the manifest read — this is the same command, in one place

- [x] 2_1 The assessment filters the registry itself — verified: pnpm exec vitest run 'src/worktree/worktreeBlockers.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1
  - **Refs**: design.md D3; archive/260830-2042-assess-a-removal-before-offering-it/design.md D2, D6
  - **Acceptance**:
    - Outcome: The assessment is handed every registry record and decides itself which are live external sessions
    - Verify: unit src/worktree/worktreeBlockers.test.ts
  - **Plan**:
    1. `ExternalSessionFact` in `src/worktree/worktreeBlockers.ts` becomes `SessionRecord` and gains `alive`. `RemovalInput.externalSessions` becomes `RemovalInput.sessions`, carrying the records.
    2. `evaluateRemoval` filters to the live ones where it was previously handed them, covered in `src/worktree/worktreeBlockers.test.ts`. The predicate it applies is the one the producer applied — nothing about which sessions refuse changes in this task.
    3. `removalFacts.externalSessions` in `src/providers/WorktreeHost.ts` and its producer in `src/extension.ts` follow: the producer maps the raw records rather than the live-filtered list, and reads the registry exactly once as it does today.
    4. The fixtures in `src/worktree/removalChecks.test.ts`, `src/worktree/worktreeFingerprint.test.ts`, `src/worktree/worktreeMutationService.test.ts`, `src/providers/WorktreeHost.actions.test.ts` and `src/extension.worktreeAssembly.test.ts` follow the type.
  - **Boundary**: no change to what refuses — the live filter moves, its predicate does not

- [x] 3_1 Answer the three proofs — verified: pnpm exec vitest run 'src/worktree/orphanProofs.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 1_1, 1_2
  - **Refs**: design.md D4, D5, D6; specs/worktree-panel/spec.md#{the-merge-proof-reads-local-refs-and-never-fetches, the-ownership-proof-distinguishes-no-record-from-a-dead-record}
  - **Acceptance**:
    - Outcome: Each proof answers from its own named source and reports unproven rather than guessing
    - Verify: unit src/worktree/orphanProofs.test.ts
  - **Plan**:
    1. New `src/worktree/orphanProofs.ts` owning the three answers behind injected reads, so the suite needs neither a disk nor a git.
    2. Lock age: `notApplicable` when the worktree is not locked; otherwise the mtime of `locked` in the worktree's own git dir against a recorded 24-hour constant; unproven when it cannot be stat'd.
    3. Ownership: `passed` when no record is rooted in the worktree and when every record rooted there is dead; `failed` when one is alive; unproven when the registry could not be read. Containment through `src/utils/pathBoundary.ts` — never a hand-rolled prefix test.
    4. Merge: resolve the default branch by D4's ladder, then `git merge-base --is-ancestor <branch> <default>`. Map ONLY the two exit codes D5 records; everything else, including 128, is unproven. `notApplicable` when the worktree has no branch.
    5. Cover in `src/worktree/orphanProofs.test.ts`: every outcome of every proof, and specifically that a non-zero, non-one exit is unproven rather than failed, and that no argument list ever contains `fetch`.
  - **Boundary**: no fetch, ever — a stale local default reports unproven, never a wrong answer

- [x] 3_2 The proofs appear as checks, and change nothing else — verified: pnpm exec vitest run 'src/worktree/removalChecks.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 2_1, 3_1
  - **Refs**: design.md D1, D2; specs/worktree-panel/spec.md#{the-removal-assessment-reports-whether-the-worktree-looks-abandoned, a-proof-never-blocks-the-removal-it-accompanies}
  - **Acceptance**:
    - Outcome: A removal with every proof unproven is offered exactly as it is with no proofs at all
    - Verify: unit src/worktree/removalChecks.test.ts
  - **Plan**:
    1. `RemovalEvidence` in `src/worktree/worktreeBlockers.ts` gains the proofs, taken by the caller like the ignored walk is, because `evaluateRemoval` is synchronous and the reads are not.
    2. Three catalogue rows in `src/worktree/removalChecks.ts` with a constant `proof` class, reported from the `confirmable` branch only. Cover in `src/worktree/removalChecks.test.ts` and `src/worktree/worktreeBlockers.test.ts`.
    3. Assert in `src/worktree/worktreeMutationService.test.ts` and `src/worktree/worktreeFingerprint.test.ts` that the three call sites D2 names are unchanged: a proof does not make an unforced removal ask for confirmation, does not enter the digest, and does not re-prompt a granted one.
    4. `src/webview/worktree/WorktreeRemoveDialog.ts` scopes its "an unproven check withholds Force" guard to the checks a confirmation covers. That guard is about a risk set the dialog could not describe; a proof is not in it, and withholding force over one IS refusing a removal, which the Must-not forbids. Covered in `src/webview/worktree/WorktreeRemoveDialog.test.ts`.
    5. `src/providers/WorktreeHost.ts` supplies the field so the tree compiles — three `unproven` outcomes, which IS this task's Outcome. 3_3 replaces the constant with the reader.
  - **Boundary**: `atRisk`, `isIdentityPreservingSubset` and `digest` gain nothing — a proof is not a risk (D2)

- [x] 3_3 Take the proof reads where the assessment already suspends — verified: pnpm exec vitest run 'src/providers/WorktreeHost.actions.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_2
  - **Refs**: design.md D7
  - **Acceptance**:
    - Outcome: A removal assessment reports the proofs and issues no more suspension points than before
    - Verify: unit src/providers/WorktreeHost.actions.test.ts
  - **Plan**:
    1. `removalFacts` in `src/providers/WorktreeHost.ts` gains one proof reader, and `assessRemoval` takes it inside the `Promise.all` it already awaits — not after it.
    2. A `missing` worktree resolves the proofs without touching the disk: no directory means no lock file and no branch, so only the ownership proof is answered, from the registry read taken anyway.
    3. `src/extension.ts` supplies the reader over the existing runner and the records from 2_1's producer.
    4. Cover in `src/providers/WorktreeHost.actions.test.ts` that the proofs reach the assessment, and in `src/extension.worktreeAssembly.test.ts` that they survive the production boundary — a module test asserting against its own injected fake cannot see a wrapper that drops an argument.
  - **Boundary**: the assessment's await count does not grow — the reads join the existing suspension point

- [x] 4_1 Round-1 fixes: B1, B3(b), W2 — verified: pnpm exec vitest run 'src/worktree/orphanProofs.test.ts' && pnpm run check-types && pnpm run test:unit exit 0
  - **Deps**: 3_3
  - **Refs**: design.md D4, D5, D6, D7; .reviews/round-1.md
  - **Acceptance**:
    - Outcome: A default branch whose name contains a slash is compared against itself, and a lock read that never returns answers unproven instead of holding the assessment open
    - Verify: unit src/worktree/orphanProofs.test.ts
  - **Plan**:
    1. B1 — `resolveDefaultBranch` in `src/worktree/orphanProofs.ts` strips the exact remote-name prefix from what `symbolic-ref --short` reports and refuses an answer that does not carry it. Slicing after the LAST slash truncates a slash-separated default branch to its final segment, which is not a local head, so the ladder falls through to `main` and can prove a branch merged against a branch that is not the default. Probed on git 2.50.1.
    2. B3(b) — the lock read is bounded. `lockProof` races the git-dir read and the stat against a recorded deadline built from `src/worktree/deadline.ts`, answering `unproven` on expiry. It is one bounded stat of one small file, which is what design.md's failure-surface inventory already claims it is.
    3. W2 — the proof producer in `src/extension.ts` starts the lock and merge proofs immediately and joins the sessions promise only where ownership is evaluated. Neither of those two reads needs the registry.
    4. Cover in `src/worktree/orphanProofs.test.ts`: a slashed default resolves whole and beats a competing local `main`; a `--short` answer without the `origin/` prefix is refused; a stat that never returns answers unproven rather than hanging.
  - **Boundary**: no new invariant owner — the lock deadline is one bounded read answering unproven, NOT the shared in-flight read registry WT-013.1 round-5 W3 needs, which stays open and unwaived
