# Review Round 2

- Date: 2026-09-03
- Cycle: 1
- Mode: verification
- Review lane: fastlane
- Scope: range `44bbe105862c7476be63147dd05d74d2d0d4e542..3fe2103b5f13ca1db0d547ab273cdcf3e5c9e0bf`
- Head: `3fe2103b5f13ca1db0d547ab273cdcf3e5c9e0bf` (tree dirty after the reviewed range only because `round-start` updated `asimov/changes/re-register-a-surviving-checkout/analytics.json`)
- Reviewable lines: 374
- Large change: no
- Scope lock: passed — the range contains only accepted round-1 remediation, its witnesses, and task/review metadata; no new capability, contract, task semantics, design decision, or invariant owner was introduced
- Recorded Verify Gate: `bun run asm change verify-status re-register-a-surviving-checkout` reports tasks `1_0` through `2_6` complete with exit 0. The author records `check-types`, 7192 tests across 287 files, `gate:fs-deletion`, and `build:check-requires` passing; the lone lint error is the pre-existing untouched `src/webview/worktree/worktreeFormat.ts:30` baseline. Review ran no project verify command.
- Targeted chair probes: three injected dependency probes, requiring no project suite, reproduced (1) an unreadable initial `.git` snapshot being converted to absence and then removed, (2) a restored live link present before reconstruction being overwritten while the adoption returned success, and (3) an external link replacement during a failing repair being overwritten by undo. Each probe was created and deleted in the same command.
- Agents spawned:
  - `asm-review-logic` — adoption reconstruction and rollback — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — repository and filesystem authority boundaries — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — host-published repair contract and interface flow — `sonnet[1M]`
  - `asm-review-frontend` — resolved create-mode consistency — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-performance` — no persistence collection, growth axis, full-history recompute, or accumulating hot path is in the remediation cone
  - `asm-review-reuse` — the only prior reuse defect, F010, is directly verifiable from the removed duplicate reader and the existing `repoId` contract
- Verdict: REJECT
- Counts: 3 BLOCK, 0 WARN, 0 SUGGEST
- Prior findings: 8 fixed, 3 persist

## Findings

### F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/providers/WorktreeHost.ts:1122`
- Title: Adopt submission is not bound to the host-issued resolution
- Evidence: `Opening.publishedRepair` now records the exact published adopt or reattach mode and `matchesPublished` binds mode kind, branch, repair/adopt path, expected OID, submitted destination, surface, repository, and opening. A newer admitted probe withdraws the record before awaiting its replacement. Host tests exercise substituted path, branch, OID, stated destination, withdrawn answer, and the legitimate production-shaped submission.
- Impact: The prior webview-to-host authority bypass is closed.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2. The contracts specialist and chair found the publication lifetime and every inventoried binding boundary closed.

### F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptProbe.ts:73`
- Title: The surviving checkout is never bound to the current repository
- Evidence: `entryOf` now requires the stale gitdir to resolve to a direct child of `<commonDir>/worktrees`, and both host and mutation corroboration supply the normalized repository `repoId`. The changed tests cover another repository, a textual-prefix sibling, and a redundant spelling before the existence read.
- Impact: The prior cross-repository adoption path is closed.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2. Repository identity is checked before the administrative target is read and the same normalized identity reaches reconstruction.

