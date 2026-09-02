# Review Round 5

- Date: 2026-09-01
- Cycle: 4
- Round: 5
- Mode: discovery
- Review profile: fastlane
- Scope: corrected explicit range `094728c0..HEAD` (`11eaebd8` D11 redesign artifacts and `5b72e2db` implementation)
- Head: `5b72e2dbe3dbaef7ac829d57dfc361bdce173e6e` (working tree dirty only from review accounting; review content was taken from the committed range)
- Reviewable lines: 126 production lines (71 additions, 55 deletions); tests and change artifacts reviewed inline but excluded from the count
- Escalation flags: `new-api-contract`, `security-privacy`
- Agents spawned:
  - asm-review-data-security — path identity, raw exclude traversal, and read-path security — gpt-5.6-sol[1M]
  - asm-review-logic — identity merge, fallback, cap, and error behavior — gpt-5.6-terra[1M]
  - asm-review-contracts — approved D11 and ProviderDeps realpath contract — sonnet[1M]
  - asm-review-performance — exclude growth axis and bounded filesystem work — gpt-5.6-terra[1M]
  - asm-review-reuse — path identity helper and repository abstractions — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-frontend — no frontend code changed; the model/output shape is unchanged
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports task 6_1 and all preceding tasks at exit 0, including the focused `readProvisioning.test.ts`, type, and unit gates recorded by build. The review did not rerun project verification commands.
- Chair probes:
  - A real temporary repository contained two different symlink directory entries, `alias-a` and `alias-b`, both targeting one in-repository directory. Orca declared `alias-a` and the native file declared `alias-b`; production `readProvisioning(createProvisioningDeps(), root)` emitted only `alias-b`, reproducing F008.
  - A real temporary repository declared `exclude: ["../outside/probe"]`. A wrapper around production dependencies recorded `readProvisioning` calling `realpath` on the outside file, reproducing F009.
  - A host probe confirmed Win32 path resolution preserves a UNC declaration as `\\attacker.example\\share\\probe` and lets drive-absolute and `..\\..` spellings escape the repository root.
  - `git diff --check 094728c0..HEAD` was clean.
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 1 | SUGGEST 1
- Blocking split: 2 feature | 0 machinery

## Scope correction

The first Phase 1 pass used the caller's mistaken `bf0d1b8a..HEAD` range and recorded a request-scope defect as F007. The caller corrected the range while this task was active. This file replaces that stopped pass as round 5's source of truth. F007 is not a code finding and is not reused; the corrected range contains only the D11 plan and implementation commits.

## Risk map and full-flow trace

