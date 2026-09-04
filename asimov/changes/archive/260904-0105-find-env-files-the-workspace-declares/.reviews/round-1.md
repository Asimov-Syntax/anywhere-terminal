# Review round 1 — find-env-files-the-workspace-declares

- Date: 2026-09-04
- Cycle: 1
- Mode: discovery
- Lane: fastlane
- Head reviewed: `7abcebf773c876baa2a5ba03123b58ff3e04f717` (tree clean when the range was captured; the checkout later advanced concurrently, so later commits and unrelated dirty analytics were excluded)
- Diff scope: `git diff 25bba4a3fd218d326ff8c22f18279c82902799d0..7abcebf773c876baa2a5ba03123b58ff3e04f717` (the requested `763929ff~1..HEAD` resolved to these endpoints at Phase 0)
- Reviewable lines: 146 added/modified across 2 reviewable production files; 275 added test lines reviewed inline; `tasks.md` and `workflow.md` were approved context and skipped as review targets
- Verdict: **REJECT**
- Counts: 3 BLOCK · 2 WARN · 0 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | workspace manifests, directory resolution, offer/apply boundary | secrets, containment, host authority | `opus[1M]` |
| asm-review-performance | manifest patterns and shared budgets | hostile-input growth axes | `gpt-5.6-terra[1M]` |
| asm-review-logic | parser precedence and path/glob edge cases | failures and control flow | `sonnet[1M]` |
| asm-review-contracts | D1–D5, task boundaries, offer contract | accepted obligation compliance | `gpt-5.6-terra[1M]` |
| asm-review-reuse | new manifest/glob helpers against providerKit | reuse and split cohesion | `gpt-5.6-luna[1M]` |
| asm-finder | discovery through selected nested-file application | full-flow support trace | inherited |
| chair | full committed range | all lenses and full-flow trace | `gpt-5.6-sol[1M]` |

Skipped: `asm-review-frontend` — no frontend production code changed; the changed webview test was reviewed inline and the opaque-id/unchecked-row flow was traced through existing production code.

Verify gate evidence is the recorded `bun run asm change verify-status find-env-files-the-workspace-declares`: tasks `1_1` and `2_1` are `[x]` with exit 0. The workflow additionally records 7621/7621 twice and one unrelated pre-existing Biome finding. The chair ran no project verify command or test suite; only targeted disposable probes for the findings below.

---

## Findings

### [F001] Workspace manifests bypass resolved containment before their bytes are read

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security + asm-review-reuse
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:80,91`
- Status: accepted
- Triage: A disposable real-filesystem probe made the checkout's `package.json` a symlink to a manifest outside the checkout; `suggestProvisioning(createProvisioningDeps(), ...)` followed it and emitted `apps/web/.env`. The existing `openProviderFile` path sequences prepared root → resolved containment → bounded read, but these two reads call `deps.readFile` directly.

**Invariant.** Every repository-controlled manifest read must be authorized against the resolved checkout before any byte is opened.

**Boundary inventory.** Affected: `package.json` and `pnpm-workspace.yaml` fallback reads. Verified safe: existing provider-file opens through `openProviderFile`; stable workspace-directory containment before enumeration; final env leaf symlinks rejected by `lstat`; selected source and destination revalidated by `entryGate` before apply. The host-held offer and opaque item-id flow remains safe, but it does not undo the earlier external read.

**Evidence.** `declaredWorkspaces` directly opens `path.join(repoRoot, PACKAGE_MANIFEST)` and the pnpm equivalent. `createProvisioningDeps.readFile` is bounded to 256 KiB and regular files, but intentionally follows symlinks because existing provider callers first pass through `openProviderFile`. Root preparation occurs only later in `workspaceDirs`, after both possible manifest reads.

**Impact.** Opening the create dialog can read and parse up to 256 KiB from an arbitrary regular file reached by a manifest symlink outside the checkout. That external content then decides which in-checkout directories are probed and offered, directly violating the security/privacy boundary and D1.

**Suggested fix.** Route both manifest reads through the existing authorized provider-file open/read seam, or extract that seam so the sequence remains prepared-root containment before bounded open. Add real or faithful symlink-containment witnesses for both manifest names.

---

### [F002] A refused `package.json` falls through to the lower-priority pnpm manifest

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:77-96`
- Status: accepted
- Triage: A disposable probe supplied the recoverable malformed JSONC from the added test together with a valid `pnpm-workspace.yaml`; the result still contained `apps/web/.env`. The test passes only because its fixture has no lower-priority manifest.

