# Review Round 1

- Date: 2026-08-27
- Cycle: 1
- Round: 1
- Mode: discovery
- Scope: working tree
- Reviewable lines: 3089
- Size note: Large change — accuracy may decrease.
- Agents spawned:
  - asm-review-data-security — destructive git boundary, untrusted refs/paths, and confirmation authorization — gpt-5.6-sol[1M]
  - asm-review-logic — mutation ordering, races, fingerprints, path validation, and removal classification — gpt-5.6-terra[1M]
  - asm-review-contracts — message contracts, approved obligations, test changes, and doc conflicts — sonnet[1M]
  - asm-review-frontend — shipped action affordances, dialogs, results, and stale UI state — gpt-5.6-terra[1M]
  - asm-review-performance — queue/fingerprint growth axes and action-path costs — gpt-5.6-luna[1M]
  - asm-review-reuse — production action seam and reuse of path/git/dialog infrastructure — gpt-5.6-luna[1M]
  - asm-finder — end-to-end production reachability trace — inherited model
- Agents skipped: none
- Verdict: REJECT
- Counts: BLOCK 5 | WARN 3 | SUGGEST 0
- Verification: `pnpm run check-types` passed; `pnpm run test:unit` passed (213 files, 4068 tests); focused mutation review passed (7 files, 158 tests). `git diff --check` found only blank lines at EOF in skipped change metadata.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic, asm-review-contracts, asm-review-frontend, asm-review-reuse
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:139
- title: The five mutation implementations are disconnected from the shipped extension
- evidence: The changed host declares all five capabilities as optional and its new message branches only call them when supplied. The sole production factory at `src/extension.ts:76-134` still returns only read-only actions, and the sole host construction at `src/extension.ts:341-386` uses that factory unchanged. The new queue, coordinator, blocker evaluator, fingerprint store, create validator, exclude writer, and git mutation verbs have no production callers. On the webview side, only Lock/Remove messages are posted; Create and Prune have no shipped entry path, `prunableCount` defaults to zero, and the Extension-to-WebView union has no mutation-result/defaults messages. `WorktreeView` reaches blockers/results only from fixture-injected data. Boundary inventory: UI entry, inbound routing, production capability construction, evaluation/coordinator/git, forced rebuild, and result delivery are affected for create/remove/lock/unlock/prune; existing read-only actions are verified safe from this mechanism.
- impact: Lock and Remove are present but inert, Create and Prune are absent, and none of the safety model or real git work is reachable. This materially diverges from the approved outcome that every offered mutation performs and reports reality.
- suggestedFix: Compose one production mutation service at the existing `createWorktreeActions`/host construction seam, wire all five capabilities and their dependencies, add typed host-to-webview defaults/results and controller state, and prove the actual extension construction end to end rather than injecting spy capabilities or fixture results.
- status: accepted
- triage: Verified independently, not taken on the chair's word: `createWorktreeActions` (src/extension.ts) returns the read-only capability set only, and `rtk proxy grep -rln` over `src/` shows every new module — mutationQueue, mutationCoordinator, worktreeBlockers, worktreeFingerprint, createPath, gitExclude, worktreeMutations — referenced by nothing but its own test file. The finding is squarely inside the accepted contract: proposal.md:8-9 states this change "makes the host actually evaluate what is at risk, and makes the actions run", and specs/worktree-panel/spec.md#the-panel-s-mutating-actions-perform-what-they-offer is a Ref on tasks 3_2 and 4_1. Task 4_1 Plan step 1 leased WorktreeController and I supplied the WEBVIEW half; the HOST half — the production supplier at the extension.ts action-construction seam — was never in any task's Plan. That is a planning gap I executed faithfully and did not catch, not a chair error. Fixing it is remediation of the accepted outcome, not new scope.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:147
- title: Existing worktree targets are collapsed to paths before the queue and rebuild barrier
- evidence: The changed mutation capability signatures accept only `path` for remove/lock/unlock. Their handlers call `actionPath` immediately against the current cache and pass `displayPath` onward. They do not carry the original `repoId` plus host-issued `worktreeId`, so a future capability cannot re-resolve that identifier after `MutationCoordinator` acquires the per-repo queue and awaits the forced rebuild. Boundary inventory: inbound ID, repo ownership, queue wait, pre-action rebuild, post-wait target resolution, and final path derivation are affected for remove/lock/unlock; create has a separate untrusted-path invariant and prune is repo-scoped.
- impact: A queued action can run after the selected registration disappeared or was replaced at the same path; forced remove can therefore recursively delete a different worktree incarnation than the user selected.
- suggestedFix: Pass `{ repoId, worktreeId, ...request }` into mutation capabilities. Inside `MutationCoordinator.run`, resolve the ID against the freshly rebuilt repo and derive `displayPath` only from that result immediately before blocker evaluation and git.
- status: accepted
- triage: Confirmed at WorktreeHost.ts:439-444 and its five call sites (:492, :524, :538, :546, :563, :570, :579): `actionPath(msg.worktreeId, ...)` reads the CACHED listing at message-handling time and passes only the resolved `displayPath` onward, so the capability holds no id to re-resolve with. This directly contradicts two accepted authorities the tasks already cite — design.md D12's "re-resolve the target id / re-validate the path" AFTER the forced rebuild barrier, and specs/worktree-tree-protocol/spec.md#a-mutating-action-resolves-its-own-target. The coordinator I built in 1_2 has a `resolve()` step precisely for this and production hands it nothing to resolve. Accepted.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/createPath.ts:110
- title: Windows paths bypass the lexical symlink check and break create-root detection
- evidence: `firstSymlinkedComponent` splits `C:\\safe\\link\\new` into `C:`, `safe`, `link`, `new` but starts reconstruction from `\\`, probing `\\C:`, `\\C:\\safe`, and so on rather than the drive-rooted path. UNC roots are likewise lost, and the first failed `lstat` returns safe without examining later components. The same module uses `nodePath.posix.dirname/join` for detected Windows worktree parents and suggested paths. A direct Node check reproduced the invalid probes. Boundary inventory: drive-root lexical walk, UNC lexical walk, linked-worktree parent detection, relative-root absolutization, and free-path suggestion are affected on Windows; the POSIX lexical walk is verified safe from this mechanism.
- impact: A Windows symlink/junction component can be resolved away by normalization and reach git despite the explicit rejection barrier; ordinary Windows layout detection can also return `.` or malformed destinations.
- suggestedFix: Select the platform path API throughout. Start component walking from `api.parse(raw).root`, iterate only the relative components, and add drive-rooted, mixed-separator, UNC, junction/symlink, root-detection, and suggestion tests.
- status: accepted
- triage: Confirmed by reading createPath.ts:110-113: `raw.split(api.sep)` with `let current = api.sep` reconstructs from a bare separator, so on win32 `C:\\safe\\link\\new` walks `\\C:`, `\\C:\\safe` — paths that do not exist, so `lstat` returns null and firstSymlinkedComponent returns null on the FIRST component. The symlink barrier that this function exists to be does not fire at all on Windows; it fails open, which is the worst direction. Separately confirmed at :171, :186, :205 that detection and suggestion use `nodePath.posix` unconditionally while validation uses the injected `api`. Both halves accepted. The mixed-separator and UNC cases named in the fix are in scope for the walk; genuine UNC path-aliasing stays out per proposal.md:49-50.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/createPath.ts:97
- title: Create validation cannot re-check the filesystem identity required by D6
- evidence: The approved D6/spec requires recording and re-checking the identity of an existing candidate directory or nearest existing ancestor after the queue wait. `lstat` exposes only `isSymbolicLink()` and `isDirectory()`, while `CreatePathResult` stores only a path string plus `mustBeEmpty`. Re-validating can show that a replacement is also an empty directory, but cannot prove it is the same filesystem object. No production path performs the promised second validation either. Boundary inventory: existing candidate identity, absent-candidate ancestor identity, queue wait, second lexical/normalization pass, emptiness, and immediate pre-spawn comparison are affected; the initial POSIX symlink and emptiness checks are separately present.
- impact: Another process can replace the validated empty candidate or ancestor during the queue wait, and the create can run on an object the original validation never authorized.
- suggestedFix: Capture a stable platform-appropriate file identity from `lstat` (for example device/inode or Windows file identity), carry it in the validation result, and immediately before git rerun lexical validation/normalization/containment/emptiness and require the recorded identity to match.
- status: accepted
- triage: Confirmed: the injected `lstat` is typed `{ isSymbolicLink(): boolean; isDirectory(): boolean } | null` (createPath.ts:13) and exposes no device/inode, so `recheckPath` + `mustBeEmpty` can only re-answer "does something empty exist here", never "is it the SAME something". design.md D6 says the pipeline records "the identity of the candidate itself when it exists, else its nearest existing ancestor" — the implementation records its PATH and calls that identity. I wrote both the decision and the code, and the code does not do what the decision says. Accepted rather than handed back to plan, because D6 as written is the correct contract and the implementation is what is short of it. Windows caveat to be stated explicitly at the fix, not silently absorbed: `fs.Stats.ino` is not a reliable identity on Windows, which lands inside the residual proposal.md:49-50 already declares unsupported — that residual must be NAMED in the code, not left implied.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeFingerprint.ts:43
- title: Removal confirmations are replayable and not bound to one mutation attempt or target incarnation
- evidence: `verify` checks the path-like `worktreeId`, digest, age, and blocker subset, but it never consumes the issued record and the digest has no registration/filesystem incarnation token. The record remains valid after `proceed`, after a failed or indeterminate attempt, and after the old worktree is removed and another is created at the same path. Boundary inventory: issuance, same-live-target subset comparison, expiry comparison, atomic consumption, mutation attempt, indeterminate/error retry, target disappearance, and same-path recreation were searched; subset and TTL checks are present, while consumption and incarnation binding are absent.
- impact: Within the TTL, a duplicated or stale webview message can retry a partially applied forced removal or authorize recursive deletion of a newly created worktree whose current blockers are a subset of the old set. This violates the no-retry and stale-authorization safety contract.
- suggestedFix: Make confirmations single-use by atomically consuming them before spawning git, invalidate them on every attempt/outcome, and bind them to a stable registration/filesystem incarnation captured during post-barrier resolution rather than to path alone.
- status: accepted
- triage: Confirmed: worktreeFingerprint.ts has no delete path at all — not on successful verify, not after an attempt, not on expiry. A digest therefore stays redeemable for its full 2-minute TTL across any number of messages, and it binds `worktreeId` (a path) plus blocker evidence, so a same-path recreation inherits the old authorization. For the single irreversible action in this change this is the exact property the fingerprint exists to deny: specs/worktree-tree-protocol/spec.md#a-confirmation-authorizes-one-blocker-set-and-no-other is not satisfied by a token that authorizes one blocker set REPEATEDLY. Note this is not eligible for risk-acceptance in any case (destructive/irreversible). Accepted; W2's eviction is folded into the same fix.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/mutationQueue.ts:42
- title: A synchronous mutation body throw leaves the repository permanently busy
- evidence: `finallyDecrement(body(), ...)` evaluates `body()` before entering the cleanup helper. If it throws synchronously, the tail rejects and later work can run, but `bump(repoId, -1)` is never called.
- impact: `isBusy(repoId)` can remain true forever, corrupting any quarantine or shutdown decision that relies on the queue's advertised busy state.
- suggestedFix: Defer invocation with `Promise.resolve().then(body)` before attaching cleanup, and add a synchronous-throw test.
- status: accepted
- triage: Confirmed at mutationQueue.ts:42: `body()` is evaluated as the argument to `finallyDecrement`, so a synchronous throw propagates before the try/finally is entered and `bump(repoId, -1)` never runs, stranding `depth` and pinning `isBusy(repoId)` true for the host's lifetime. Treated as must-fix rather than should-fix despite WARN severity: `isBusy` is what a caller consults before offering a mutation, so a stuck true silently disables mutations for that repo. Cheap fix with a direct RED test.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-performance
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeFingerprint.ts:33
- title: Expired fingerprint evidence is never evicted
- evidence: The `issued` map deletes nothing on expiry, mismatch, successful verification, target removal, or abandoned confirmation. Growth axis is distinct worktree IDs ever confirmed during the extension-host lifetime, and each retained value holds all dirty/untracked paths plus pane and external-session IDs. The actual bound is historical evidence, not current worktrees or the two-minute TTL.
- impact: Repeated create/remove/confirm cycles retain potentially large blocker sets monotonically for the host lifetime.
- suggestedFix: Consume records on attempts, delete expired/mismatched entries during issue/verify, and add a bounded sweep or timer so abandoned records expire without a later verification.
- status: accepted
- triage: Confirmed — same absence of any delete path as B5. Growth is bounded by distinct worktrees confirmed per host lifetime rather than by the documented TTL, and each record retains the full evidence arrays. Fixed together with B5, since consuming on attempt is the same edit; expiry-eviction on access is the separate half.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-contracts
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/types/messages.ts:669
- title: Several mutation message shapes diverge from the accepted RPC contract without recorded deltas
- evidence: `docs/design/worktree-rpc.md:89-92` declares create fields `branchName/createBranch`, one `worktreeLock { locked }` message, and prune `{ repoId }`. The changed types rename/drop/add create fields, split lock/unlock, and require `confirmedCount`. D3 explicitly records the remove fingerprint delta and D9/D13 explain agent removal and count confirmation, but the remaining shape changes are not listed as resolved reference conflicts or delta-spec obligations.
- impact: Blueprint consumers and future callers can implement against incompatible message contracts, especially while the new end-to-end wiring is being repaired.
- suggestedFix: Record each intentional protocol delta in the change specs/design and include all of them in Blueprint Sync; otherwise align the implementation to the accepted RPC table.
- status: accepted
- triage: Not yet verified line-by-line against docs/design/worktree-rpc.md § 3-§ 4; accepted on the chair's evidence because the remedy is identical either way — Blueprint Sync already owes those sections an update, and the correct discipline is to enumerate every intentional protocol delta there rather than let the shipped shapes and the accepted table diverge silently. Joins the two doc outliers already queued for sync (worktree-actions.md:349 and :132-134). Explicitly gated: this change does not archive until sync is done.