### F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:140`
- Title: Filesystem read failures are still converted into proof of absence
- Evidence: The production `AdoptFs.readFile` now correctly rethrows errors other than `ENOENT`/`ENOTDIR`, but the first reconstruction read immediately erases that distinction with `fs.readFile(linkPath).catch(() => null)`. Undo treats `null` as “originally absent” and calls `removeFile`. A targeted dependency probe made this read return `EACCES`; adoption later failed and returned no residue after recording both `rmdir <entry>` and `remove <wt>/.git`. The shared `adminDirIsThere` also still returns `false` when `stat` succeeds on a non-directory, preserving the other round-1 affected boundary. Invariant inventory — boundaries searched: offer and mutation probes, production adapter, original-link snapshot, final reread, undo restore; affected: original-link snapshot and present non-directory administrative target; verified safe: explicit `ENOENT`/`ENOTDIR`, successful directory stat, and later read failures after a successful snapshot.
- Impact: An unreadable but present `.git` can be deleted during rollback, and a present non-directory administrative target can still authorize adoption as though absent.
- SuggestedFix: Let the initial `readFile` rejection refuse before `mkdir`; reserve `null` for the adapter's proven-absent result. Treat a successful stat of a non-directory as indeterminate/unreadable rather than absent.
- Status: accepted
- Triage: Confirmed by reading. The adapter was fixed and the CALLER put the swallow back: `adoptWorktree` reads the link with `.catch(() => null)`, and `null` is what undo reads as "originally absent". The non-directory arm is the same class — `isDirectory()` on a FILE at the gitdir path answers false, which is not absence. Remediation of the same obligation round 1 named; no `D#` moves.
- Triage: Persists from round 1. Both routed specialists independently identified the surviving catch, and the chair reproduced its destructive rollback behavior.

### F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:294`
- Title: Identity failure after mkdir leaks an unreported administrative entry
- Evidence: A first identity failure now returns an error message containing the exact created entry path and the fact that it could not be read back. `worktreeMutationService` passes that message verbatim to the user. Although `createEntry.leftBehind` is not propagated as a structured field, its only production consumer would append another message; no cleanup or routing behavior depends on the field, and the original “clean name-exhaustion refusal” no longer occurs.
- Impact: The prior unreported residue is now reported at the observable boundary.
- SuggestedFix: None required for the accepted finding; propagating the redundant structured field would not change production behavior.
- Status: fixed
- Triage: Fixed in round 2. Two specialists proposed retaining the structured field, but the chair refuted gating impact from the only consumer: the exact unfinished path and state already reach the same user-facing error channel.

### F005
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:171`
- Title: Undo still overwrites a worktree link this adoption no longer owns
- Evidence: Exclusive entry-file creation closes the truncation half of F005, and entry substitution is now reported. The link half remains: every failure calls `undo`, and `undo` unconditionally calls `restoreLink`, which writes the original bytes or removes the path without checking whether the current link is still the one this adoption wrote. This also runs when line 215 detects that the link was substituted before the adoption wrote it. The new changed-link test returns alternate bytes from `readFile` without changing its backing store, so its final assertion cannot witness the overwrite. A targeted probe changed the link to a foreign registration during a failing `git worktree repair`; undo replaced it with the old stale bytes. Invariant inventory — boundaries searched: entry creates, post-create identity, failures before final link write, failures after final link write, successful handle undo, link restore/remove; affected: every link restore/remove after external substitution; verified safe: exclusive creation preserves existing foreign entry-file bytes, and entry removal remains identity-bound.
- Impact: A refused adoption can corrupt another process's newly installed worktree link and may report a clean withdrawal after doing so.
- SuggestedFix: Track whether this adoption wrote the final link. Before that point, cleanup must not touch the link. Afterward, restore only after rereading and proving the current bytes equal the exact link this adoption wrote; otherwise leave it untouched and report `worktreeLinkRestored: false`.
- Status: accepted
- Triage: Accepted, and the round is right that the added test could not have caught it — the fake returned alternate bytes without changing its store, so the overwrite was invisible to it. The witness has to read the store, not the reader. Within D4's stated undo contract ("restore the recorded `<wt>/.git` bytes"), which never licensed writing over a link this adoption did not install.
- Triage: Persists from round 1. The fix closes foreign entry truncation but not the same finding's inventoried link-ownership boundary.

### F006
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:140`
- Title: A restored registration before reconstruction is still overwritten
- Evidence: The mutation corroboration carries only `staleGitdir`, not the exact link bytes it read. If another process restores a live registration after corroboration but before line 140, `originalLink` snapshots the restored live link. The final guard then compares that live link to itself at line 215 and checks absence only at the older corroborated `staleGitdir`; both pass, so line 230 overwrites the restored registration. A targeted dependency probe began reconstruction with `<wt>/.git` naming `/repo/.git/worktrees/restored` while the earlier `staleGitdir` remained absent; `adoptWorktree` returned `{ ok: true }` and replaced the live link with its new entry. Invariant inventory — boundaries searched: mutation corroboration result, initial reconstruction snapshot, entry creation awaits, final link reread, stale-entry claim, final write; affected: the interval between corroboration and the initial snapshot; verified safe: changes after the initial snapshot and restoration at the originally corroborated stale path.
- Impact: The central “live registration is never adopted over” obligation remains false for a restoration landing immediately before reconstruction begins.
- SuggestedFix: Carry the corroborated gitfile bytes, or an equivalent exact expected link value, with `staleGitdir`; require the initial and final reads to equal that corroborated value and to name the same stale target before writing.
- Status: accepted
- Triage: The sharpest of the three and the one round 1 only half-closed. Carrying `staleGitdir` proves which administrative directory was corroborated; it does not prove the LINK is still the one that named it. The exact gitfile bytes are what the corroboration actually saw, so they are what must travel. Still remediation: the spec requirement "an adoption re-establishes what it was offered on" already demands it, and D5 already claims it.
- Triage: Persists from round 1. The new read-before-write guard begins from a fresh snapshot instead of the state the mutation corroborated, leaving the original pre-reconstruction window open.

