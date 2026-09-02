# Review Round 8

- Date: 2026-09-02
- Cycle: 5
- Round: 8
- Mode: verification
- Review profile: fastlane
- Scope: current `HEAD`, restricted by the verification contract to round-7 F001/F013 rebuttals, their read/offer/apply impact cone, and prior F012/F014. The dependency owners WT-012.17 and WT-012.18 are separately scoped changes already declared by `docs/PLAN.md`; this round reviewed only their integration seam into WT-012.4. Unrelated repository work after round 7 was excluded.
- Head: `22d294b441549dee4b2a01ff0c0c1cbf25f934fa` (target source reviewed at `HEAD`; the working tree had unrelated generated analytics changes outside this change)
- Previous Head: `f995fb7ef86605a21900125fe78112c0fa65d4de`
- Reviewable lines: 819 lines of production-code churn in the verification cone; tests and change artifacts classified separately
- Note: Large change — accuracy may decrease
- Agents spawned:
  - `asm-review-logic` — merge/exclude identity and contest-aware apply flow — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — WT-012.17/WT-012.18 integration, offer redemption, and native-mode contract — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — JSONC `__proto__` parsing and consumption — `sonnet[1M]`
- Agents skipped:
  - `asm-review-frontend` — no changed rendering behavior was needed to adjudicate the read/apply mechanisms; the contract review traced the wire and existing consumers
  - `asm-review-performance` — the reviewed collections remain structurally capped and this round concerns correctness, not growth
  - `asm-review-reuse` — no helper extraction or duplicated capability was introduced in this verification cone
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports tasks 1_1 through 7_1 exit 0. `workflow.md` records check-types clean, the Biome 3/14/1 baseline, the I10 gate, and 6596 tests after task 7_1. Review did not rerun project verification commands.
- Chair probes:
  - Installed `jsonc-parser@3.3.1` still parses top-level `__proto__` with zero errors, omits it from `Object.keys`, and exposes inherited native and task keys through ordinary lookup.
  - One native `MixedCase` link plus one inherited `mixedcase` copy on a folding fake volume produced native `linked`, inherited `refused`, and a link at the destination: the ordinary F001 witness is closed and the favoured member uses its own mode.
  - Two native links (`MixedCase`, `MIXEDCASE`) plus one inherited copy (`mixedcase`) produced no contest; the inherited row copied first and both native rows skipped as already present.
  - Native `Node_Modules` copy plus inherited `node_modules` link on a folding fake volume refused both rows because the held link's material-rule refusal was collapsed into destination contention, although the native copy was admissible and the destination absent.
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 1 | SUGGEST 1
- Blocking split: 2 feature | 0 machinery
- Audit backlog: none
- Accepted risk: none

## Findings

### F015

- ID: F015
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: `asm-review-logic`, corroborated by chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:404`
- title: Multiple native contenders erase native precedence and let inherited material win
- evidence: `contendersOf` sets `favoured` only when exactly one member has the native declaring file. With two native case variants and one inherited variant, the group has no favoured member. `contestsOf` at `applyProvisioning.ts:60-64` drops every such group, so the ordinary copy-before-link pass resumes. A targeted folding-volume probe with native `MixedCase`/`MIXEDCASE` links and inherited `mixedcase` copy returned inherited `copied`, both native rows `skipped: already there`, `contests: []`, and a regular file containing the inherited bytes.
- impact: A valid native file containing two spellings in one contender component abandons native precedence entirely. The inherited declaration again determines both material and mode at a destination WT-012.18 exists to keep native-owned or refuse visibly.
- suggestedFix: Never translate multiple native members into no contest. Represent native priority separately from a singular winner; when native members are themselves ambiguous, refuse the whole group or apply an explicit accepted rule, but never let an inherited member enter the ordinary pass and claim the slot.
- status: open
- triage: New mechanism inside F001's impact cone. The round-7 platform-identity mechanism is gone, but this independently actionable contender-construction mechanism recreates the same wrong winner, so it receives a new global ID rather than reopening F001.

### F016

- ID: F016
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: `asm-review-logic`, corroborated by chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:171`
- title: A held member's own admission refusal vetoes an admissible native winner
- evidence: `read()` maps every failed `admitEntry` to `inadmissible`, and `contended()` treats every non-`absent` value as evidence that the destination cannot be claimed. That is correct for a containment/read failure and false for member-specific material rules that run before any filesystem observation. A targeted folding-volume probe used native `Node_Modules` in copy mode and inherited `node_modules` in link mode. The inherited link was inadmissible under the `node_modules` link rule, but that value caused lines 208-218 to refuse both entries; the admissible native copy wrote nothing to the absent destination.
- impact: An inherited declaration can veto the repository's own mode through a rule that applies only to the inherited row. WT-012.18's contract says the native material and mode land when the destination is free; this valid override instead produces no material.
- suggestedFix: Separate destination observations from member-specific admission outcomes. Refuse an inadmissible held member independently; let an admissible favoured member prove its own destination absent and make the exclusive claim. Only containment or destination-read failures that actually prevent proving the shared slot free should refuse the whole contest.
- status: open
- triage: New mechanism inside the F001 dependency seam, independently actionable from F015. Gating.

