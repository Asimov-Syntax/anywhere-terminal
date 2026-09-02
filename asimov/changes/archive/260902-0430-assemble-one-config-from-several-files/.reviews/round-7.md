# Review Round 7

- Date: 2026-09-01
- Cycle: 5
- Round: 7
- Mode: discovery
- Review profile: fastlane
- Scope: cumulative change-owned commit projection at `HEAD`; code-bearing commits `386f65ff`, `288e1729`, `ffac57d8`, `3109652a`, `4cf62ddd`, `95afc2ca`, `e2a70b51`, `2ff0bcd8`, `6faf842b`, `8f9e22b7`, `5b72e2db`, `4c14616f`, with the change's plan/review commits used as context. Excluded `1f068843` and every `materialize-declared-files-into-a-new-worktree` commit. The review assessed the selected hunks in their final cumulative state and traced their current callers/consumers.
- Head: `f995fb7ef86605a21900125fe78112c0fa65d4de` (working tree was clean at round entry; `round-start` updated `analytics.json` before review persistence)
- Reviewable lines: 1,190 lines of selected-commit production-code churn; tests and change artifacts classified separately
- Note: Large change — accuracy may decrease
- Escalation flags: `new-api-contract`, `security-privacy`
- Agents spawned:
  - asm-review-data-security — provider-file authorization, containment, malformed input, and trust boundary — `opus[1M]`
  - asm-review-logic — detection, merge, identity, exclusion, errors, and races — `gpt-5.6-terra[1M]`
  - asm-review-contracts — AdapterRead/Authorized/D11 contracts and tests — `sonnet[1M]`
  - asm-review-performance — shared row/scan/file/exclude growth axes — `gpt-5.6-terra[1M]`
  - asm-review-frontend — excluded-row rendering, selection, totals, and accessibility — `gpt-5.6-luna[1M]`
  - asm-review-reuse — inline reader, platform predicate, containment and cohesion — `gpt-5.6-luna[1M]`
- Agents skipped: none
- Flow support: asm-finder traced read → offer → dialog → opaque selection → entries-only post-create materialization; setup and ports stop at the UI in the current shipped flow.
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports tasks 1_1 through 7_1 exit 0. `workflow.md` records check-types clean, the Biome 3/14/1 baseline, I10 gate ok, and 6596 tests passing after 7_1. Review did not rerun project verification commands.
- Chair probes:
  - On this host's case-insensitive POSIX volume, a real native `link: ["MixedCase"]` plus inherited copy `mixedcase` produced two selected rows; the production copy-before-link apply copied the inherited spelling and skipped the native row as `already there`.
  - Installed `jsonc-parser` parsed `{"__proto__": {"extends": "orca.yaml", "exclude": ["x"], "setup": ["echo hidden"]}, "copy": ["a"]}` with zero errors, omitted `__proto__` from `Object.keys`, and exposed all three inherited properties through ordinary record lookup.
  - Runtime Unicode conversion confirms `"İ".toLowerCase() === "i̇".toLowerCase()` and `"Ϳ".toLowerCase() === "ϳ".toLowerCase()`.