- Identity construction: the native adapter reads and contains its inline entries; an optional authorized base adapter reads and contains inherited entries. `assemble` then sends every inherited entry path, native entry path, and raw native `exclude` spelling to `identityOf`. The helper lexical-normalizes every spelling, issues up to `MAX_MODEL_ROWS` sequential `ProviderDeps.realpath` calls, and returns namespaced resolved-or-spelling keys consumed by merge, inline contradiction detection, and exclusion.
- False-merge boundary: entry containment proves source paths remain inside the main checkout, but entry application preserves each declaration's own destination spelling. `applyEntry` creates a link or copy at `path.resolve(worktree, entry.path)`. Two different symlink directory entries in the main checkout can resolve to one final target while still naming two different destination slots in the new worktree. Final-target equality therefore is not sufficient destination identity.
- Security/privacy boundary: inherited and inline entries pass `contained()` before entering the model. `exclude` does not. It is raw JSONC input and now reaches `path.resolve` plus production `node:fs/promises.realpath`; absolute, parent-traversal, Windows drive, and UNC spellings can leave the repository before any later entry gate exists.
- Fallback/bound behavior: entries share the existing `MAX_MODEL_ROWS` model budget and precede excludes in the candidate order. A spelling resolved once is shared by every duplicate occurrence. Unresolvable and over-resolution-bound distinct spellings remain in the `spelling\0` namespace, which can preserve an extra row or fail to exclude one but does not merge with a resolved key. The intended conservative direction holds for these mechanisms.
- Growth axis: production provider bytes are structurally capped at 256 KiB, so the raw exclude list is not truly unbounded in shipped wiring. However, `MAX_MODEL_ROWS` only bounds filesystem calls: the change first spreads, maps, normalizes, and set-materializes every exclusion, allowing tens of thousands of short exclusions within the byte cap to consume CPU and memory on every offer read.
- Output: the resulting model is issued as a host-owned offer to the create dialog. Submission resolves selected ids back through that offer and later gates each selected entry before applying it. A row dropped during assembly cannot be recovered by the UI or entry gate.

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:196`
- title: Path identity splits one destination on case-insensitive filesystems
- evidence: Fixed for its original mechanism. Per-path realpath answers now merge case and Unicode spellings when the filesystem resolves those spellings to the same directory entry; unresolvable paths deliberately remain lexical.
- impact: The original duplicate-row and failed-exclusion behavior is closed.
- suggestedFix: none
- status: fixed
- triage: fixed in `5b72e2db`; F008 is separate because final-target resolution conflates two different symlink directory entries rather than splitting one case-folded destination.
- invariant: One actual worktree destination is represented by one merge identity; uncertain identity must not silently drop a destination.
- boundary inventory:
  - verified safe: lexical aliases; case/Unicode variants resolved by the filesystem as one directory entry; two different resolved answers; unresolvable case variants; no-realpath fallback
  - separated: distinct symlink directory entries with one final target are F008

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:469`
- title: Pinned target bytes remain behind a second live containment check
- evidence: The corrected range does not alter the authorized-open mechanism and no new evidence reopens it.
- impact: None; prior defect remains closed.
- suggestedFix: none
- status: fixed
- triage: carried forward fixed from round 4.

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:112`
- title: A recoverable JSONC error discards every valid native key
- evidence: The corrected range does not alter fail-partial parsing and no new evidence reopens it.
- impact: None; prior defect remains closed.
- suggestedFix: none
- status: fixed
- triage: carried forward fixed from round 4.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-frontend
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/worktreePanel.css:1215`
- title: Excluded rows collapse into the checkbox grid column
- evidence: The corrected range does not alter rendering and no new evidence reopens it.
- impact: None; prior defect remains closed.
- suggestedFix: none
- status: fixed
- triage: carried forward fixed from round 4.

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:196`
- title: Successful toggled-name lookup does not prove filesystem case folding
- evidence: Fixed for the recorded causal mechanism. `foldsCase`, `toggleCase`, and the repository-wide boolean keyer are gone. Identity is asked independently of the declared paths being compared. The case-sensitive distinct-spelling witness now stays two rows, and the case-toggled symlink to the old probe file no longer changes their identity.
- impact: A third file can no longer cause all declarations in a case-sensitive repository to be folded and silently deduplicated.
- suggestedFix: none
- status: fixed
- triage: fixed in `5b72e2db`. F008 is new evidence against the replacement mechanism itself: resolving each declared path to its final target still does not prove that two declaration spellings are one destination slot.
- invariant: Identity evidence must distinguish one destination slot from two; no repository-wide inference may erase a declaration.
- boundary inventory:
  - verified safe: old existence probe ambiguity; old single-file resolved-probe symlink; nested-volume/per-directory answers; filesystem Unicode equivalence
  - separated: path-specific final-target aliasing is F008

### F006

- ID: F006
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.test.ts:832`
- title: The no-hook D11 fallback is reachable but has no witness
- evidence: Fixed. The new test creates a real temporary repository, supplies no `realpath` hook to `ProviderDeps`, reaches assembly through the utility layer's Node root fallback, and asserts both case-variant rows remain.
- impact: The conservative optional-dependency mode is now directly witnessed.
- suggestedFix: none
- status: fixed
- triage: fixed in `5b72e2db`.

### F008