## Adjudication notes

- The five BLOCKs are independent: B1 is total production disconnection; B2 is post-queue target identity for existing worktrees; B3 is Windows lexical/platform handling; B4 is filesystem-object identity across the create queue wait; B5 is confirmation replay/incarnation binding.
- The four inherited assertion replacements were judged legitimate local contract moves, not weakened assertions: removing the agent option follows approved D9; the two context-menu replacements correctly light Lock/Remove while keeping launch absent; and prune stderr is verified by real git. They do not, however, prove the shipped full flow—B1 remains because the tests inject spy capabilities and fixture results instead of traversing production construction and result delivery.
- The five exhaustiveness-guard additions correctly keep declared message inventories compiling, but they prove enumeration/routing only. They do not establish that optional capabilities exist in production or that results return to the webview.
- Resolving the two cited accepted-doc conflicts in the approved change design was appropriate while Blueprint Sync remains pending: the busy-agent rule is resolved against §3.3/shipped refusal behavior, and create-inside-main is resolved against the RPC/default-root contract. The change must not archive before those source docs are synchronized. W3 records additional protocol deltas that should join that sync list.
- The indeterminate notice's unconfirmed Prune button, external-session handling, identity-set fingerprints, lexical-before-normalize order, nested-worktree refusal, absence/rejection of `openAfter: "agent"`, and unconditional indeterminate classification for killed removal were reviewed as deliberate context and were not reported as defects.
- No audit-backlog or accepted-risk entries apply.