- Verdict: BLOCK
- Counts: BLOCK 2 | WARN 1 | SUGGEST 1
- Blocking split: 2 feature | 0 machinery
- Audit backlog: none
- Accepted risk: none

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:181`
- title: POSIX platform identity still lets an inherited mode defeat the native override on a folding volume
- evidence: D11 deliberately leaves case variants separate whenever `path.sep !== "\\"`. That is the runtime answer on macOS even when the mounted volume folds case. The cumulative flow matters: `bringRows` checks both entries by default, the host redeems both opaque ids, and `extension.ts:574-590` sorts copy before link before applying. A targeted real-filesystem probe on this host used inherited `.worktreeinclude` copy `mixedcase` and native link `MixedCase`; `readProvisioning` offered both rows, the apply copied the inherited row first, then skipped the native row as `already there`, leaving a regular file. This is the original F001 mechanism at its materialization boundary, not merely an extra visible row.
- impact: On the default macOS filesystem shape, the repository's own entry does not reliably win the shared destination or its mode. With both default-selected, the user can create without noticing the duplicate and receive inherited behavior after the accepted native-wins contract promised the opposite. `exclude` likewise matches only one spelling. The later result reports a skipped step, but the worktree has already been created with the wrong winning mode.
- suggestedFix: Reopen D11 around a conservative pathname-slot proof. Do not ship the POSIX-volume residual as only a display issue; either prevent both rows from being default-redeemed to one destination, or introduce a separate approved owner that can prove/resolve the destination-name collision before the offer is actionable. Preserve displayed spelling and provenance.
- status: accepted
- triage: Reopened under its original global ID. Round 4/5 marked F001 fixed under mechanisms D11 later replaced; D11 explicitly reintroduced the lexical POSIX split. New full-flow evidence changes the residual's impact from “two visible rows” to “the inherited mode can win during the default apply.” Gating.
- author-triage: ACCEPTED, verified independently and by construction rather than by re-running the chair's probe. On darwin `platformFoldsFilenameCase()` is false, so `mixedcase` and `MixedCase` are two identity keys, the native-wins merge in `mergeEntries` never fires, and both rows arrive default-selected; `applyEntries` then charges the second one EEXIST -> `skipped: already there`. The accepted contract says the native entry wins the shared path INCLUDING its mode, and it does not. My own D11 text called this a visible residual; that characterization was wrong at the materialization boundary and I withdraw it. Not remediable in this loop: the fix needs a changed D11 and a new invariant owner for destination-slot collision. Handback.

### F013

- ID: F013
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:186`
- title: Unicode lowercasing silently merges Windows filenames that NTFS keeps distinct
- evidence: On Windows, `identityOf` uses JavaScript Unicode `toLowerCase()` as the proof that two declared names are one pathname slot. That conversion is length-changing and normalization-sensitive: `İ` and `i̇` both become `i̇`; current JavaScript also maps `Ϳ` and `ϳ` to the same lowercase scalar. NTFS filename comparison instead uses its volume `$UpCase` table and binary comparison, and does not normalize canonically equivalent spellings. The table is frozen per volume; older NTFS volumes can keep `Ϳ` and `ϳ` distinct even though current JavaScript folds them together. Therefore a base path and native path can be two legal files in an ordinary case-insensitive Windows directory while this Set key removes the inherited row as if they were one.
- impact: A supported default Windows configuration can silently discard a declaration and its provenance, the exact failure direction D11 says the redesign avoids. This is broader than the recorded per-directory-case-sensitive exception and falsifies task 7_1's “one row on the platform's own naming rules” outcome.
- suggestedFix: Do not use full Unicode `toLowerCase()` as a pathname-equivalence proof. A conservative fold limited to equivalences the implementation can prove (at minimum ASCII A-Z) leaves uncertain Unicode pairs as visible extra rows rather than silently merging them; if stronger Windows equivalence is required, return D11 to planning for an owner that can obtain the filesystem's actual comparison semantics.
- status: open
- triage: New finding. Same pathname-identity invariant as prior rounds, but a new causal mechanism: JavaScript Unicode case conversion over-merges names that the Windows filesystem comparison keeps distinct. Gating.
- author-triage: ACCEPTED, reproduced on this host: `'\u0130'.toLowerCase()` and `'i\u0307'.toLowerCase()` are both `i\u0307`, and `\u1E9E`/`\u00DF` and `\u03CF`/`\u03D7` collapse the same way; the U+0130 case also changes length 1 -> 2, which is the constraint the cited Windows sources describe. NTFS folds through the volume's own `$UpCase` table with no normalization, so these stay distinct names on disk while `identityOf()` gives them one key -- a silently dropped declaration on an ORDINARY case-insensitive Windows directory, which is strictly broader than the per-directory-case-sensitivity exception D11 records. Same owner as F001: the fold rule itself. Handback.

### F012

