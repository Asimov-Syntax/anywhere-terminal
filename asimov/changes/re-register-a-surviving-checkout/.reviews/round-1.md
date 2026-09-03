# Review Round 1

- Date: 2026-09-03
- Cycle: 1
- Mode: discovery
- Review lane: fastlane
- Scope: range `fc41907168e7b700612b95d64999fa34eb322e3e..44bbe105862c7476be63147dd05d74d2d0d4e542`
- Head: `44bbe105862c7476be63147dd05d74d2d0d4e542` (tree dirty after the reviewed range only because `round-start` updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 764
- Large change: no
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports every task gate `1_0` through `1_6` exit 0, including the real-repository integration witness and bundle check; the recorded lint baseline is the pre-existing untouched `src/webview/worktree/worktreeFormat.ts:30` issue. Review ran no project verify command.
- Targeted chair probes: in-memory dependency probes reproduced the post-`mkdir` leak, substituted-entry overwrite with no residue, and clean-returning undo after entry replacement; a temporary gitfile probe, deleted in the same command, confirmed Git rejects a two-line malformed gitfile that `readGitLink` classifies as a file.
- Agents spawned:
  - `asm-review-logic` — reconstruction and undo — `opus[1M]`
  - `asm-review-data-security` — repository boundary safety — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — mutation guard flow — `sonnet[1M]`
  - `asm-review-contracts` — adopt contracts and wire — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — create form adoption — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — worktree safety reuse — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — no persistence collection, unbounded growth axis, full-history recompute, or hot-path accumulation was added
- Verdict: REJECT
- Counts: 7 BLOCK, 3 WARN, 1 SUGGEST
- Split: 0 feature blockers, 7 machinery blockers

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:2289`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: The inbound boundary checks only the opening token and the structural shape of `msg.mode`, then forwards caller-controlled `branch`, `adoptPath`, and `expectedBranchOid` unchanged. It neither matches them to the latest `worktreeCreateResolution` nor requires `msg.path === msg.mode.adoptPath`; the adopt service ignores `request.path` and deliberately bypasses `validateCreatePath`. A current opening can therefore submit any directory that passes the weak adopt probe and any branch/OID pair it knows. Invariant inventory — boundaries searched: opening ownership, latest probe sequence, host-issued resolution, runtime mode validation, request-path binding, mutation admission; affected: latest-resolution and path/branch/tip binding; verified safe: only opening existence and field types are checked.
- Impact: A forged or stale webview message can re-register an unintended directory on a branch the user was never shown, crossing the webview/extension-host boundary before the direct Git-administration write.
- SuggestedFix: Persist the latest adopt resolution per surface/opening/sequence and admit an adopt submission only when repository, branch, adopt path, expected OID, and submitted path exactly match that current resolution; retire it on every newer probe and opening close.
- Status: accepted
- Triage: Confirmed by the host handler and service branch. The post-write OID check validates the caller-supplied claim, not that the claim came from the host's ref enumeration. This is the same host-owned-model rule already applied to provisioning and debris authorization.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:45`
- Title: The surviving checkout is never bound to the current repository
- Evidence: `probeAdopt` proves only that the candidate has a gitfile naming a path that is currently absent. It does not compare that stale target with the repository's `$GIT_COMMON_DIR`. The service later obtains the current repository's common directory independently and reconstructs the candidate there. A legitimate host-produced collision can therefore offer a forgotten worktree from repository B while the form is creating in repository A. Invariant inventory — boundaries searched: occupied-candidate derivation, gitfile parsing, stale target, current repository identity, common-dir resolution, reconstruction; affected: stale-target-to-current-repository binding; verified safe: the selected branch is read from repository A and the candidate is a directory.
- Impact: The flow overwrites repository B's stale `.git` link, attaches its working-tree contents to repository A, and makes subsequent Git commands interpret those files through the wrong object database and branch.
- SuggestedFix: Carry the parsed stale gitdir through the verdict and require it to be an entry under the normalized current common directory before offering or executing adoption. Decline when that repository identity cannot be proven.
- Status: accepted
- Triage: The design permits selecting the replacement branch because the old per-worktree HEAD is gone; it does not permit losing repository identity. The stale gitdir still carries that identity, but the implementation discards it.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:929`
- Title: Filesystem read failures are converted into proof of absence
- Evidence: Production `adminDirExists` maps every `fsp.stat` rejection to `null` and then `false`, so `probeAdopt`'s rejection catch is unreachable for EACCES, EIO, ELOOP, and similar indeterminate states; an existing non-directory also becomes `false`. The reconstruction adapter separately maps every `.git` read error to `null`, and `adoptWorktree` catches again; undo interprets that as “originally absent” and removes the link. Invariant inventory — boundaries searched: gitfile lstat/read, administrative-target stat, original-link snapshot, final overwrite, undo restore; affected: administrative-target authority and undo snapshot; verified safe: an explicit readable administrative directory declines.
- Impact: An unreadable live registration can be adopted over, and a later undo can delete an unreadable-but-present `.git` while reporting that it restored the original state.
- SuggestedFix: Use error-aware results: only ENOENT/ENOTDIR prove absence; all other stat/read failures must produce `unreadable` and refuse. Require a successfully captured original gitfile before creating the administrative entry.
- Status: accepted
- Triage: This directly contradicts the probe's own fail-closed contract. The production adapters erase the distinction before the probe or undo can apply it.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:223`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: After `fs.mkdir(entryPath)` succeeds, a rejection from the first `fs.identify(entryPath)` returns `undefined` without removing the directory or returning residue. The caller reports only “No unused administrative entry name was available.” A targeted dependency probe reproduced `{ ok: false }` with `<common>/worktrees/<id>` still present.
- Impact: A permission, I/O, or concurrent-removal failure leaves Git administrative debris while reporting a clean and unrelated name-exhaustion refusal, violating D4's “undone or reported unfinished” obligation.
- SuggestedFix: Retain the claimed path immediately after mkdir; on identity failure, remove it and report structured residue when that cleanup cannot be proved. Add the missing first-identify failure witness.
- Status: accepted
- Triage: Corroborated by both logic and data-security review and directly reproduced. The undo closure is constructed only after `createEntry` returns, so no later cleanup can reach this path.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:151`
- Title: Directory substitution is detected only after foreign registration files are overwritten
- Evidence: The three ordinary truncating `writeFile` calls run before the second dev/ino check. If the claimed directory is removed and recreated after the first identity capture, these writes land in the replacement registration; the later mismatch calls `failed()`, whose undo declines to remove the foreign directory but does not restore its overwritten `gitdir`, `commondir`, or `HEAD`. `removed = !stillOurs` then treats the non-removal as success, and restoring `<wt>/.git` can also overwrite a replacement link. Targeted probes reproduced a failed result with all three files left in the replacement directory, `leftBehind` absent, and an undo after replacement returning no residue while rewriting the link. Invariant inventory — boundaries searched: exclusive mkdir, first identity, each entry write, second identity, final link write, undo identity, entry removal, link restore; affected: writes before ownership proof and clean-returning undo after substitution; verified safe: only the unchanged-identity ordinary path.
- Impact: The protection intended to avoid deleting another registration instead corrupts that registration and reports a clean withdrawal, exactly the cross-process failure the identity mechanism exists to prevent.
- SuggestedFix: Make every administrative-file creation non-destructive and ownership-coupled, or use a primitive that writes through a held directory identity. On any unprovable/moved identity, report residue and never rewrite the worktree link without proving that link is still the one this adoption wrote.
- Status: accepted
- Triage: The accepted design chose a post-write identity check, but evidence overrides the prose: the check detects substitution only after damage and the result omits that damage. The existing replacement test asserts only the worktree link and misses the foreign entry files and residue result.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:885`
- Title: A live registration can return after corroboration and still be overwritten
- Evidence: The service re-probes the stale link, then awaits `commonDirOf`; reconstruction rereads the link, ensures/creates directories, captures identity, and writes three files before finally overwriting `<wt>/.git`. It never requires the reread link to still name the absent target just corroborated and never rechecks that target immediately before the overwrite. Invariant inventory — boundaries searched: in-body re-probe, common-dir read, original-link read, entry creation, administrative writes, final link overwrite; affected: the interval from re-probe through final overwrite; verified safe: a registration restored before the re-probe is refused.
- Impact: Another Git process can restore the old administrative directory during those awaits; adoption then replaces its live link and creates a second registration, violating the explicit “live registration is never adopted over” obligation.
- SuggestedFix: Resolve the common directory before the final corroboration, carry the exact parsed link/target into reconstruction, and claim or revalidate that missing target at the final write boundary with an operation that cannot silently overwrite a restored registration. If ownership cannot be established, refuse.
- Status: accepted
- Triage: D5 acknowledges only the branch-claim residual after the post-read. It claims this separate live-registration race is closed by the re-probe, but the implementation leaves several suspension points and no conditional overwrite after it.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:55`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: The changed probe treats every `GitLink.kind === "file"` as a checkout witness. The shared parser classifies any regular file containing any trimmed line beginning `gitdir:` as a gitfile, including extra content before it. A targeted temporary probe confirmed `readGitLink` accepted `junk\ngitdir: <missing>\n` while `git -C <candidate> rev-parse --git-dir` rejected it as `fatal: invalid gitfile format`.
- Impact: An unrelated or corrupt `.git` file can be overwritten and the directory attached to the current repository even though Git itself never recognized it as a linked checkout.
- SuggestedFix: Before using the shared parser as mutation authority, require Git's canonical single-record gitfile grammar and reject extra or malformed content as unreadable; add both parser and adoption witnesses.
- Status: accepted
- Triage: The parser pre-existed, but adoption newly elevates its permissive classification from read-only diagnosis to authority for overwriting the file, so the changed application is in scope.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2689`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: An adopt resolution sets `draft.branchMode = "adopt"`, but the independent refs callback later calls `deriveChoice()`, which unconditionally replaces every non-detached mode with `new` or `existing`. It retains `effective`, so the action note, loss disclosure, carried resolution, and submitted mode can remain adopt while control enablement is derived from another mode. The controller explicitly does not wait for refs before opening the dialog, so this arrival order is supported.
- Impact: The destination control can become editable after the form says it will adopt the fixed directory, violating D6 and presenting inconsistent visible and submitted behavior.
- SuggestedFix: Preserve a current resolved adopt/reattach mode across passive refs refreshes, or invalidate `effective`, request a new resolution, and disable Create until it settles.
- Status: accepted
- Triage: High-confidence async ordering defect; the new adopt arm makes the pre-existing `deriveChoice` reset materially unsafe for the changed mode.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:182`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: `adoptWorktree` runs `repairWorktree` and then `resetMixedIndex` before returning; only afterward does the service call `readHeadAt` against `expectedBranchOid`. Accepted D4 specifies repair, verify HEAD, then reset. A moved branch therefore mutates the reconstructed index before the operation discovers it must withdraw.
- Impact: A refused adoption performs avoidable administrative work against a branch state the user was not shown and reports a reset failure before it can report the actual moved-tip refusal.
- SuggestedFix: Split repair from index reconstruction so the service verifies the post-repair HEAD before invoking `resetMixedIndex`, or pass the expected OID into the reconstruction and enforce the accepted order there.
- Status: accepted
- Triage: The later undo removes the index with the entry, so this is not lasting working-tree corruption; it remains a concrete ordering and failure-reporting defect rather than a blocker.

### F010
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:642`
- Title: Adoption bypasses the repository's capability-aware common-dir resolver
- Evidence: The new adapter directly runs `rev-parse --path-format=absolute --git-common-dir`. `src/worktree/repoRoots.ts:146-165` already owns the same read and falls back to `rev-parse --git-common-dir` for Git versions that accept/echo an unsupported path-format option. The tree can therefore discover and display a repository through the fallback while adoption reports its common directory unavailable.
- Impact: Adoption is unnecessarily disabled on a Git version the rest of the worktree subsystem already supports.
- SuggestedFix: Reuse/expose the established capability-aware common-directory resolver and adapt its result to `string | null`.
- Status: accepted
- Triage: Kept because it is a current behavioral divergence, not merely future duplication risk. The other reuse suggestions were dropped because they showed no present semantic difference.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:203`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: `ensureDir` failures and non-`EEXIST` `mkdir` failures return the same `undefined` as exhausting all 100 entry names, despite the adjacent comment saying those errors should not be described as collisions.
- Impact: Permission and repository-I/O failures give the user the wrong diagnosis and hide the only actionable error.
- SuggestedFix: Return a discriminated create-entry failure preserving the underlying reason; reserve the exhausted-name message for the loop actually exhausting its candidates.
- Status: accepted
- Triage: Reporting-only after excluding F004's state leak, so it remains non-gating.

## Adjudication notes

- The mutation-guard specialist's thrown-error blocker was rejected for this round: every production dependency in the post-reconstruction block is explicitly non-throwing (`GitCommandRunner.run`, `normalizeWorktreePath`, and `listRepoWorktrees`), and the helper loops call only that non-throwing normalizer. Injected rejections alone do not establish a production path. The finding can reopen if a production dependency contract changes or a reachable rejection is shown.
- Reuse findings about the duplicate HEAD reader, duplicated lifecycle shape, and duplicate adapter wiring were dropped because they showed future drift risk without a current behavioral divergence. The common-dir resolver finding remains because its fallback behavior already differs.

## Author triage record

Two gating judgments were settled before the first fix edit.

**Premise audit** — the report's `Split: 0 feature / 7 machinery` does not pause this fix loop. The
audit exists to stop machinery being built for a state no shipped user can hold. Here the state IS
the deliverable: WT-012.15 exists because a pruned checkout strands real work (proposal.md § Why),
and the shipped baseline evidences it — `resolveDestination` reports such a directory as
`occupiedCandidate` with `disposition: free` today, and `git worktree repair`/`add` both refuse it
(proposal.md § Why, verified against git 2.50.1 in task 1_6). A change whose whole capability is a
recovery mechanism is machinery by nature; the classification is descriptive, not a scope signal.
No scope-cut handback.

**Remediation boundary** — all seven blockers are in-contract remediation. None is fixed by writing
or amending a `D#`, and none introduces a component owning durable state, a lock discipline, a
process lifecycle, or an external contract the plan does not already own. Each fix discharges an
obligation the accepted artifacts already carry:

| Finding | Obligation it discharges | Owner it uses |
|---|---|---|
| F001 | worktree-rpc.md § 2.4 / design.md D1 — the host holds the model, the webview names ids | the existing `Opening` record, which already binds `debrisCandidate` to the latest published answer (`WorktreeHost.ts:1108-1115`, `:2003`, `:2445`) |
| F002 | proposal.md § Scope — reconstructing the entry *of this repository* | `probeAdopt`'s existing verdict, carrying the parsed gitdir it already reads |
| F003 | `probeAdopt`'s stated fail-closed contract — `unreadable` is a distinct verdict from absence | the existing production adapters in `extension.ts` |
| F004 | spec § An adoption that does not complete leaves the destination as it found it | the existing undo handle |
| F005 | design.md D4 — the entry is written under an identity that is re-checked | the same write sequence, made non-truncating |
| F006 | design.md D5 / spec § An adoption re-establishes what it was offered on | the existing re-probe, made a compare-and-write |
| F007 | `readGitLink`'s stated contract — a `.git` that names no gitdir is `unreadable` | the existing parser, narrowed to git's own gitfile grammar |

F007's parser is shared with reattach, so the narrowing is applied at both boundaries per the
finding's invariant inventory, with the invariant-level test rather than the quoted line.

**Out of scope, stated rather than silently skipped**: `reattach` carries the identical unbound
submission that F001 describes for adopt (`repairPath` and `expectedOid` are caller-supplied and the
host does not match them to what it published). It is shipped behavior this change does not touch.
F001's fix records the published repair mode generically so both arms are bound by one rule, because
recording adopt alone would leave the same hole one line away — that is closing the finding at its
boundary, not widening scope.
