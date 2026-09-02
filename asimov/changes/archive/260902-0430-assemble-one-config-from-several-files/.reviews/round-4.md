# Review Round 4

- Date: 2026-09-01
- Cycle: 3
- Round: 4
- Mode: discovery
- Review profile: fastlane
- Scope: explicit range `d50b961a..bf0d1b8a`; commits after `bf0d1b8a` are excluded
- Head: `bf0d1b8ae651b140dbea24d4937d1290f77f32a0`
- Reviewable lines: 163 production lines (136 additions, 27 deletions); tests and change artifacts reviewed inline but excluded from the count
- Escalation flags: `new-api-contract`, `user-visible-ui`
- Agents spawned:
  - asm-review-data-security — filesystem case identity and exact-target authorization — gpt-5.6-sol[1M]
  - asm-review-logic — merge, fallback, Orca two-file flow, and test witnesses — gpt-5.6-terra[1M]
  - asm-review-contracts — amended adapter and filesystem-identity contracts — sonnet[1M]
  - asm-review-reuse — case/identity helpers and opened-result ownership — gpt-5.6-luna[1M]
  - asm-finder — production callers, dependency modes, and adapter impact cone — gpt-5.6-luna[1M]
- Agents skipped:
  - asm-review-frontend — no frontend or rendering code changed in the requested range
  - asm-review-performance — the authorization map is structurally one entry and the filesystem probe is one operation per native assembly; no growth-axis or hot-loop change
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports tasks 1_1 through 5_2 at exit 0, including the focused readProvisioning witnesses and the recorded type/unit gates. The review did not rerun project verification commands.
- Chair probes:
  - A targeted in-memory production read modeled a case-sensitive filesystem containing distinct `.vscode/worktree.json` and `.vscode/WORKTREE.JSON` files. The reviewed code emitted only the native `MixedCase` row and silently removed inherited `mixedcase`, reproducing F005.
  - A targeted real temporary repository omitted both optional dependency hooks. `readProvisioning` reached D11's `ask === undefined` branch through `resolvedPathBoundary`'s Node fallback and kept both case-variant rows, disproving the test comment's claim that the branch cannot be reached.
  - `git diff --check d50b961a..bf0d1b8a` was clean.
- Verdict: BLOCK
- Counts: BLOCK 1 | WARN 0 | SUGGEST 1
- Blocking split: 1 feature | 0 machinery

## Risk map and full-flow trace

- Exact-target authorization: `readProvisioning` reads the native file, `baseFor` matches the literal target to one framework adapter, opens that exact file once, and creates a one-entry `Authorized` map. The selected adapter forwards the map to each open; `openProviderFile` answers only an exact `ctx.file` hit before root preparation and containment. Asimov and VS Code have one file. Orca passes the same map to YAML and include opens, so only the named file hits and the sibling remains live. The authorized snapshot then contributes to the assembled model and provider activity. This closes prior F002 across both Orca target choices and the single-file adapters.
- Destination identity: after the native and optional base models are read, `foldsCase` probes a toggled spelling of the native filename, and its boolean controls dedupe, exclusion, and the D10 contradiction check. The success path currently proves only that the toggled spelling exists, not that it names the already-proven native file. That false positive reaches every identity consumer and can silently discard a distinct inherited row.
- Dependency modes: the production factory always supplies both `lstat` and `realpath`; direct/custom `ProviderDeps` callers can omit them, and the utility layer then falls back to Node filesystem resolution. The no-hook D11 branch is therefore reachable but outside current production wiring.

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:170`
- title: Path identity splits one destination on case-insensitive filesystems
- evidence: Fixed for its recorded mechanism and witness. `keyer(true)` now folds case for merge, exclusion, and D10, and the new insensitive-volume witnesses close the round-3 case-equivalence failure.
- impact: The original duplicate-row and failed-exclusion behavior on a folding filesystem is closed.
- suggestedFix: none
- status: fixed
- triage: fixed in `8f9e22b7`. F005 is separate because it is the opposite direction of D11, with a different causal mechanism and materially different impact: existence of a distinct toggled-name file causes a false fold and a silent row drop.
- invariant: One filesystem destination has one merge identity; native wins it and exclude removes it.
- boundary inventory:
  - verified safe: lexical aliases; case variants when the toggled spelling succeeds because the filesystem actually folds; display path and source provenance
  - separated: false-positive folding for a distinct toggled-name file is F005

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:469`
- title: Pinned target bytes remain behind a second live containment check
- evidence: Fixed. `baseFor` now carries the complete successful `OpenedProviderFile` in a one-entry map keyed by the exact literal `extends` target. `openProviderFile` returns that result before any second root or containment operation. All four adapters thread the map; Orca passes it to both opens but exact-key lookup serves only the named target, leaving its sibling live.
- impact: The named framework file can no longer disappear from the model because a second containment answer changes before the pinned read; unnamed siblings cannot consume its authorization.
- suggestedFix: none
- status: fixed
- triage: fixed in `6faf842b`; the new containment-transition witness covers the branch the round-1 ENOENT test missed.
- invariant: The exact framework file named by `extends` is authorized and consumed from one consistent opened result; whole-adapter expansion cannot replace or omit it silently.
- boundary inventory:
  - verified safe: Asimov target; VS Code tasks target; Orca YAML target; Orca include target; exact-key sibling miss; provider activity and problem propagation
  - not expanded: sibling files remain deliberately live under approved D1/D2

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:112`
- title: A recoverable JSONC error discards every valid native key
- evidence: Unchanged from round 3: recoverable object mappings continue through native-key parsing while the malformed problem is retained.
- impact: The fail-partial contract remains restored.
- suggestedFix: none
- status: fixed
- triage: fixed in `2ff0bcd8`; no changed evidence reopens it.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-frontend
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/worktreePanel.css:1215`
- title: Excluded rows collapse into the checkbox grid column
- evidence: Unchanged from round 3: the one-column excluded-row rule and metadata override remain in place; the requested range does not touch this UI.
- impact: The deliberate-removal row remains legible.
- suggestedFix: none
- status: fixed
- triage: fixed in `2ff0bcd8`; no changed evidence reopens it.