**Invariant.** A present higher-priority manifest that is refused must terminate workspace discovery; absence or an intentional no-declaration result may fall through, but malformed recovered data must not be silently replaced by another source.

**Boundary inventory.** Affected: JSONC parse errors, and the same control-flow shape for a present wrong-shaped `workspaces` value. Verified safe: valid non-empty package declarations return immediately; recovered keys are not consumed when `errors.length > 0`; absence/unreadability intentionally falls through; valid package declarations suppress pnpm.

**Evidence.** When `readJsonc` records an error, the `if (errors.length === 0 && parsed !== undefined)` body is skipped, but the function does not return a refusal state. Execution continues into the pnpm read. D1 explicitly states that any reported parse error is a refusal and that a refused manifest yields no workspace suggestions.

**Impact.** A damaged or hostile primary manifest still allows a lower-priority declaration to steer filesystem probing and produce rows, so the deliberate fail-closed decision is not actually enforced across precedence.

**Suggested fix.** Represent package-manifest outcomes distinctly, at least declared, absent/no-declaration, and refused. Return no workspace directories on refusal; consult pnpm only for the outcomes D1 permits. Add a combined malformed-package plus valid-pnpm witness.

---

### [F003] A missing or unreadable glob directory discards the entire fallback offer

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:176`
- Status: accepted
- Triage: A disposable real-filesystem probe created only `package.json` with `workspaces: ["apps/*"]`; with no `apps/` directory, production dependencies threw `ENOENT` from `opendir`. The rejection reaches `WorktreeHost`, whose `.catch(() => {})` publishes no provisioning offer.

**Invariant.** Failure of one optional workspace pattern must not erase independent root env and root setup suggestions; an absent glob directory is an empty match, not failure of the whole fallback.

**Boundary inventory.** Affected: absent, non-directory, and unreadable wildcard bases during `scanNames`. Verified safe: literal absent directories spend a bounded slot and their fixed `lstat` probes simply produce no rows; existing readable wildcard directories complete; root env and setup probes are individually failure-tolerant. The shared `entriesFor` implementation already catches scan errors and distinguishes absence from unreadability.

**Evidence.** `workspaceDirs` awaits `scanNames(deps.readdir(...), budget)` without a catch. Production `readdir` is an async generator whose `opendir` runs on first iteration, so `ENOENT`, `ENOTDIR`, or `EACCES` rejects the whole call. The host intentionally swallows a rejected provisioning read and leaves the form without an offer.

**Impact.** Common states such as a sparse checkout, a branch missing one declared workspace root, or one unreadable workspace directory make the whole Bring over section disappear. Root `.env` suggestions and the root lockfile setup row are lost too, recreating the original false “nothing to bring” outcome.

**Suggested fix.** Isolate enumeration failure per pattern, following the established `entriesFor` boundary: absence contributes no match, and other failures must not discard unrelated fallback rows. Add a witness that a rejected glob base leaves root env and setup suggestions intact.

---

### [F004] Refused declarations perform filesystem work without spending the scan budget

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-performance + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:154-176`
- Status: accepted
- Triage: A disposable probe with 3,000 escaping literal declarations ended with `budget.scanned === 0` after 6,001 `realpath` calls. The 256 KiB manifest cap makes the total structurally finite, so this remains WARN rather than BLOCK, but `MAX_SCAN` does not bound the work D2 assigns to it.