- ID: F012
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:142`
- title: A JSONC `__proto__` member supplies native keys without an unknown-key problem
- evidence: `jsonc-parser` assigns a `__proto__` member through ordinary property assignment, changing only the parsed object's prototype. The installed parser returned zero errors, `Object.keys(record) === ["copy"]`, and prototype-chain values for `record.extends`, `record.exclude`, and `record.setup`. `extendsOf`, `excludeOf`, and `readInlineKeys` use ordinary property lookup, while unknown-key reporting iterates only `Object.keys`, so the hidden values are consumed and the unrecognized key is never reported. The YAML adapters materialize `__proto__` as an own key and do not share this behavior.
- impact: A checked-in native file can inherit a framework, remove inherited rows, or add displayed setup steps through a key the contract says will be reported but the UI never names as a problem. Containment and opaque-id redemption still hold and setup is not executed by the current flow, so this is not a direct execution bypass.
- suggestedFix: Copy parsed JSONC mappings onto a null-prototype record or require own properties at every read. Ensure `__proto__` is either reported as `unknownKey` or ignored, and apply the same defensive conversion to `vscodeTasksProvider`.
- status: open
- triage: New finding; specialist evidence reproduced by the chair.
- author-triage: ACCEPTED, reproduced exactly: `parse('{"__proto__": {"extends": ..., "exclude": ...}}')` returns 0 errors, `Object.keys()` reports only `copy`, `hasOwnProperty('extends')` is false, yet `record.extends` and `record.exclude` resolve through the changed prototype and are consumed with no `unknownKey` problem. Fixable inside the accepted contract (re-seat onto a null-prototype object, both providers), so it is NOT the reason for the handback -- but the cycle cap closes this loop, so it is carried into the replan as a task rather than built now.

### F014

- ID: F014
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:125`
- title: A present but unreadable extends file is diagnosed as missing
- evidence: `baseFor` returns `null` for every `OpenedProviderFile` other than `kind === "text"`. EACCES, ELOOP, and EFBIG therefore flow to `assemble`'s `missingExtends` problem, even though `openProviderFile` produced a specific `unreadable` problem and `anyFilePresent` treats the same file-level problem as presence. D2 explicitly merges absent and no-adapter-match; it does not specify collapsing a present read failure.
- impact: Permissions, symlink-loop, or provider-size failures are presented as a bad `extends` target, and the same provider may simultaneously appear as detected/switchable. Rows and containment remain safe.
- suggestedFix: Preserve the file-level problem from `baseFor` and report its `unreadable` reason; reserve `missingExtends` for absence and no matching framework file.
- status: open
- triage: New non-gating diagnostic defect.

## Cross-round dispositions
- author-triage: ACCEPTED. `baseFor()` collapsing EACCES/ELOOP/EFBIG into `missingExtends` contradicts the PLAN acceptance clause that a malformed file, an unknown key and a missing `extends` target each report distinctly, and `openProviderFile` already produced the correct `unreadable` problem before it was discarded. Conformance to an accepted requirement, not a new decision. Carried into the replan with F012.

### F002
- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:469`
- title: Pinned target bytes remain behind a second live containment check
- evidence: `Authorized` now carries the exact successful `OpenedProviderFile`; `openProviderFile` returns it before root preparation, containment, or a second read. The target-change witness at `readProvisioning.test.ts:647-685` closes the prior failure.
- impact: Prior impact removed.
- suggestedFix: none
- status: fixed
- triage: Fixed cumulatively; D1 result seam holds.

### F003
- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:118`
- title: A recoverable JSONC error discards every valid native key
- evidence: The parser error is reported, then recovered mapping keys are still read; early return occurs only when no mapping survives.
- impact: Prior impact removed.
- suggestedFix: none
- status: fixed
- triage: Fixed since round 3 and remains fixed.

### F004
- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/worktreePanel.css:1215`
- title: Excluded rows collapse into the checkbox grid column
- evidence: `.wt-brow--excluded` uses a one-column grid and explicitly places metadata in column 1; frontend review found no regression.
- impact: Prior impact removed.
- suggestedFix: none
- status: fixed
- triage: Fixed since round 3 and remains fixed.

### F005
- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:181`
- title: Successful toggled-name lookup does not prove filesystem case folding
- evidence: The toggled-name probe no longer exists; identity performs no single-file filesystem probe.
- impact: Prior mechanism removed.
- suggestedFix: none
- status: fixed
- triage: Fixed by construction under D11.

### F006
- ID: F006
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.test.ts:687`
- title: The no-hook D11 fallback is reachable but has no witness
- evidence: The optional identity hook and fallback no longer exist; task 7_1 tests the single lexical/platform mechanism.
- impact: Prior mechanism removed.
- suggestedFix: none
- status: fixed
- triage: Fixed by construction.

### F007
- ID: F007
- severity: N/A
- confidence: N/A
- priority: N/A
- agent: chair
- class: machinery
- file:line: N/A
- title: Reserved identifier from the corrected round-5 request-scope stop
- evidence: Round 5 records that F007 was not a code finding and may not be reused.
- impact: none
- suggestedFix: none
- status: rejected
- triage: Identifier remains reserved; no code disposition changed.

### F008
- ID: F008
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:181`
- title: Final-target realpath merges two distinct destination paths
- evidence: `identityOf` does not call `realpath`; symlink aliases are keyed by their declared names and are not collapsed through object identity.
- impact: Prior realpath alias-collapse removed.
- suggestedFix: none
- status: fixed
- triage: The accepted round-5 blocker is closed by construction. F013 is a different over-merge mechanism and receives a new ID.

