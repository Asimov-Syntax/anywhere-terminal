# Review Round 2

- Date: 2026-08-27
- Cycle: 1
- Round: 2
- Mode: verification
- Scope: working tree — remediation diff since round 1
- Scope lock: passed — changed production work is remediation for accepted round-1 findings; task/workflow edits are completion metadata
- Reviewable lines: 896
- Size note: Large change — accuracy may decrease.
- Agents spawned:
  - asm-review-data-security — destructive authorization, blocker evidence, fingerprint incarnation, and create-path identity — gpt-5.6-sol[1M]
  - asm-review-logic — queue/coordinator/service assembly, rebuild ordering, and removal classification — gpt-5.6-terra[1M]
  - asm-review-frontend — real panel entry paths, outcome delivery, prune/create data, and surfaces — sonnet[1M]
- Agents skipped:
  - asm-review-contracts — the verification cone's contract obligations were checked chair-side; no independent schema/API region
  - asm-review-performance — W2's bounded store fix was directly verified; no other growth-axis change
  - asm-review-reuse — no remediation split or duplicate implementation warranted a separate lens
- Verdict: REJECT
- Counts: BLOCK 6 | WARN 1 | SUGGEST 0
- Verification: `pnpm run check-types` passed; focused round-2 verification passed (7 files, 126 tests); `pnpm run test:unit` passed (215 files, 4100 tests); `git diff --check` passed.

## Current findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic, asm-review-frontend
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:160
- title: The production mutation flow remains incomplete at destructive admission, UI entry, and result delivery
- evidence: The extension now supplies five host capabilities and lock/unlock reach git through the coordinator, but the invariant-level flow is still disconnected in several material places. Initial remove posts `force: false`; the service evaluates blockers only inside `if (force)`, so clean git state with idle panes or external sessions goes directly to `git worktree remove`, while `issueFingerprint` has no production caller and no confirmation can be issued. Create has an `onCreateSubmit` callback but no `createDialogDeps` and no production caller of `openCreateDialog`; the host sends no create defaults. Prune reads a cast-only `prunableCount` absent from `WorktreeRepo`, and `WorktreeView` also fails to pass the count accessor to `WorktreeContextMenu`, so its menu gate is permanently zero. `report` posts an undeclared `worktreeMutationResult` shape that has no message-union member, router handler, controller state, or translation to `WorktreeActionResult`; it also hard-codes sidebar/panel and bypasses attached editor surfaces. Create never calls `gitExclude`, and `afterCreate` silently does nothing for the offered `terminal` mode.
- impact: Create and prune still cannot be initiated by a real user; removal can irreversibly delete a worktree without evaluating non-git blockers; no surface can render success, failure, indeterminate, or confirmation-needed outcomes; editor surfaces are excluded even after a receiver exists; create can leave the parent dirty and can silently drop the requested terminal follow-up. This is the same shipped-flow invariant round-1 B1 froze, only partially repaired.
- suggestedFix: Complete one typed end-to-end flow: assess every initial removal and return refusal/confirmation evidence with a service-issued token before git; add host-issued create defaults and prune counts; wire real create/prune affordances; add typed outbound result/default messages and controller state; broadcast through the host's attached-surface registry; integrate `gitExclude`; and either implement terminal creation on the originating surface or remove that offered mode. Prove each path from production construction through a real UI entry and rendered outcome.
- status: persists from round 1
- triage: B1 is not closed by “wired end-to-end but unavailable” paths. The accepted requirement says every offered mutation performs and every impossible action is absent. Create and prune are absent because required host data was not supplied, removal skips its safety admission, and results are not consumable anywhere. The lazy service construction itself is sound; the surrounding assembly is not complete.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/createPath.ts:157
- title: The Windows fix makes POSIX backslash components fail the lexical symlink barrier open
- evidence: `firstSymlinkedComponent` now splits with `/[\\/]/` on every platform. On POSIX, backslash is a legal filename character, not a separator. For `/safe/foo\\bar/link/new`, the real component is `foo\\bar`, but the code probes `/safe/foo`; if that path is absent it returns `null` immediately and never lstats the real later symlink `/safe/foo\\bar/link`. A direct Node reconstruction produced probes `/safe`, `/safe/foo`, `/safe/foo/bar`, ... rather than the supplied lexical components. The new Windows drive/UNC root walk itself is corrected.
- impact: A user-supplied POSIX create path can hide a symlink behind a component containing `\\`, reach normalization, and create at the link target despite the explicit pre-normalization rejection barrier.
- suggestedFix: Split with the selected platform API: POSIX only on `/`; win32 on both accepted separators (or normalize win32 separators lexically without changing POSIX component names). Add a POSIX backslash-in-component case containing a later symlink, alongside the new drive and UNC tests.
- status: persists from round 1
- triage: The original Windows instance is fixed, but the same lexical-component invariant and same early-miss/fail-open mechanism now affect POSIX because the remediation applied the mixed-separator split unconditionally. Under the invariant rule this remains B3 rather than becoming a new ID.