### F007
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-data-security`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/reattachProbe.ts:104`
- Title: A malformed gitfile is accepted as adoption authority
- Evidence: The shared parser now requires Git's `gitdir: ` prefix at byte zero and refuses the prior `junk\ngitdir:` witness as unreadable at both adopt and reattach boundaries.
- Impact: The malformed-file mutation authority is closed.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2. The shared invariant and both consumers are covered.

### F008
- Severity: WARN
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-frontend`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:2024`
- Title: A late refs reply desynchronizes adopt from its form controls
- Evidence: `deriveChoice` now preserves an effective adopt or reattach mode while its query still equals the typed branch. Control enablement, notes, submit gate, and carried resolution continue to derive from the preserved `draft.branchMode` and `effective`; edits, repository changes, and detached mode still invalidate or supersede it. The frontend specialist found no remaining issue.
- Impact: The prior late-reply form desynchronization is closed.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2.

### F009
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-contracts`, `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:235`
- Title: The branch-tip guard runs after index reconstruction
- Evidence: `adoptWorktree` now runs repair, reads `HEAD` from inside the reconstructed worktree against `expectedBranchOid`, and only then invokes `reset --mixed`. The moved-tip witness asserts reset is never called.
- Impact: The accepted D4 ordering is restored.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2.

### F010
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-reuse`, `asm-review-contracts`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeMutationService.ts:877`
- Title: Adoption bypasses the repository's capability-aware common-dir resolver
- Evidence: The bespoke `commonDirOf` command is removed. Host corroboration and mutation reconstruction both consume `WorktreeRepo.repoId`, whose contract is the normalized absolute Git common directory produced by the tree's capability-aware resolver.
- Impact: The prior Git-version capability divergence is closed.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2.

### F011
- Severity: SUGGEST
- Confidence: HIGH
- Priority: P4
- Agent: `asm-review-logic`, `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/adoptWorktree.ts:268`
- Title: Non-collision entry failures are reported as name exhaustion
- Evidence: `ensureDir` and non-`EEXIST` `mkdir` failures now preserve their reason; only exhausting all candidate names returns the exhaustion message.
- Impact: The prior misleading diagnosis is closed.
- SuggestedFix: None; verified closed.
- Status: fixed
- Triage: Fixed in round 2.

## Adjudication notes

- The contracts specialist marked F003, F005 and F006 closed from the interface flow, but did not address the reconstruction-local catch, unconditional link restore, or the gap before the initial snapshot. Concrete code and targeted probes override that conclusion.
- Two specialists kept F004 open because `created.leftBehind` is dropped. The chair rejected that as a gating persistence: the exact entry path and unfinished state are already in `created.message`, and the only production consumer of `leftBehind` converts it into the same message channel. The original clean, unrelated refusal is gone.
- No new finding outside the verification impact cone was admitted. No audit-backlog entry was created.

## Author triage record (round 2)

All three blockers accepted, none rebutted. Each is in-contract remediation: no `D#` is written or
amended, and no new invariant owner appears — the fixes tighten what design.md D4/D5 and the spec's
"an adoption re-establishes what it was offered on" already require.