**Growth axis and invariant.** Pattern count grows with attacker-controlled manifest bytes. Every declaration that can cause containment or enumeration work should spend a bounded discovery account before that work, and the walk should stop when the account is exhausted.

**Boundary inventory.** Affected: outside/unresolvable literal declarations, valid wildcard-parent containment attempts, and later wildcard declarations after `MAX_SCAN` is already exhausted. Verified safe: accepted literal directories are charged; directory names pulled by `scanNames` are charged; seven env probes per accepted directory are structurally capped; output rows are capped at 200; malformed multi-star patterns do no filesystem work.

**Evidence.** `charge` increments only after `contained(...) === "inside"`, so every refused path may perform both the containment resolution and its diagnostic re-resolution without a charge. The wildcard branch also calls `contained` before `scanNames` can observe an exhausted budget.

**Impact.** A hostile bounded-size manifest can still cause tens of thousands of filesystem-resolution calls on each dialog open, exceeding the intended 2,000-unit discovery budget and delaying a user-visible path.

**Suggested fix.** Apply discovery backpressure before any per-declaration filesystem lookup and account for refusal-path containment work. Preserve the separate accepted-directory charge that closes the literal probing hole.

---

### [F005] A supported root-level `*` workspace pattern can never match

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-logic + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:170-176`
- Status: accepted
- Triage: A disposable probe with `workspaces: ["*"]`, a top-level `web/` directory, and `web/.env` returned no rows. `splitGlob("*")` succeeds, but `contained(".")` rejects equality with the repository root by design.

**Evidence.** For a bare `*`, `glob.dir` is empty and the code substitutes `.` for containment. `isResolvedPathInsideRoot` deliberately treats root equality as outside because its ordinary callers authorize a file read. The existing `entriesFor` implementation explicitly exempts an empty glob directory before scanning the root; the new path omits that exception.

**Impact.** Repositories that place workspace packages directly under the root and declare `workspaces: ["*"]` or pnpm `packages: ["*"]` silently receive none of their package env suggestions.

**Suggested fix.** Reuse the established root-glob rule: when `glob.dir === ""`, scan the already-authorized repository root under the same budget, then apply per-candidate containment before accepting a directory. Add a bare-star regression witness.

---

## Adjudication notes

- Dropped the reuse specialist's truncation warning: `scanNames.truncated` implies the shared scan account is exhausted, and `charge` then rejects every returned name, so this implementation does not emit a partial set from that call. The concrete large-directory behavior is fail-closed, not the reported partial-offer mechanism.
- Dropped the duplicate-spelling warning: the existing provisioning model intentionally preserves declared spellings and already groups lexical/folding contenders; no accepted obligation requires this detector to canonicalize or deduplicate aliases beyond the shared model rules.
- Dropped the second-root-resolution suggestion: no concrete correctness failure was established beyond one extra resolution, and review findings require behavioral evidence rather than a future-maintenance preference.

## Full-flow trace

- **Discovery and fallback:** `extension.ts` supplies bounded regular-file reads, `realpath`, `opendir`, and `lstat`; `readProvisioning` preserves present-source suppression and invokes fallback only when no provider source exists. The new manifest reads violate containment (F001), malformed precedence is not terminal (F002), and glob enumeration can reject the whole offer (F003). Stable accepted workspace directories are contained and fixed env candidates are checked by `lstat` only.
- **Presentation and consent:** `WorktreeHost` stores the model in `offerStore` and sends it to the webview. Suggested rows retain `suggestion`, render unchecked, and the create request carries only `offerId` plus item ids. The changed assembly test witnesses that the request contains no nested path.
- **Redemption and application:** the host looks up the exact scoped offer, selects entries by held ids, and passes the host-held model to provisioning. `entryGate` revalidates source and destination containment; nested parents and copy operations retain their no-follow/containment guards. No webview-authored path or command authority was introduced.
- **Error behavior:** manifest parse and glob-read failures occur before offer issuance. The host catches provisioning-read rejection and continues create-default resolution, so F003 is silent loss of the entire provisioning section rather than a create crash.