### B4

- ID: B4
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeMutationService.ts:229
- title: The service records and compares create identity only after the queue wait, not across it
- evidence: The only production `validateCreatePath` call is inside the coordinator body after the queue and rebuild barrier. It records `recheckIdentity`, then immediately performs one `lstat` comparison. No validation result or filesystem identity is captured before queueing, so D6's required second lexical/normalization/containment/identity/emptiness validation across the wait does not exist. The returned `mustBeEmpty` field is never consumed by the service, so emptiness is not rechecked together with identity immediately before git. The tests prove that two separately invoked validations can observe different inodes, but no service test proves the two-phase production sequence.
- impact: The added identity data does not protect the interval the accepted design assigned it to, and a same-inode content change between validation and spawn is not rechecked. The implementation therefore still does not satisfy the create-path execution barrier frozen in round 1.
- suggestedFix: Validate and retain the first result before entering the coordinator queue; after the rebuild barrier rerun the complete validation pipeline, require path/containment/type/emptiness to remain valid, and compare the recorded candidate-or-ancestor identity immediately before spawning git. Add a service-level ordering test that mutates the filesystem while the create is queued.
- status: persists from round 1
- triage: Widening `lstat` and carrying `dev:ino` fixed the data-model half of B4, but the production caller does not perform the required two observations across the queue boundary. The declared `ino === 0` fallback is treated as the already-named unsupported filesystem/path-alias residual, not as a separate finding here.

### B5

- ID: B5
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1265
- title: Confirmation redemption is single-use only on the happy read path and is still not bound to a unique incarnation
- evidence: The store's `redeem` method deletes records on every verdict, but the service bypasses it entirely when `assessRemoval` is unavailable (`current === null`), leaving a submitted token live for retry. Separately, production defines incarnation as `${head}:${branch}`; remove and recreate at the same path, branch, and commit reproduces the same worktreeId and incarnation, so an unspent old token still hashes for the replacement registration. The code itself acknowledges the marker is not perfect.
- impact: A forced request that encounters a transient evidence failure can reuse the same token later, and a confirmation for an old worktree can authorize recursive deletion of a newly created same-path worktree. Both violate the one-attempt, same-incarnation authorization invariant.
- suggestedFix: Atomically consume any submitted token before every forced-request exit, including unavailable evidence. Bind issuance/redemption to a registration-specific identity that cannot survive replacement, such as a stable filesystem identity for the worktree `.git` file/admin entry or a host generation invalidated when disappearance/replacement is observed; fail closed when no such identity is available.
- status: persists from round 1
- triage: The assertion moved before redeem is legitimate and stronger: it proves replacement while the record exists, then separately proves redeem consumes it. The store implementation fixes normal replay and W2 eviction, but the service short-circuit and repeatable `head:branch` marker leave B5 open.

### B6

- ID: B6
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:1287
- title: Blocker-source failures are fabricated as empty or authoritative evidence
- evidence: A non-zero, timed-out, or failed-to-spawn `git status --porcelain` becomes `porcelain: ""`, which `evaluateRemoval` reads as clean. `listRunningClaudeSessions` deliberately returns `{kind:"failed"}` separately from a successful empty scan, but extension production maps failure to `[]`. A forced repo rebuild can retain a last-good listing marked `repo.degraded`; `assessRemoval` does not reject that stale listing before evaluating lock, containment, and target facts. Boundary inventory: dirty/untracked status, external-session registry, and authoritative worktree listing fail open; pane-store reads are synchronous and the target/repo ownership check itself fails closed.
- impact: A confirmation can omit modified/untracked files, external live sessions, a changed lock, or nested registrations, then authorize an irreversible forced removal against a blocker set the host never successfully read.
- suggestedFix: Preserve typed read outcomes through `removalFacts`; return unavailable assessment on any failed/timed-out status, failed registry scan, or degraded/non-authoritative listing; issue no fingerprint and run no git until every blocker source produced an authoritative observation. Add one test per failed source.
- status: new
- triage: This is independent of B1: even after the initial assessment/confirmation path is connected, its inputs fail open. It is BLOCK because the result authorizes irreversible deletion while claiming absent evidence.