- ID: F008
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:215`
- title: Final-target realpath merges two distinct destination paths
- evidence: `identityOf` keys declarations solely by the string returned from `realpath`. A chair probe created in-repository `alias-a` and `alias-b` as two different symlink directory entries targeting the same in-repository directory. Orca declared `alias-a` and the native file declared `alias-b`. Production `readProvisioning(createProvisioningDeps(), root)` emitted only native `alias-b`. Yet downstream `applyEntry` preserves the declarations as different destination paths, `path.resolve(worktree, "alias-a")` and `path.resolve(worktree, "alias-b")`; both would be independently admissible and applied. The oracle test added by this range symlinks the old probe filename, not two paths being merged, so it cannot fail on this mechanism. Logic and contracts specialists' no-defect answers were rejected because they equated final symlink target with destination slot; the production flow and reproduction show those are different objects in this feature.
- impact: A repository that intentionally provisions two aliases to one source target silently loses one requested row. The same key reaches exclusion and D10 contradiction handling, so one alias can also exclude or contradict a different destination path merely because both currently dereference to one target.
- suggestedFix: Hand D11 back to planning again. Define identity for the destination directory entry rather than the final dereferenced source target, and add a witness with two declared symlink aliases to one target asserting both rows survive. A patch that merely special-cases the quoted names will repeat the failed-invariant cycle.
- status: accepted
- triage: ACCEPTED. Verified independently with a real temp repo before accepting: two symlinks `alias-a` and `alias-b` pointing at one in-repo `real` give ONE `realpath` answer and TWO inodes (272419078 vs 272419079, same dev). The finding is right and my mechanism was wrong at the root, not at the edge: `realpath` dereferences the final component, so it answers "the same source OBJECT", while identity here is "the same directory ENTRY in the destination tree". Two aliases are two slots in the new worktree and must stay two rows. The primitive that answers the actual question is `lstat` dev+ino, which I also probed: it separates the two aliases AND still merges `MixedCase`/`mixedcase` on this folding volume (same ino, same dev). It answers the oracle's three counterexamples too — a case-toggled symlink is simply not consulted, per-volume sensitivity is carried by `dev`, and the volume's own Unicode fold is whatever gave the two spellings one inode. REMEDIATION BOUNDARY CROSSED for the second time in this change: D11 defines identity as equal final `realpath`, and `ProviderDeps.lstat` is typed `Promise<unknown>`, which cannot carry `dev`/`ino`. Handback, not a fix commit.
- invariant: Two declarations may merge only when they address one destination slot in the created worktree; sharing a current source target is not sufficient.
- boundary inventory:
  - affected: inherited/native dedupe; exclusion matching; inline/exclude contradiction; two leaf symlinks to one target; aliases through different symlinked parent paths
  - verified safe: same lexical destination after normalization; case/Unicode spellings the filesystem resolves as one directory entry; different realpath answers; hard links that retain different canonical paths; unresolvable and no-realpath fallbacks

### F009

- ID: F009
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:215`
- title: Raw exclusions can resolve arbitrary paths outside the repository
- evidence: `native.exclude` is passed directly to `identityOf`; `path.resolve(repoRoot, spelling)` accepts parent traversal and absolute paths, and production then calls `node:fs/promises.realpath`. Offered entries have already passed `contained()`, but exclusions have no corresponding validation. A chair probe recorded production dependencies resolving `../outside/probe`. Win32 resolution also preserves UNC and drive-absolute inputs and lets backslash traversal escape the root; a malicious checked-in file can therefore cause metadata access or network/automount traversal outside the workspace.
- impact: Opening the create flow for an untrusted repository can make the extension host probe arbitrary local or mounted paths that this read path previously never touched. On Windows, a UNC exclusion can initiate access to an attacker-controlled network location. The read-only source test still passes because `realpath` does not write or execute, but that property does not prove containment or privacy.
- suggestedFix: Before any identity `realpath`, reject or keep purely lexical every exclusion that is absolute, uses platform separators the entry contract refuses, or lexically resolves outside the repository. Add absolute, `../`, Windows drive, and UNC witnesses proving the external target is never handed to `realpath`.
- status: accepted
- triage: ACCEPTED, and it is mine. Verified: `path.resolve(repoRoot, '../f009-outside/probe')` reaches the real `realpath` and returns `/private/tmp/f009-outside/probe`. D11 says each declared path is resolved UNDER THE REPOSITORY ROOT and I did not enforce it — `exclude` never passed through `contained()` because before this change it never touched the filesystem at all. `readOnly.test.ts` passing is not evidence against it: that property is about executing and mutating, not about where a read may point. Fixed in the same handback as F008, because containment has to be part of whatever primitive replaces `realpath` rather than bolted beside it.
- invariant: Untrusted provider declarations may cause filesystem metadata reads only within the repository boundary; a later apply refusal cannot authorize an earlier read.
- boundary inventory:
  - affected: POSIX absolute exclusions; `..` traversal; Windows drive-absolute, backslash traversal, and UNC exclusions; symlink/network/automount side effects reached from those spellings
  - verified safe: inherited and native entries, which pass `contained()` before assembly; missing `realpath`; lexical fallback itself; no direct write or command execution