### F012

- ID: F012
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-data-security`, corroborated by chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:141`
- title: A JSONC `__proto__` member still supplies native and task keys without a problem
- evidence: Installed `jsonc-parser@3.3.1` still assigns a top-level `__proto__` member through ordinary property assignment. A live probe returned zero parse errors, omitted `__proto__` from `Object.keys`, reported `Object.hasOwn(record, "extends") === false`, and still exposed inherited `extends`, `exclude`, `copy`, `setup`, and `tasks`. `nativeProvider.ts:142-144`, `providerKit.ts:464-515`, and `vscodeTasksProvider.ts:164` consume those values with ordinary property lookup; no null-prototype or own-property defense exists.
- impact: A checked-in JSONC file can hide an inherited base, exclusions, displayed rows, setup steps, ports, or a `worktreeCreated` task behind a key the native contract says should be reported but the UI never names. Containment still gates paths and the current host redeems entries rather than setup steps, so this remains an audit/reporting integrity defect rather than a traversal or direct execution bypass.
- suggestedFix: Re-seat parsed JSONC mappings onto null-prototype records, or require own properties at every top-level read, in both native and VS Code task providers. Report or ignore `__proto__` explicitly.
- status: open
- triage: Persists from round 7; reproduced exactly at current HEAD.

### F014

- ID: F014
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:126`
- title: A present but unreadable extends file is still diagnosed as missing
- evidence: `baseFor` returns `null` for every opened result other than `kind === "text"`, including file-level `unreadable` problems. `assemble` then emits `missingExtends` at line 242 instead of preserving the already-classified unreadable reason. `anyFilePresent` still treats the same file-level problem as presence.
- impact: EACCES, ELOOP, and provider-size/read failures are presented as a missing target, so the problem taxonomy gives the user the wrong recovery even though rows and containment remain safe.
- suggestedFix: Preserve the file-level problem from `baseFor`; reserve `missingExtends` for absence and no adapter match.
- status: open
- triage: Persists from round 7 with unchanged mechanism and severity.

## Prior finding dispositions

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:317`
- title: POSIX platform identity lets an inherited mode defeat the native override on a folding volume
- evidence: The exact round-7 mechanism is gone. `identityOf` is lexical only; `MixedCase`/`mixedcase` stay separate rows, `contendersOf` groups the ordinary one-native/one-inherited pair with the native row favoured, and the shipped extension routes both ordinary and root-failure application through `applyProvisioning`/`failEveryEntry`. The chair's native-link/inherited-copy probe produced native `linked` and inherited `refused`.
- impact: The round-7 witness no longer reproduces through its recorded mechanism.
- suggestedFix: none for the recorded mechanism; F015 and F016 are separate current defects in the dependency seam.
- status: fixed
- triage: The author's staleness claim is sustained for F001's recorded mechanism, but the broader claim that WT-012.18 fully closes native precedence is refuted by F015 and F016.

### F013