### B7

- ID: B7
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:392
- title: Post-removal observation is neither independent nor able to report an unauthoritative listing
- evidence: `observeAfter` uses `bindings.resolve(target)` for both facts. When the registration is absent it returns `{isRegistered:false, existsOnDisk:false}` without statting the journaled worktree path, despite the comment naming those as separate questions. When a rebuild retained a degraded last-good listing, `resolve` returns that stale registration and there is no signal that the listing was unauthoritative, so `observeAfter` never returns the `null` that `classifyRemoval` reserves for listing failure.
- impact: A successful git exit can be reported `ok` while a directory remains or was recreated, and a non-zero removal followed by a failed listing can be reported as a clean error against stale cache. Both hide the indeterminate state D11 exists to surface after potentially partial deletion.
- suggestedFix: Pass the pre-operation journal/path into post-observation; always stat that path independently of registration lookup; expose rebuild/listing authority from the host and return `null` on degraded or failed listing. Add cases for “registration gone, directory remains” and “post-attempt listing failed”.
- status: new
- triage: This is a new defect in the B1 remediation service's observation seam, not the same mechanism as blocker admission. It directly violates D11's independent registration/filesystem comparison and failed-listing rule.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/types/messages.ts:669
- title: Mutation protocol deltas remain unsynchronized, and the claimed outbound messages still do not exist
- evidence: The round-1 shape divergences from `docs/design/worktree-rpc.md` remain. Round-2 task 6_4 additionally names outbound mutation-result and create-defaults messages, but `ExtensionToWebViewMessage` has no such members; production sends an untyped object instead. No Blueprint Sync edit is present in this verification diff.
- impact: Blueprint consumers still see incompatible create/lock/prune contracts, and the missing typed outbound contract helped the result-delivery gap in B1 compile cleanly.
- suggestedFix: Add the actual typed outbound messages and handlers, enumerate every intentional protocol delta in the change's Blueprint Sync, and do not archive until the source design is updated.
- status: persists from round 1
- triage: No remediation for W3 was supplied. It remains a warning and does not change severity merely because B1 now demonstrates one consequence.

## Fixed findings

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/WorktreeHost.ts:632
- title: Existing targets now carry repoId plus worktreeId and re-resolve after the rebuild barrier
- evidence: Host dispatch derives the queue repo from the host cache but passes the unresolved pair. `worktreeMutationService.withTarget` crosses the coordinator's forced rebuild before calling `resolve`, verifies repo ownership, and uses git's current display path. Stale targets run no command and the coordinator still performs its trailing rebuild.
- impact: The queued-action replacement/path-collapse mechanism from round 1 is closed.
- suggestedFix: none
- status: fixed
- triage: B2's complete boundary inventory—message id, repo ownership, queue wait, forced rebuild, post-wait resolution, and final git path—was verified. No same-mechanism bypass remains in the remediation cone.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-logic
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/mutationQueue.ts:45
- title: Synchronous throws now release queue depth
- evidence: `body` is passed uncalled into `finallyDecrement`, invoked inside `try`, and released in `finally`; the focused test verifies `isBusy` becomes false after a synchronous throw.
- impact: The repository no longer remains permanently busy by this mechanism.
- suggestedFix: none
- status: fixed
- triage: Verified by code and focused test.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: chair, asm-review-data-security
- file:line: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/worktree/worktreeFingerprint.ts:58
- title: Expired fingerprint records are evicted on access and normal redemptions consume them
- evidence: `issue` and `redeem` sweep records older than the TTL, and `redeem` deletes the keyed record before its normal verdict branches. Growth is bounded by confirmations issued within the TTL plus abandoned records until the next access, rather than host lifetime history.
- impact: The historical-evidence accumulation mechanism from round 1 is closed.
- suggestedFix: none
- status: fixed
- triage: W2 is fixed independently of B5's remaining service short-circuit and incarnation defects.

## Adjudication notes