One correction to the round-1 audit, stated plainly rather than left implicit: that audit claimed
F003 and F006 closed. They did not. F003 was fixed at the adapter and re-opened one frame up by the
caller's own `.catch`, and F006 was closed against the administrative directory rather than against
the link that names it. The witnesses I wrote proved what they asserted and asserted the wrong thing
— which is what the round's targeted probes found and mine did not.

The remedy for all three is one mechanism rather than three patches: the corroboration carries the
exact gitfile bytes it verified, reconstruction refuses unless both its reads match those bytes, and
undo touches the link only after this adoption has installed its own and only while the bytes on
disk are still the ones it wrote.

## Fix-delta audit (author, before the verification round)

One mechanism, not three patches. The corroborated gitfile BYTES now travel with the verdict
(`AdoptVerdict.staleLink`, from `GitLink.file.raw` — the same read that resolved the path), and
`adoptWorktree` compares both of its reads of `<wt>/.git` against them rather than against each
other. Ownership of the link is explicit: a boolean set only after the final write lands.

| Finding | Where it closes | Witness |
|---|---|---|
| F003 | `adoptWorktree.ts` — the opening read refuses on rejection AND on bytes that differ, before the `mkdir`; `extension.ts` — an existing non-directory at the gitdir is unreadable | "refuses before creating anything when the link cannot be read" and "writes nothing at all when the link is gone by the time it looks", both asserting no entry was created |
| F005 | `adoptWorktree.ts` — undo leaves the link alone until `installed`, then restores only while the bytes are still `ourLink` | three cases, plus one against a real repository where the link is replaced through the real filesystem during a failing `repair` |
| F006 | `adoptWorktree.ts` — both reads compare to `request.staleLink` | "refuses before creating anything when a live registration was restored first" |

**The round's criticism of my own witness was correct and is fixed at the root.** The round-1 test
returned alternate bytes from the reader without changing the fake's store, so an overwrite was
invisible to it. Every case in this delta drives the substitution THROUGH the store (`store.files.set`
inside a wrapped `createFile`/`writeFile`) and asserts against the store afterwards. Arm-checked by
reverting the `installed` guard to an unconditional restore: 3 of the new cases fail.

**Witnesses re-checked for falsification by this delta**: D4's write order and the tip guard's
position (argv order still asserted); D4's undo contract (its meaning narrowed — restoring is now
conditional, and the residue arm reports `worktreeLinkRestored: false` where it previously reported
success); the "content is untouched" and "mints a second entry name" integration witnesses (green
against a real repository); `gate:fs-deletion`; `build:check-requires`.

**One test was superseded rather than weakened**: "restores an absent link as absent rather than
inventing one" asserted behavior this delta removes on purpose — an adoption is offered ON a link,
so a directory that no longer has one is refused before anything is created. It is replaced by
"writes nothing at all when the link is gone by the time it looks", which asserts strictly more (no
entry, and the link still absent).

## Impact manifest (for the verification round)

- **`GitLink.file` gained `raw`** — consumers: `probeReattach` (unchanged behavior), `probeAdopt`
  (carries it into the verdict), and every fake that constructs a `file` link.
- **`AdoptVerdict.adopt` gained `staleLink`; `AdoptRequest` gained `staleLink`** — one production
  producer (`extension.ts` → `probeAdopt`), one production consumer (`worktreeMutationService`'s
  adopt branch), one real-filesystem consumer (the integration suite reads the bytes from git's own
  link file rather than reconstructing them).
- **`adoptWorktree` now refuses three states it previously proceeded through** — an unreadable link,
  an absent link, and a link whose bytes moved. Each returns before `createEntry`, so no entry, no
  git command and no undo runs; the mutation service reports them on its existing failure arm.
- **The undo's post-conditions changed** — a refused adoption that never installed its link reports
  `worktreeLinkRestored: true` with nothing written, and one that cannot reclaim its own link
  reports residue. `residueNote` in the mutation service already renders both.
- **Error handling**: `adminDirIsThere` now throws for an existing non-directory. Both probes catch
  and answer `unreadable`; `corroborate`/`corroborateAdopt` in the host both `.catch(() => undefined)`.