- ID: F013
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:317`
- title: Unicode lowercasing silently merges Windows filenames that NTFS keeps distinct
- evidence: The merge and exclusion call sites at `readProvisioning.ts:249-250` both pass lexical `identityOf`. Unicode/case folding exists only in `foldSegment`/`contendersOf`, which groups rows without removing them. `applyExclude` uses the same lexical key as merge: it removes exactly matching normalized spellings and reports a zero-match rule instead of widening it through folding. No production symbol or call to `platformFoldsFilenameCase()` remains.
- impact: Distinct Unicode spellings are no longer silently merged or discarded; provenance survives into the offer and any conservative apply refusal is visible.
- suggestedFix: none
- status: fixed
- triage: The author's staleness claim is sustained. Round 7 was correct for `f995fb7e`; current HEAD removed its causal mechanism through WT-012.17.

- F002: fixed — remains closed; no pinned-file regression in this cone.
- F003: fixed — recoverable JSONC parse errors still retain valid keys.
- F004: fixed — prior excluded-row layout defect remains closed.
- F005: fixed — the toggled-name identity probe remains absent.
- F006: fixed — the optional identity-hook fallback remains absent.
- F007: rejected — reserved non-finding ID; not reused.
- F008: fixed — identity still performs no final-target `realpath` merge.
- F009: fixed — raw exclusions do not enter an identity filesystem lookup.
- F010: fixed — no identity-resolution work remains to materialize.
- F011: fixed — identity no longer depends on the realpath contract.

## Adjudication notes

- The contracts specialist confirmed the ordinary one-native/one-inherited flow and the F013 split, but the logic specialist's broader boundary probes found F015 and F016. The chair reproduced both, so the concrete behavior overrides the narrower clean contract report.
- F015 and F016 stay inside the verification impact cone: both are reachable only because the rebuttal asks WT-012.18 to close F001 at apply time. They are not audit-backlog discoveries.
- F001 and F013 were valid against round 7's recorded Head; they are marked fixed rather than rejected. “Stale” describes why they do not apply to current HEAD, not why the prior review was wrong.
- No agent message was treated as user consent or risk acceptance.

---

## Author triage — round 8, 2026-09-02

| Finding | Status | Triage |
|---|---|---|
| F013 | **sustained** | The chair confirms the staleness rebuttal: merge and exclusion both receive the lexical `identityOf`, and the folding key only groups contenders. Closed. |
| F001 | **sustained in mechanism, accepted in substance** | The recorded round-7 mechanism is stale, as claimed. The chair's replacement mechanisms (F015, F016) are real and I reproduced both in the code below — but neither belongs to this change. |
| F015 | **accepted — reassigned** | Verified at `providerKit.ts:404`: `contendersOf` sets `favoured` only when `native.length === 1`, so a group of two native spellings plus one inherited has no winner, and `contestsOf` (`applyProvisioning.ts:60-64`) drops it on the "nothing in it claims priority" branch. That branch's reasoning was written for an unticked favoured member; two natives is a different state. Owner is WT-012.18, not this change. |
| F016 | **accepted — reassigned** | Verified at `applyProvisioning.ts:171`: `read()` collapses every `admitEntry` failure to `inadmissible`, and `contended()` refuses on anything but `absent`. An inherited member's own material-rule refusal therefore vetoes an admissible native winner at a free destination. Owner is WT-012.18, not this change. |
| F012 | **accepted — non-gating** | Real: `jsonc-parser` exposes a `__proto__` member's keys through ordinary lookup. Containment holds and setup is not redeemed, so it stays WARN; it belongs to the JSONC providers this change owns. |
| F014 | **accepted** | `baseFor` collapses an unreadable extends file to `null` and `assemble` then reports `missingExtends`. A present-but-unreadable base is a different fact from an absent one and must not be diagnosed as absence. |

**Disposition.** F015 and F016 are defects in WT-012.18's apply-time owner, reached through this
change's integration seam. They do not become this change's remediation: fixing them here would edit
another change's invariant owner while that change is still unarchived. They are carried to
WT-012.18 as a new discovery round, and this change depends on that resolution.

F012 and F014 are this change's own and stay in its fix loop.
