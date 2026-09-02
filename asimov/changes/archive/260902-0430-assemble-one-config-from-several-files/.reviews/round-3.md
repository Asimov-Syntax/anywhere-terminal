# Review Round 3

- Date: 2026-09-01
- Cycle: 2
- Round: 3
- Mode: discovery
- Arbiter: yes
- Review profile: fastlane
- Scope: cumulative range `386f65ff~1..HEAD`, including approved task 4_1 and its remediation
- Head: `d50b961a7d8860ec9fba71b1a8a5932b71bf2f71` (working tree dirty only from review accounting in `asimov/changes/assemble-one-config-from-several-files/analytics.json`)
- Reviewable lines: 710
- Escalation flags: `new-api-contract`, `user-visible-ui`
- Agents spawned:
  - asm-review-data-security — exact-target snapshot, containment transitions, and filesystem path identity — gpt-5.6-sol[1M]
  - asm-review-logic — cumulative merge, adapter handoff, parse recovery, and shared-state behavior — gpt-5.6-terra[1M]
  - asm-review-contracts — approved adapter/model/task obligations and consumers — sonnet[1M]
  - asm-review-frontend — excluded-row layout, selection, counts, and accessibility — gpt-5.6-terra[1M]
  - asm-review-reuse — path-identity and opened-file ownership against existing helpers — gpt-5.6-luna[1M]
  - asm-review-performance — cumulative provider-byte, row, and scan bounds — gpt-5.6-luna[1M]
- Agents skipped: none
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports every task exit 0; workflow records check-types clean, the established Biome baseline with no touched-file error, the deletion gate passing, and 279 files / 6550 tests green. The review did not rerun project verification commands.
- Chair probes:
  - F001: on the shipping macOS filesystem, `realpath` resolved `MixedCase` and `mixedcase` to the same destination; the production reader still offered inherited `mixedcase` and native `MixedCase` as two rows, and `exclude: ["MIXEDCASE"]` removed neither.
  - F002: after the named `.worktreeinclude` snapshot was authorized, changing its later containment answer to outside caused the adapter to omit the snapshot, inherit `node_modules` and `pnpm install` from `orca.yaml`, mark Orca active, and report only the later escape.
  - F003: the recoverable malformed JSONC probe now retained its copy and setup rows and emitted one malformed problem.
  - F004: the final cascade gives excluded rows one column and resets metadata to column 1 after the base rule.
- Verdict: BLOCK
- Status: blocked
- Counts: BLOCK 2 | WARN 0 | SUGGEST 0
- Blocking split: 2 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:161`
- title: Path identity still splits one destination on case-insensitive filesystems
- evidence: `pathKey()` applies only `path.posix.normalize()` and trailing-slash removal. That closes dot-segment aliases but leaves case variants distinct. On this shipping macOS host, a scratch directory's `MixedCase` and `mixedcase` spellings both `realpath` to the same canonical path. A production `readProvisioning()` probe with inherited `mixedcase`, native `MixedCase`, and `exclude: ["MIXEDCASE"]` returned both inherited and native rows, an empty `excluded` list, and no problem. The coordinator's cited `normalizePathForCompare()` convention does not decide this layer: it receives absolute IDs and deliberately performs no relative dot-segment normalization, while task 4_1 and round-1 triage define merge identity as the destination on disk rather than the declaration string.
- impact: On the default macOS filesystem, and equivalently on case-insensitive Windows directories, the native declaration does not reliably win and exclusion does not reliably remove the destination. The offer can again expose conflicting link/copy operations for one place.
- suggestedFix: Derive an internal destination identity using the actual target filesystem's case semantics together with POSIX lexical normalization; do not globally lowercase paths on case-sensitive volumes. Preserve each row's original `path` and `source` for display and provenance. Add case-insensitive and case-sensitive witnesses.
- status: accepted
- triage: persists from round 1; round-3 Arbiter sustains the blocker on materially new case-equivalence evidence
- invariant: Every accepted spelling that resolves to the same worktree destination is one merge identity; native wins it and exclude removes it.
- boundary inventory:
  - affected: native/base dedupe; exclusion; D10 contradiction detection on case-insensitive destinations
  - verified safe: `./`, `..`, and trailing-slash lexical aliases now canonicalize; displayed `path` and `source` are not rewritten; containment and offer redemption remain unchanged
  - not safe: filesystem case equivalence on a shipping default volume

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:140`
- title: Pinned target bytes remain behind a second live containment check
- evidence: `baseFor()` wraps only `ProviderDeps.readFile`. Each framework adapter calls `openProviderFile()` again, which reruns `prepareResolvedRoot()` and `contained()` before reaching the pinned read. In the chair probe, `.worktreeinclude` was authorized and read once, then its later `realpath` resolved outside the repository. Orca's second open rejected the target before `readFile`, so the authorized snapshot was never consumed; the model nevertheless inherited `node_modules` and `pnpm install` from live `orca.yaml` and marked Orca active. The new ENOENT witness passes because absence falls through containment to the pinned `readFile`; it does not cover an outside, unresolvable, or root-change result that returns earlier.
- impact: The exact file whose authorization selected the base can still be omitted while an unnamed sibling contributes paths or commands. The remediation now reports the later containment problem, reducing the silence of round 1, but D2's exact-target snapshot invariant and the load-bearing model remain violated.
- suggestedFix: Hand the already-authorized `OpenedProviderFile` result through the adapter/opening boundary for the exact named file, so that snapshot bypasses a second containment/open operation. Keep the adapter's sibling files live and independently authorized. Cover inside-to-outside, unresolvable/root change, disappearance, and both Orca target choices.
- status: accepted
- triage: persists from round 1; round-3 Arbiter sustains the blocker
- invariant: The exact framework file named by `extends` is authorized and consumed from one consistent snapshot; whole-adapter expansion cannot replace or omit that snapshot.
- boundary inventory:
  - affected: authorized-file handoff; containment-transition error paths; Orca provider activity
  - verified safe: ordinary content changes and ENOENT after authorization reach the pinned bytes; sibling reads keep the same budget and live containment; self-extension and unrelated targets remain rejected
  - not safe: a second containment/root result that returns before pinned `readFile`

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:112`
- title: A recoverable JSONC error discards every valid native key
- evidence: Fixed. Parse damage is charged and reported, then an object mapping continues through `extendsOf()`, `excludeOf()`, and `readInlineKeys()`. The prior probe now returns the recovered copy and setup rows plus one malformed problem; no-mapping damage still returns one reason.
- impact: The fail-partial contract is restored.
- suggestedFix: none
- status: fixed
- triage: fixed in `2ff0bcd8`

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-frontend
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/worktreePanel.css:1215`
- title: Excluded rows collapse into the checkbox grid column
- evidence: Fixed. `.wt-brow--excluded` now has one grid column, and the later, more-specific metadata rule resets `.wt-brow-meta` to column 1. Ordinary rows retain the checkbox grid. The frontend specialist found no cascade, responsive, selection, accessibility, or untrusted-text regression.
- impact: The deliberate-removal row has its intended two-line content width.
- suggestedFix: none. A stylesheet-text assertion would prove only that declarations exist, not rendered grid behavior, so its absence is not a material test defect.
- status: fixed
- triage: fixed in `2ff0bcd8`