### F009
- ID: F009
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:181`
- title: Raw exclusions can resolve arbitrary paths outside the repository
- evidence: Exclusions are normalized as strings only. The instrumented test passes `../outside`, `/etc/passwd`, and a backslash spelling and observes no outside argument reaching `realpath` or `lstat`. Current function shape also gives identity no filesystem dependency.
- impact: Prior outside-resolution path removed.
- suggestedFix: none
- status: fixed
- triage: The accepted round-5 blocker is closed by construction. The witness proves F009's outside-path claim; code structure proves the broader no-identity-I/O property.

### F010
- ID: F010
- severity: WARN
- confidence: HIGH
- priority: P3
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:181`
- title: Resolution cap is applied after full exclude-list materialization
- evidence: Identity performs no resolution. Valid exclude length remains structurally bounded by the 256 KiB provider-file read cap; performance review found no uncapped growth or shifted full-recompute defect.
- impact: Prior resolution work removed.
- suggestedFix: none
- status: fixed
- triage: Accepted round-5 warning closed by construction.

### F011
- ID: F011
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: prior reviewers
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:26`
- title: ProviderDeps does not state the canonical realpath contract identity assumes
- evidence: Identity no longer consumes `ProviderDeps.realpath` or `lstat`; their remaining contract is containment-only and already documented.
- impact: Prior identity-contract ambiguity removed.
- suggestedFix: none
- status: fixed
- triage: Accepted round-5 suggestion closed by construction.

---

## Author triage — revision after the handback, 2026-09-02

**Both blockers are withdrawn as stale. The handback is not taken.** Round 7 reviewed a tree that
predates the two dependencies which replaced the mechanism it attacks.

### The ancestry

Round 7's recorded Head is `f995fb7e`. `git merge-base --is-ancestor` puts WT-012.17's first commit
(`9498f73b`) OUTSIDE that ancestry: the reviewed tree predates WT-012.17 entirely.

At `f995fb7e`, `readProvisioning.ts` carried:

```js
function identityOf(): (declared: string) => string {
  const fold = platformFoldsFilenameCase();
  return (declared) => {
    ...
    return fold ? trimmed.toLowerCase() : trimmed;
  };
}
```

That factory — platform-gated, `toLowerCase`-folded, and used as the MERGE key — is precisely and
only what F001 and F013 attack. It no longer exists.

### What replaced it

At HEAD the two concerns are split across two functions with opposite obligations:

| Function | Job | May it drop a row? |
|---|---|---|
| `identityOf` (`providerKit.ts:317`) | merge/dedupe key — `path.posix.normalize` plus a trailing-slash strip, nothing else | yes, so it is purely lexical and folds NOTHING |
| `foldable` → `contendersOf` (`providerKit.ts:376-383`) | flags that two rows MAY name one slot | no — it only groups, and the contest owner names every member |

The aggressive Unicode fold survives only in the second, where over-inclusion costs a visible contest
rather than a vanished declaration.

### Verified on this host, not reasoned

- **F013.** `identityOf("İ") !== identityOf("i̇")`, and the same for `Ϗ`/`ϗ` and `ẞ`/`ß`, so no
  declaration is merged away. Each pair is still grouped by `contendersOf` with the native row
  favoured. F013's stated impact — "a supported default Windows configuration can silently discard a
  declaration" — cannot occur: the fold that would discard it is gone, and the fold that remains
  discards nothing.
- **F001.** On `darwin`, `contendersOf` groups an inherited `mixedcase` with a native `MixedCase` as
  one contest, favoured on the native row: `[{"members":["a","b"],"favoured":"b"}]`. The chair's
  probe found the apply "copied the inherited spelling and skipped the native row as already there"
  through `extension.ts:574-590` copy-before-link — the path WT-012.18 replaced with
  `contestsOf`/`applyProvisioning`, which materializes the favoured member and refuses the held one.

### The one honest dependency

F001's closure is not complete in this change. The GROUPING is verified here; the apply-time outcome
is WT-012.18's accepted contract (`award-a-contested-destination-or-refuse-it`), which this change
already declares in `Depends On`. That change's own verification round is open. If it does not close,
F001 reopens here — recorded rather than assumed.

D11 anticipated exactly this: "Two declarations name one destination slot on a volume that folds
names is its own invariant with its own acceptance story ... It is now a change of its own; this one
ships without it and records the residual." The residual has since been given its owner.

### Disposition

F001 and F013: **withdrawn — stale**, superseded by WT-012.17 and WT-012.18. No `D11` change and no
new invariant owner is required, so the remediation boundary is not crossed and no handback is owed.
F012 and the round's WARN/SUGGEST remain open on their own terms. A verification round against
current HEAD follows, because the author establishing his own findings stale is a claim, not evidence.