### F010

- ID: F010
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-performance
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:209`
- title: Resolution cap is applied after full exclude-list materialization
- evidence: `assemble` first spreads every raw exclusion into `declared`; `identityOf` then runs `declared.map(lexical)` and constructs a Set over the entire result before checking `MAX_MODEL_ROWS`. The shipped `readBounded` limits the provider file to 256 KiB, so the performance specialist's claimed uncapped BLOCK was downgraded: the production growth axis is structurally byte-bounded. Nevertheless, tens of thousands of short exclusions fit inside that bound and all are copied, normalized, and set-materialized even though no filesystem work past 200 candidates can affect the resolved map.
- impact: A generated or hostile but size-valid provider file can add avoidable CPU and transient memory to every provisioning offer read in the extension host; `MAX_MODEL_ROWS` does not bound the preprocessing cost its comment appears to bound.
- suggestedFix: Build the distinct resolution candidate set incrementally and stop once `MAX_MODEL_ROWS` candidates are collected; leave all remaining spellings to the existing lexical fallback without spreading or mapping the full exclude list.
- status: accepted
- triage: ACCEPTED, non-gating, and it rides along with the handback rather than being fixed separately — the resolution loop is the code being replaced. Building the candidate set incrementally and stopping at the bound is strictly better than materializing the whole `exclude` list first; the chair is right that the 256 KiB provider-file limit already bounds the damage, which is why it is a WARN and not a blocker.

### F011

- ID: F011
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-contracts
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:215`
- title: ProviderDeps does not state the canonical realpath contract identity now assumes
- evidence: The changed code compares `ProviderDeps.realpath` return strings as identity, while the interface only says `Promise<string>`. Production delegates to Node and `resolvedPathBoundary.ts` documents canonical absolute semantics, so no shipped failure was found. A future virtual or test dependency can satisfy the type while returning noncanonical strings and split equivalent destinations.
- impact: The load-bearing assumption is discoverable only by reading another abstraction, increasing the chance a new dependency implementation silently weakens identity.
- suggestedFix: Document on `ProviderDeps.realpath` that it must match Node realpath semantics, or reference the shared resolved-path dependency contract.
- status: accepted
- triage: ACCEPTED. The identity contract is now load-bearing on what `ProviderDeps` implementations return, and the interface says only `Promise<string>`. The handback replaces `realpath` with `lstat` for this question, so the contract to document is the one the new primitive needs — stable `dev` and `ino` for one directory entry — and it is written on the widened type rather than left implicit.

## Adjudication notes

- Chair and data-security independently reproduced F009. The security specialist's answer controls over intent because it traces the raw exclude to a concrete external filesystem call.
- Logic and contracts reported no symlink false merge. Their conclusion treated equal final targets as equal destinations. F008 survives because the downstream application flow preserves the two declaration spellings as separate worktree destinations, and the chair's production probe shows one is removed before that flow.
- The performance specialist's uncapped-growth BLOCK was downgraded to F010 WARN: `MAX_PROVIDER_BYTES` structurally caps shipped input at 256 KiB. The changed preprocessing still runs over the whole byte-bounded exclude list before the 200-call cap.
- The performance suggestion to parallelize all 200 resolutions was dropped. The accepted design records the bounded cost, no latency measurement was supplied, and bounded concurrency introduces a separate filesystem-load tradeoff.
- Reuse found no duplicate repository capability. The existing inode `identityOf` serves mutation TOCTOU identity, while D11's keying question is different; naming alone is not a defect.
- F005 and F006 are fixed. F008 is a new causal mechanism under the same destination-identity invariant, and its expansion on the third implementation attempt means patch-level remediation has failed; another design handback is warranted.
- No audit-backlog or accepted-risk entries exist to carry forward.