- The lazy `mutations()` closure is sound: it is not invoked during host construction, and its captured `worktreeHost`, tree deps, sidebar, and panel bindings are initialized before a webview can send a mutation. No initialization-order finding survives.
- The deliberately incomplete create and prune UI paths are not defensible as closure of B1. They are safe as absence, but the accepted outcome for this change is to make all five actions perform; recording later work in tasks does not satisfy that obligation.
- `assessRemoval` treating status failure as clean is a BLOCK, joined with the external-registry and degraded-listing boundaries in B6's fail-closed inventory.
- `head:branch` is not a sufficient incarnation marker. It improves path-only binding but leaves the exact remove/recreate case from B5 reachable.
- The fingerprint replacement assertion moved before redemption legitimately. Measuring size after a consuming redeem would no longer test replacement; the new test measures one record before spend and zero after spend.
- The Windows root/platform API fix is valid for drive and UNC lexical walking. B3 stays open only because the unconditional mixed-separator split introduced the POSIX backslash-component bypass.
- The `ino === 0` behavior is treated as the explicitly named unsupported-identity/path-alias residual from round-1 triage. It is not counted as a separate finding; B4 remains open for the missing production two-phase validation instead.
- No audit-backlog or accepted-risk entries apply.

---

## Author triage — round 2

Appended by the builder before any round-2 fix edit. The `status`/`triage` fields
above are the chair's own adjudication and are left untouched.

| ID | Author status | Rationale |
|---|---|---|
| B1 | **accepted** | Verified independently, not on the chair's word: `worktreeMutationService.ts` gates `assessRemoval` behind `if (force)`, so an UNFORCED removal reaches `git worktree remove` having evaluated no blockers at all. Git refuses a dirty worktree itself, but idle panes and external sessions are not git's concern — and the design has the host return the blocker set rather than act. `issueFingerprint` having no caller follows from the same hole: nothing ever reaches the confirmable branch. Create and prune being wired-but-unreachable is not closure, and I asked the chair that question directly rather than asserting it was. |
| B3 | **accepted** | And worse than "still open": the POSIX half is a bypass my own round-1 remediation created. `.split(/[\\/]/)` is unconditional at createPath.ts:159, and a backslash is a legal POSIX filename character, so `/safe/foo\bar/link/new` walks false components, misses, and returns early — fail-open, the exact mechanism the original B3 named. My mutation check covered the two win32 cases and never asked what the new split did on the platform that was previously correct. |
| B4 | **accepted** | D6 specifies two observations across the queue wait. Production performs one: `validateCreatePath` runs only inside the coordinator body, and `mustBeEmpty` is never re-consumed. The tests prove `identityOf` can distinguish two inodes; they do not prove production observes twice, and I mistook the former for the latter. |
| B5 | **accepted** | Both halves confirmed by reading the branch: when `assessRemoval` yields no usable evidence the service returns `reprompt` WITHOUT calling `redeem`, so the token survives. And `${head}:${branch}` repeats exactly on a recreate at the same commit and branch. I raised the second half myself and called it "not airtight"; the chair is right that for an irreversible delete that is not a sufficient standard. |
| B6 | **accepted** | Self-reported before this round and confirmed: a non-zero `git status --porcelain` becomes `""`, a failed registry scan becomes `[]`, and a degraded listing is read as current. Three sources that fail open into "nothing at risk" on the one action that cannot be undone. |
| B7 | **accepted** | `observeAfter` infers "directory gone" from a null registration lookup instead of statting the journaled path, and cannot signal an unauthoritative listing. D11 exists precisely because registration and filesystem can disagree; deriving one from the other removes the comparison. |
| W3 | **accepted** | No remediation was attempted. Belongs to Blueprint Sync with the two doc outliers already queued. Task 6_4 does claim outbound messages that do not exist in `ExtensionToWebViewMessage` — production posts an untyped object — which is a real overstatement in that task's Plan. |

**Rebuttals: none.** All seven accepted.

## Thrash stop declared

Three of the four `asimov-build` thrash-stop conditions hold:

1. **The same invariant survived two fix attempts** — B1, B4 and B5 each.
2. **A fix created a previously absent bypass** — B3's POSIX half came out of B3's own remediation.
3. **No net blocker reduction across two rounds** — 5 blockers in round 1, 6 in round 2.

Round 3 is therefore not the right instrument, and the loop is stopped one round
early rather than spent.
