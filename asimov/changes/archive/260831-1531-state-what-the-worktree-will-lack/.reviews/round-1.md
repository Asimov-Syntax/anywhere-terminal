# Review Round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Review lane: fastlane
- Scope: range `eae86109..748dcb92566a2dc8a672f804734d09d48f81f27d`
- Head: `748dcb92566a2dc8a672f804734d09d48f81f27d` (tree dirty after the reviewed range: `asimov/changes/state-what-the-worktree-will-lack/analytics.json`)
- Reviewable lines: 1049
- Large change: yes — accuracy may decrease
- Recorded Verify Gate: task records in `.build/verified.ndjson` report exit 0 for type checks and focused/unit tests; review ran no project verify command
- Agents spawned:
  - `asm-review-data-security` — provider read security — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — offer lifecycle logic — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — provisioning contracts — `sonnet[1M]`
  - `asm-review-frontend` — dialog rendering — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — provisioning growth bounds — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — containment and glob reuse — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Verdict: REJECT
- Counts: 8 BLOCK, 4 WARN, 1 SUGGEST
- Split: 8 feature blockers, 0 machinery blockers

## Findings

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1128`
- Title: The production host never supplies the provisioning reader
- Evidence: The new host path sends an offer only when `options.readProvisioning` exists. The sole production `createWorktreeHost({...})` construction at `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:682` supplies no `readProvisioning`, and `readAsimovProvisioning` is imported nowhere in production. Tests inject the optional callback, so they do not exercise the shipped path.
- Impact: In the real extension, `worktreeProvisionOffer` is never sent, `WorktreeCreateDialog` hides the section, and the entire WT-012.1 user-visible outcome is inert.
- SuggestedFix: Wire `readAsimovProvisioning` into the production host with bounded filesystem dependencies and cover the real construction boundary.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed. `rg readAsimovProvisioning src/` finds only the module's own header comment — the adapter is imported by its test and nothing else, and `createWorktreeHost` in `src/extension.ts:682` passes no `readProvisioning`. The spec delta says the create form SHALL show the section; inert in production, it does not. Making the dependency optional was the mistake: `WorktreeHostOptions.readProvisioning?` let every test pass while the shipped path stayed dark. Wiring it is also what B2, B7 and W1 need a real filesystem seam for, so this is fixed first and the others land on it.

### B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `asm-review-reuse`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:205`
- Title: Resolved containment is skipped for the provider file and expanded glob matches
- Evidence: `deps.readFile(file)` runs before the repository root is prepared and the provider path is never checked with `isResolvedPathInsideRoot`. Separately, the glob branch checks only the parent directory, then pushes each expanded child at line 188 without resolving that child. A symlinked provider path can read outside the repository; a matching symlinked child can enter the normalized model while resolving outside it. Invariant inventory — boundaries searched: provider file, repository root, literal entries, glob parent, expanded matches; affected: provider file and expanded matches; verified safe: root preparation, literal entries, and non-root glob parents.
- Impact: An untrusted repository can make the extension read an external file immediately or preserve an escaped source path for later copy/link execution, violating the accepted resolved-containment rule.
- SuggestedFix: Prepare the root before any provider read, authorize the provider file itself, and run every expanded child through the same resolved containment predicate before adding it; refuse and report escapes.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed, both halves, and the second is the worse one.
(a) The provider file is read at line 205 before `prepareResolvedRoot` at 230. `repoRoot` is host-owned and the relative path is a constant, so the only escape is `asimov/worktree.yaml` being itself a symlink — which is exactly what a hostile checkout controls. The read follows it out before any check exists.
(b) `readdir` names are joined and pushed at line 188 with no per-match check. The parent being contained says nothing about a child symlink, and these entries are what WT-012.2 materializes. My own D4 says containment is checked "before the entry enters the model"; the glob path checks the parent and calls it done, which is not what D4 says.
No new decision needed — this is D4 applied where I failed to apply it.

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:67`
- Title: Offer lookup is not scoped to the surface and repository that received it
- Evidence: `issue(key, model)` and `current(key)` use the surface/repository key, but `lookup(offerId)` reads a host-global `modelById` with no key check. Offer ids are predictable monotonic strings. The existing launch-offer admission in `WorktreeHost.ts:798-826` instead validates against a `WeakMap` entry for the requesting surface. Invariant inventory — issue/current/forget are key-scoped; lookup is affected and unscoped; no redemption occurs in this task, but this API is the authority WT-012.2 is intended to consume.
- Impact: A forged or guessed id from one webview surface can resolve a model issued to another surface or repository, allowing later redemption to apply a model that requester was never offered.
- SuggestedFix: Make lookup require the owning surface/repository key and accept only that key's current offer id; preserve surface binding through the future redemption call.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed. `lookup(offerId)` takes the id alone while `issue`/`current`/`forget` are all keyed by surface+repo, and ids are `provision-N` — guessable. Task 1_3's Boundary means nothing redeems this yet, so there is no live exposure; but the signature IS the contract WT-012.2 inherits, and a redeemer written against it cannot scope what the store will not scope for it. Cheaper to close now than to ask a later task to remember. Fix: `lookup(key, offerId)`, admitting only that key's current offer.

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:930`
- Title: A provisioning reply can clear the destination-answer gate with stale path data
- Evidence: `handleProvisionOffer` sends a seed through `applyCreateDefaults`, the callback intended for authoritative destination replies. In `WorktreeCreateDialog.ts:775-799`, a branch-less seed bypasses the stale-answer guard and unconditionally sets `outstanding = false`. If the slow provider read completes after the user types a branch but before that branch's defaults reply arrives, the seed still carries the opening branch-less `resolvedPath`; it replaces the repo record, clears the wait, and `syncDerived` can enable Create for that stale path.
- Impact: The form can submit a branch under a destination the host did not resolve for that branch, regressing the existing invariant that Create remains disabled until the destination on screen is authoritative.
- SuggestedFix: Give provisioning updates a separate callback/state path that cannot mutate destination pending state, or require every destination update to carry and match the current repo+branch request before clearing `outstanding`.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed, and this is the most serious finding in the round. `handleProvisionOffer` routes through `applyCreateDefaults`, whose guard is `next.answersBranch !== undefined` — a seed built from a branch-less cached answer skips it and falls through to `outstanding = false`. So an offer landing while a branch-specific destination request is pending re-enables Create on the opening request's stale path. This is the same defect class as the already-fixed round-1 B1 on this file: two conversations sharing one channel, told apart by what they carry. Provisioning gets its own path that cannot touch destination pending state.