## Adjudication notes

- Specialist IDs for the containment finding were merged into existing F002; it is the same exact-target snapshot invariant and causal handoff mechanism, not a new defect.
- The data-security path-identity concern was merged into existing F001. The Arbiter's deciding witness is case equivalence on an actual shipping filesystem; no conclusion depends on treating every source symlink alias as one destination.
- The contracts specialist considered F002 closed because the bytes were pinned, but did not account for `openProviderFile()` returning from its second live containment check before invoking pinned `readFile`. The chair probe and two specialists directly reproduce that branch, so the concrete evidence controls.
- No performance, reuse, or additional frontend findings survived adjudication.

## Arbiter dispositions

- F001 — **accepted**: lexical aliases are fixed, but the case-insensitive destination witness still violates the accepted one-destination invariant on a shipping platform.
- F002 — **accepted**: the authorized bytes can still be skipped by the adapter's second containment/root check while Orca's unnamed sibling contributes to an active model.

## Status

BLOCKED. Round 3 is the final review and two accepted gating blockers remain. The change parks and must not archive. A round 4 requires an explicit user grant through the review control plane; no coordinator or agent message supplies that consent.

## Author triage — round 3

Both findings ACCEPTED, neither rebutted. Both were reproduced against the shipped reader before
triage rather than taken on the report's word, and both reproduce.

**F001 — accepted.** `/tmp` on this host is case-insensitive (`MixedCase` created, `mixedcase`
stats), so the premise holds on the platform this ships to. I raised this exact question to the
chair and argued the other way — that identity should match what the provider files DECLARE and the
filesystem's folding is WT-012.2's problem. The chair's counter is the one that decides it: round-1
triage and task 4_1's own Acceptance define identity as the destination on disk, so a rule keyed on
the declaration string contradicts the invariant this task was written to hold. My
`normalizePathForCompare` evidence was answered correctly too — it establishes a convention for
ABSOLUTE ids and says nothing about this layer.

**F002 — accepted.** Confirmed with a probe where the authorized `.worktreeinclude` resolves outside
the checkout on the adapter's own re-open: the model inherited `node_modules` AND `pnpm install`
from live `orca.yaml`, orca stayed active, and the named file contributed nothing. Better than round
1 in that a problem IS now reported for `.worktreeinclude`, and still the same defect underneath —
the file whose authorization selected the provider is absent from the offer while its unnamed
sibling supplies a shell command. Pinning only `readFile` was insufficient because
`openProviderFile` re-runs root preparation and containment BEFORE it reaches the pinned read, and
my ENOENT witness passed only because absence happens to fall through to it. That is an assertion
that could not fail for the reason I thought it did.

## Remediation boundary — why this parks instead of entering a fix loop

Neither fix is remediation any more.

- **F002**'s fix, in the chair's own words, is to "pass the already-authorized opened-file result
  through the adapter boundary". That is a change to `ProviderAdapter.read`'s contract — the exact
  change D1 records rejecting, and the exact change I avoided in round 1 specifically to stay inside
  the boundary. There is no longer an in-contract way to close it: the round-1 approach is now
  proven insufficient.
- **F001**'s fix requires identity to consult the target filesystem's case semantics, which turns a
  pure lexical function into one that probes the filesystem, and needs a rule for what to do on a
  case-SENSITIVE volume where folding would be wrong. That is a new decision with a new owner, not a
  clarification of an existing one.

Both therefore require `asimov-plan` to re-earn Gate 2 on amended decisions. Under the design
lifecycle's remediation boundary that is option 1 of the thrash stop, and round 3 was the final
automatic round — so this change parks for a user decision and MUST NOT archive.

No `--user-approved` and no `--extend` has been fabricated to get past this, and none will be.
