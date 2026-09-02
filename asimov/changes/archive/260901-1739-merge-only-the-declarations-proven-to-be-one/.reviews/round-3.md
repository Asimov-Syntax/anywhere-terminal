# Review Round 3

- Date: 2026-09-01
- Cycle: 2
- Mode: discovery
- Arbiter: yes
- Scope: cumulative range `414b0aef..061116d1` (the parent of the change's first commit through HEAD)
- Head: `061116d16311cb3bb05916b083a8eb0d3826a673` (the pre-review tree was clean; `round-start` generated analytics changes and the superseded round-2 artifact outside the explicit range)
- Reviewable lines: 562
- Agents spawned:
  - `asm-review-logic` — contender grouping, filesystem folds, selection branches, ids and reminting — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — ProvisionModel, per-read identity and offer remint contracts — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — contender rows, summary truth and untrusted provider strings — `sonnet[1M]`
  - `asm-review-logic` — TypeScript-AST filesystem reachability gate — `gpt-5.6-terra[1M]`
  - `asm-review-reuse` — Win32 fold ownership and Unicode-fold reuse — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — no auth, secrets, persistence, external API, or new input boundary changed; containment and host-issued offer redemption were traced by the chair
  - `asm-review-performance` — the model is structurally capped at 200 rows; contender construction and rendering are bounded by that cap, with no new uncapped growth axis
- Verdict: BLOCK
- Status: blocked
- Counts: 1 BLOCK, 2 WARN, 0 SUGGEST open; 3 prior BLOCK findings fixed
- Split over gating blockers: 1 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status merge-only-the-declarations-proven-to-be-one` records tasks 1_1–4_3 at exit 0, including the five round-1 remediation witnesses and the known deadline/base and CPU-contention exclusions. Review ran no project verify command. A targeted scratch probe created and removed files in one command and confirmed this case-insensitive APFS volume resolves Greek sigma and final sigma as one filename while the shipped detector emits different keys.

## Findings

### F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:306`
- Title: The generous detector still misses common-filesystem Unicode folds
- Evidence: The amended detector replaces only `ß` and `ſ` after `NFKC` plus `toLowerCase()`. That is still a partial hand-written subset of full Unicode case folding. Greek `σ` and final sigma `ς` retain different detector keys. A scratch witness on the current case-insensitive APFS volume created `σ` and observed `ς` as the same existing filename; the same result holds for `οσ`/`ος`. Therefore two declarations this common filesystem folds receive no contender group. The round-1 witnesses `Straße`/`STRASSE`, `ﬀ`/`ff`, and a dotted non-final Win32 component now close, but the invariant does not.
- Impact: Both rows remain visible, but the advisory component WT-012.18 relies on for ordering is absent. The pair can reach apply as unrelated entries competing for one APFS destination, exactly D4's prohibited false-negative direction.
- SuggestedFix: Replace the two-entry expansion list with a complete, versioned Unicode full-case-fold mapping per segment, composed with normalization and the shared Win32 fixed-point rule. Add `σ`/`ς` or `οσ`/`ος` as an APFS-backed regression witness and retain the existing three remediation witnesses.
- Status: accepted
- Triage: Persists from round 1 under the same invariant and causal mechanism: every pair folded by a supported common filesystem must share a contender component, and a partial Unicode fold table omits members of that relation. Boundary inventory searched: normalized-spelling merge and exclusion; APFS full Unicode folds; NFC/NFD and compatibility composition; Win32 dot/space/`::$DATA` stripping per segment; native assembly; framework winner and provider switch; reminting; UI display. Affected: APFS full Unicode folds not covered by the two explicit replacements, confirmed by sigma/final-sigma. Verified safe: merge/exclusion never use the fold; the three round-1 F001 witnesses; all production model-selection branches; shared-read ids and reminting; no contender consumer merges, drops, reorders, unchecks, or rewrites a row.
- Arbiter disposition: accepted — the live APFS witness directly falsifies approved D4/D8 and task 4_1 on the load-bearing detector path. This is neither contestable nor external, and the change parks.

### F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:462`
- Title: Standalone and switched framework offers never compute contenders
- Evidence: Fixed. The non-native return now replaces the adapter's empty `contenders` with `contendersOf(chosen.answer.model.entries)`. The same branch handles both an initial framework winner and a `prefer` switch; native results still finalize inside `assemble()` after merge and exclusion.
- Impact: None remaining on the production offer path. Every provider-selection mode now derives groups over the entries it offers.
- SuggestedFix: None.
- Status: fixed
- Triage: The original boundary inventory was native-only, native-plus-base, standalone framework selection, and provider switches. All four are now verified safe. The separate exported direct Asimov reader is recorded as F006 because it is not an offered production-selection mode and has materially different reachability and impact.

### F003

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts` and `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:92`
- Title: Adapter-local id collisions collapse contender membership during reminting
- Evidence: Fixed. `ProviderBudget.nextId` owns one sequence, `readProvisioning()` creates one budget per read, native assembly passes it to the base adapter, and all four adapters now mint entries, ports, and setup steps from that sequence. The production inventory contains no remaining adapter-local `ids()` call. Consequently `remint()` receives distinct entry ids and its map preserves one distinct live offer id per group member and the favoured member.
- Impact: None remaining on shared-read or offer-remint paths.
- SuggestedFix: None.
- Status: fixed
- Triage: Boundary inventory rechecked: native plus base, standalone framework, provider switch, unrelated rows, group member remint, favoured remint, and offer redemption. All production paths are safe. `ids()` remains exported but has no production caller except `newBudget()`; direct provider reads each use one fresh budget and do not combine adapter models.

### F004

- ID: F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:448`
- Title: The summary calls every contender component a pair
- Evidence: Fixed. A single component reports its actual member count as `N spellings may be one file`; multiple components are described as sets rather than pairs. Tests cover two members, three members, and two separate components. The dialog never reads `favoured`, so it makes no claim that the favoured row lands.
- Impact: None remaining. Three-or-more-member components are no longer understated as pairs.
- SuggestedFix: None.
- Status: fixed
- Triage: Row rendering was also traced: each entry's own `path`, `source`, opaque id, and checked state are preserved; contender membership only adds a note. Provider-controlled subject, source, partner, problem, and visible provider-file text are assigned through `textContent`; no changed path interprets them as markup.

### F005

- ID: F005
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/oneOwner.test.ts:281`
- Title: The AST gate still cannot follow imported filesystem helpers
- Evidence: The AST rewrite closes local arrow functions, local methods, and helpers passed as identifier values, but it still builds one `SourceFile`, indexes callables by unqualified text name, and explicitly stops when a referenced name resolves to an import. A root such as `identityOf(declared) { return inspectName(declared); }` stays green when `inspectName` is imported and calls `node:fs.realpathSync`; the root contains none of the regex's exact `deps`, `await`, `.readFile(`, `.readdir(`, `.realpath(`, or `.lstat(` tokens, and the imported helper is absent from `callablesOf`. Class-field arrows, computed method names, and same-named/shadowed callables are also outside the symbol-free map. The non-vacuity test proves only that the old left-margin regex misses the three local fixtures; it does not arm any cross-module or symbol-identity case. Task 4_3's plan explicitly named imported helpers and the existing `fsDeletionGate.ts` TypeScript Program as the construction to reuse, but this test uses neither.
- Impact: Current production identity roots are clean and the accepted arrow/method/value witnesses now fail correctly, but an ordinary extraction of filesystem identity into an imported helper can restore the eighth filesystem mechanism without tripping the promised structural gate.
- SuggestedFix: Drive a TypeScript Program and checker across the identity roots' imported call graph, or enforce and test a closed module boundary that forbids identity roots from reaching imports/capabilities. Match filesystem capabilities by resolved symbol/type rather than exact parameter spelling and four property tokens; add an imported `node:fs.realpathSync` mutation witness.
- Status: accepted
- Triage: Persists from round 1 with narrower affected boundaries. Verified safe now: direct hooks, local function declarations, local arrows/function expressions, object/class methods recognized by the current collector, and local helpers passed as identifier values. Still affected: imported helpers owning filesystem access, class-property callables, computed names, shadowed/same-named callables, and filesystem APIs outside the four lexical hook names. Support finding; non-gating by Phase 2.5.

### F006

- ID: F006
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/asimovProvider.ts:61`
- Title: The exported direct Asimov model bypasses contender finalization
- Evidence: `readAsimovProvisioning()` remains an exported `Promise<ProvisionModel>` constructor and returns `fromOpened(..., newBudget())` directly. Every adapter result comes from `modelFromDraft()`, which hard-codes `contenders: []`; only the `readProvisioning()` dispatcher replaces that field. Therefore a direct Asimov model containing `MixedCase` and `mixedcase` returns two entries and no group. Repository search finds no current production caller outside tests; the extension's live offer path uses `readProvisioning()` and is covered by fixed F002.
- Impact: The widened public model contract is semantically inconsistent: a future or test consumer of the exported direct reader receives a `ProvisionModel` that cannot express collisions its own entries contain. It does not currently falsify the shipped offer path, so it is warning-level rather than gating.
- SuggestedFix: Finalize contenders in a shared model-finalization helper used by every exported `ProvisionModel` constructor, or narrow/remove the direct export if it is intentionally only an adapter fixture. Add a direct-reader witness if the API remains.
- Status: accepted
- Triage: New in round 3. Different from fixed F002 because this boundary has no production offer caller and therefore materially lower impact, even though both bypassed the same adapter-level empty field.

## Full-flow trace

- Native initial selection, with and without `extends`: one budget spans native and base reads; normalized equal spellings merge, exclusions run on that identity, contenders derive from surviving offered entries, offer issuance remints group ids, the webview draws both rows unchanged, selection redeems host-held ids, and application receives the selected entries in their existing order.
- Framework initial selection and provider switch: the chosen adapter model is finalized through `contendersOf` before offer issuance; switch latest-wins/opening guards remain intact; reminting and rendering follow the same path as native.
- Empty, absent, malformed, and preferred-provider-absent paths: empty models carry an empty contender list; a missing preference falls back through the normal ordered detection path; problems do not manufacture groups or disable create.
- No contender consumer merges, drops, reorders, unchecks, rewrites, or executes an entry. Whether the favoured entry wins at the destination is not claimed here and remains WT-012.18's explicit unresolved obligation.

## Arbiter dispositions

- F001 — accepted. The current APFS witness closes the contestability question: the shipped detector misses a common-filesystem fold on the load-bearing production path, so D4/D8 and task 4_1 remain false. The blocker is repo-fixable, not external, and the change is blocked at the round-3 thrash stop.

## Adjudication notes

- The frontend candidate about a summary counting stale/malformed group ids was rejected. Production groups are built from surviving live entries after merge/exclusion, shared-read ids are unique, and offer reminting translates those exact ids before the host sends the model; no changed host-produced path can create the stale group the candidate requires.
- Reuse review found one owner for Win32 stripping and no duplicate implementation. The remaining F001 defect is semantic incompleteness of the Unicode relation, not duplicate Win32 code.
- No audit-backlog, external-blocker, or user-granted accepted-risk entries exist.

## Author triage — round 3

All three findings reproduced independently before triage.

- **F001 — accepted, and it fires the thrash stop.** Verified on the real volume, not on paper: writing `σ` and then `ς` into a temp directory under `$TMPDIR` on this APFS mount leaves ONE file. The fold misses the pair. This is the SECOND fix attempt on the same invariant — round 1 rejected `NFC` + `toLowerCase`, and this round rejects `NFKC` + lowercase + two explicit expansions — so `asimov-build`'s "the same invariant survives 2 fix attempts" stop applies, and a third hand-tuned table would be thrash by definition rather than a fix.
  Measured while triaging, and it is the reason this is a design question rather than a patch: `Intl.Collator("en", { sensitivity: "accent" })` and the hand fold are incomplete in OPPOSITE directions. The collator groups `σ`/`ς` and splits `ß`/`ss`; the hand fold does the reverse. Both agree on `Σ`/`σ`, `ǅ`/`ǆ`, `İ`/`i̇`, NFC-vs-NFD `Å`, `ﬁ`/`fi`, `ᾼ`/`ᾳ` and `ⅷ`/`Ⅷ`. Neither is the answer alone, and a union changes the SHAPE of the code — a collator is a comparator, not a key, so grouping stops being hash-by-key and becomes connected components over a relation. That needs a `D#`, so this is an artifact handback and not remediation.
- **F005 — accepted as a warning, and not deferred.** The gate parses one file and indexes callables by unqualified name, so an imported helper calling `realpathSync` is never traversed. Task 3_1's Acceptance is "an identity path that reaches a dep hook fails the suite", and an extraction into a helper module is the ordinary shape that would break it. Two rewrites of this gate have each closed the shapes the previous round named and left a wider one, which is itself worth noticing: the gate is chasing shapes instead of resolving symbols.
- **F006 — accepted as a warning.** Confirmed: `readAsimovProvisioning` at `asimovProvider.ts:61` returns `modelFromDraft()` whose `contenders` is always empty, and `grep` shows its only callers are `asimovProvider.test.ts` and `provisioningDeps.test.ts` — no production path. So it is an export whose semantics differ from the one the extension uses, which is a trap for the next caller rather than a live defect.

Nothing was rebutted. Round 3 was the last automatic round; the thrash stop's option 1 is taken — hand back to plan for a designed fix — with the oracle consulted on the mechanism, which the standing goal explicitly allows.