### B5
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1128`
- Title: Concurrent defaults requests launch and publish multiple reordered provider reads
- Evidence: `offers.current(offerKey)` stays undefined until the asynchronous read resolves. Every branch/defaults request during that interval starts another read; each completion unconditionally issues and posts an offer, so later-started reads can land first and then be superseded by older results. Growth axis: edits before the first completion; pending reads, parses, promises, and posts grow O(E) with no in-flight bound.
- Impact: One open form can re-read an untrusted file multiple times, churn offer ids, invalidate a model already shown, and finish on a stale result while consuming unbounded work under rapid edits.
- SuggestedFix: Track one in-flight read per form generation and surface/repository key, have edit requests join it, and issue/post only if that generation is still current.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed — I found this independently before the report landed, from a peer session flagging the identical shape in `requestProjection` (WT-011.10). `offers.current()` stays empty until the async read resolves, so every keystroke's defaults request starts another read and issues another offer.

One scoping note for the fix, not a rebuttal: the peer case was a liveness failure (unbounded, self-sustaining, published nothing again). This one is bounded — a redundant read and a superseded id per keystroke, and a superseded id already resolves to the safe answer. Broken property plus waste, not a hang. In-flight tracking per form generation is the right fix; nothing heavier is warranted.

The fix must also repair the TEST. `does not mint a second offer as the user types a branch` asserts a property it structurally cannot observe: its fake resolves synchronously, so no suspension exists for a second caller to arrive in. A guard landed under that test would leave the assertion decorative.

### B6
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-frontend`, `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1127`
- Title: Provisioning offers outlive the form and surface that own them
- Evidence: The host key is permanent for a surface/repository pair, and neither dialog close nor `attach().dispose()` calls `offers.forget`; the controller likewise caches offers by repo until the repo leaves. A second form therefore skips a fresh read and displays the previous form's model. Detached surface keys remain strongly held in both store maps, and late read completions have no `disposed`/`surfaces.has(surface)` guard before issuing and posting. Growth inventory — axis: form opens and attached/detached surfaces; affected: form reopen, surface detach, late completion, retained maps; verified safe: superseding one already-issued offer for the same key evicts its predecessor.
- Impact: Provider edits between form opens are ignored, stale authority remains live, late posts target dead surfaces, and retained model memory grows O(surface lifecycles × repos) without a cap.
- SuggestedFix: Introduce an explicit form generation, clear/supersede on every new opening request, evict every surface key on detach, and reject late completions after form/surface/host disposal.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed. `offers.forget` exists and is called nowhere; `surfaceKeys` is a WeakMap so the key is collectable, but `currentByKey`/`modelById` in the store hold strings and models that nothing evicts. Dialog close and surface detach both leak, and a late completion has no disposed-surface guard. Folded into B5's fix — generation-scoped offers with a close/detach clear is one mechanism answering both.