### F005

- ID: F005
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:211`
- title: Successful toggled-name lookup does not prove filesystem case folding
- evidence: `foldsCase()` returns `true` after any successful `lstat` or `realpath` of `.vscode/WORKTREE.JSON`. On a case-sensitive filesystem, `.vscode/worktree.json` and `.vscode/WORKTREE.JSON` may both genuinely exist as different files, so success establishes existence only. A chair probe modeled exactly that filesystem: both native spellings existed and `realpath` preserved each spelling, yet inherited `mixedcase` plus native `MixedCase` produced only the native row. The added tests encode success as insensitive and failure as sensitive, so the distinct-success case cannot fail them. The contracts specialist's contrary answer was rejected because it treated distinct entry paths as a witness for the probe's file identity; the probe never compares the two native files.
- impact: `keyer(true)` lowercases every declared destination, so genuinely distinct case-variant paths can be deduplicated, excluded, or reported as a contradiction. A repository can silently lose an inherited provisioning row on the case-sensitive filesystem D11 explicitly requires the implementation to preserve.
- suggestedFix: Prove same-object identity, not mere existence. Resolve and compare both original and toggled names, or expose comparable `lstat` identity such as device/inode and require equality. If identity cannot be established, answer case-sensitive. Add a case-sensitive witness where both native spellings exist as distinct files and assert `mixedcase` and `MixedCase` remain two rows.
- status: open
- triage: ACCEPTED. Verified independently before accepting: on this host `realpath` of both `.vscode/worktree.json` and `.vscode/WORKTREE.JSON` returns the canonical stored spelling, so comparing resolved identity distinguishes a folding volume from two distinct files while a bare existence check cannot. The coverage gap is worse than a gap — it is structural: my "case-sensitive" test models the toggled name as ABSENT (`lstat` throws ENOENT), so no assertion in the suite can reach the distinct-success case. I asked this round to attack precisely the claim that "a yes can only mean the volume folded"; it is false. REMEDIATION BOUNDARY CROSSED: D11 states the mechanism as `lstat`, falling back to `realpath`, and identity comparison cannot be expressed through `lstat`, whose `ProviderDeps` return type is `unknown`. D11's mechanism sentence has to change, so this is a handback, not a fix commit.
- invariant: Case folding is enabled only after proving that two spellings identify the same filesystem object.
- boundary inventory:
  - affected: filesystem case probe; native/base dedupe; exclusion matching; D10 contradiction detection
  - verified safe: toggled spelling absent; actual insensitive behavior represented by a successful same-object fake; display path and source remain unchanged
  - not safe: a distinct toggled-name file on a case-sensitive filesystem; a symlink or other object at the toggled spelling whose mere existence is not identity

### F006

- ID: F006
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.test.ts:760`
- title: The no-hook D11 fallback is reachable but has no witness
- evidence: The test comment says omitting both `lstat` and `realpath` cannot reach `foldsCase`, because root preparation fails first. That is true only for the fake `/repo`. `prepareResolvedRoot` and resolved containment fall back to Node filesystem operations. A chair scratch probe created a real temporary repository, supplied only `readFile` and `readdir`, reached `ask === undefined`, and kept both `mixedcase` and `MixedCase` rows. Production `createProvisioningDeps()` always supplies both hooks, so this is not a current production defect.
- impact: D11's explicit conservative fallback and task 5_2's planned absent-probe witness can regress without a focused test, and the present comment gives maintainers a false reason not to add one.
- suggestedFix: Add a focused test using a real temporary repository, or test an extracted pure probe seam, with both optional hooks omitted; assert case-sensitive identity. Correct the reachability comment.
- status: open
- triage: ACCEPTED, non-gating. This corrects a claim I wrote into the test comment rather than merely finding a missing case: I reasoned that omitting both hooks cannot reach `foldsCase` because root preparation fails first, and that is true only of the FAKE root `/repo` — `prepareResolvedRoot` falls back to node's own `fs.realpath`, which succeeds for a real directory. The comment gave a maintainer a false reason not to write the test. Fixed with the mechanism change in the same handback, since D11's conservative default is exactly what the missing witness covers.

## Adjudication notes

- Data-security, logic, and chair independently identified F005. Their evidence agrees with the chair's production-function probe.
- The contracts specialist reported no D11 defect because it interpreted the existing `MixedCase`/`mixedcase` entry test as covering a distinct toggled native file. That does not exercise the probe's ambiguity: the fake's `lstat` success is exactly what both a folding filesystem and a sensitive filesystem with a distinct sibling return. Concrete reproduction controls.
- The contracts specialist also called the no-hook branch unreachable. Production wiring does always supply both hooks, but a direct `ProviderDeps` caller with a real repository reaches the fallback through the utility layer's Node defaults. This supports F006 only; no production failure was found.
- The reuse specialist found no existing repository helper that proves filesystem object identity or a duplicate opened-result abstraction. The finder confirmed one production entry flow and both hooks in production deps.
- No audit-backlog or accepted-risk entries exist to carry forward.