### B7
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:173`
- Title: Glob expansion has no structural row or directory bound
- Evidence: Each declared glob materializes the complete `readdir` result, copies and sorts every name, and can append every match to the model. Multiple globs repeat the full work. Growth inventory — axes: names in a parent directory, declared globs, matched rows; affected: directory read, sort/copy, model arrays, postMessage payload, and DOM rows; verified safe: glob syntax is limited to one final-segment `*` and problem detail is capped, but neither limits match count.
- Impact: A repository-controlled large directory can cause unbounded extension-host allocation/CPU and an equally large webview message/render, freezing or exhausting the extension process when the create form opens.
- SuggestedFix: Define and enforce a hard expansion/model-row budget, deduplicate reads of the same parent, and report a bounded problem when the budget is exceeded instead of constructing the full offer.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed. `readdir` result is spread, sorted, and every match pushed, with no cap before the model, the `postMessage`, or the DOM. `.opencode/command/*.md` is benign; `*` against a `node_modules` sibling is not, and the pattern is repository-controlled. My design's Failure-surface table called the directory read "harmless — neither writes", which answered concurrency and skipped magnitude. Fix: a hard expansion and model-row budget, with the overflow reported as a bounded problem rather than silently truncated.

### B8
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-data-security`, `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:206`
- Title: Read failures are silently classified as absence
- Evidence: The provider `readFile` catch returns `emptyModel()` for every error, conflating `ENOENT` with `EACCES`, `EIO`, `ELOOP`, and `ENOTDIR`. The glob `readdir` catch similarly treats every failure as an unmatched optional glob. Invariant inventory — affected: provider-file read and glob-directory read; verified safe: parser throws become bounded malformed problems and root-resolution failure becomes a problem.
- Impact: Present but unreadable provider material disappears from the offer with no named problem, directly violating the accepted unreadable-file scenario and silently understating what the repository declared.
- SuggestedFix: Treat only confirmed absence as empty/unmatched; emit bounded `unreadable` problems for other failures while keeping Create enabled.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed, and it contradicts an accepted scenario rather than merely being untidy. Both `catch` blocks are bare: EACCES, ELOOP, EIO and EISDIR all return the same answer as ENOENT. The spec delta's `A provisioning file that is malformed` scenario requires a present-but-unusable file to be NAMED; a permission-denied provider file currently disappears into `emptyModel()` with no problem at all, and the section then says "Nothing configured" — an affirmative false claim. Fix: only confirmed absence is absence; every other errno becomes a bounded `unreadable` problem.

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:205`
- Title: Provider YAML is fully buffered and parsed without a byte budget
- Evidence: `readFile()` returns the complete string and `parseYaml(text)` constructs the complete object before normalization. Growth axes are provider bytes, scalar lengths, list entries, and map keys; only emitted problem detail is capped. The repository already has a bounded byte-read primitive.
- Impact: A large checked-in YAML file can consume disproportionate extension-host memory and CPU before row-count controls or rendering apply.
- SuggestedFix: Reuse the bounded read primitive, define a provider-file byte cap, and report oversized input as a bounded problem before parsing.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed and cheap, so taken rather than deferred. The whole file is buffered before parse and only the emitted detail is bounded. `readBoundedUtf8` in `src/vault/readers/cursorReader.ts:120` is the repository's existing primitive for exactly this — bounded at the READ, not after a `stat`.

Correction to my first reading of it: it is NOT reused literally. It is module-private to the vault reader, and it collapses every failure — absent, denied, oversize — to `undefined`, which is precisely what B8 forbids. Importing a vault reader internal into the worktree provider would also be the wrong coupling. The bounded read is implemented in this change's own production deps, keeping its TOCTOU-safe shape (bounded by the read, never by a prior `stat().size`) and preserving the errno B8 needs. Extracting one shared primitive and rewiring `cursorReader` is the better end state but is a refactor of a file this change holds no lease on.

### W2
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:492`
- Title: Unrelated form updates rebuild the section and reset every checkbox
- Evidence: Every `syncDerived()` calls `syncBringOver()`, which rescans the model and replaces all rows with new checkboxes initialized from default `row.checked`. Branch input, path input, destination replies, mode changes, and repo switches therefore discard the user's visible choices and perform O(M) DOM reconstruction even when the offer is unchanged.
- Impact: Users lose unchecked copy/link/port choices and checked setup consent during ordinary editing; large offers also make every keystroke increasingly expensive.
- SuggestedFix: Update Bring over only when repo/offer identity changes and retain checked item ids keyed by repo and offer.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed, and it is user-visible today, which the report understates. `syncBringOver` runs inside `syncDerived`, which runs on every keystroke, and `replaceChildren` rebuilds every row — so a user who unticks Run setup and then types one more character silently gets it back. That the checked state feeds nothing yet makes it harmless to the create, not invisible to the user. Fix: rebuild only when the offer identity changes, and carry checked ids across a rebuild.

### W3
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:255`
- Title: Checkbox accessible names omit the item being authorized
- Evidence: The checkbox is associated only with `.wt-brow-top`, which contains the verb, warning, and source. The distinguishing subject path, port name, or setup command is in a sibling `.wt-brow-meta > code` with no label linkage. Multiple copy rows from the same provider therefore announce identical names.
- Impact: Screen-reader users cannot tell which path, port, or command each checkbox controls.
- SuggestedFix: Include the subject in the associated label or connect both top and subject elements with `aria-labelledby`.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Confirmed. The `<label for>` wraps the verb, warn chip and source; the subject sits in a sibling `.wt-brow-meta` outside it, so five rows from one provider announce as five identical "Copy asimov/worktree.yaml". Fixed with `aria-labelledby` referencing both the top line and the subject, which keeps the visual two-line layout the mockup fixes.

### W4
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:58`
- Title: Item identity is minted inside one adapter rather than at offer assembly
- Evidence: Every adapter invocation starts its own `i1` counter, while `offerStore.issue` preserves those ids unchanged. The accepted D5 lifecycle says ids are minted per final offer, and WT-012.4 will combine provider-derived material; concatenating adapter models would create duplicate ids unless a later step silently remints them.
- Impact: The new contract bakes single-provider identity into adapter output and makes future merged selection ambiguous unless downstream code adds an undocumented repair step.
- SuggestedFix: Mint/re-mint all selectable item ids at final offer assembly, or pass one offer-scoped id generator through every adapter and merge transform.
- Status: open
- Triage: pending author triage

**Status**: accepted-modified

**Triage**: Valid, and deferred deliberately rather than fixed here — recorded so it cannot be lost. Each adapter run starts at `i1`, so WT-012.3's three adapters merging into one offer under WT-012.4 will collide. Fixing it in this change means either minting ids in an assembly layer that does not exist yet, or inventing a per-adapter prefix that guesses the merge's shape — which is the exact failure design.md D2 rejects: a seam built from one example that the second entry has to be bent into.

Modification: no id scheme changes here. The obligation is written onto `ProvisionModel`'s own declaration as a doc comment, so the merge task inherits it at the point it will read, plus a workflow.md Notes line. No behavior change.

### S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: `asm-review-performance`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeController.ts:932`
- Title: Offer delivery reconstructs all repository form data to update one repository
- Evidence: Each `handleProvisionOffer` calls `createRepos()` across all R repositories and then finds one seed; receiving one offer per repository creates O(R²) short-lived records during form opening.
- Impact: Large multi-repository workspaces do avoidable allocation and scanning during offer delivery, though ordinary workspaces are unlikely to notice it.
- SuggestedFix: Derive only the addressed repository's seed or memoize the repository list and invalidate the affected entry.
- Status: open
- Triage: pending author triage

**Status**: accepted

**Triage**: Trivially true and fixed in passing while B4 rewrites this path anyway: `handleProvisionOffer` called `createRepos()` — which rebuilds every repository's record — to update one. B4's separate provisioning path sends only the changed repository, which removes this by construction.

## Accepted risk

None.

## Audit backlog

None.
