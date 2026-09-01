# Review Round 1

- Date: 2026-09-01
- Cycle: 1
- Mode: discovery
- Requested lane: fastlane
- Escalation: `new-api-contract`
- Scope: range `414b0aef..55628840`
- Head: `556288405971ede62c03e4b1be9317193b319e07` (working tree dirty from generated analytics files, outside the reviewed range)
- Reviewable lines: 362
- Agents spawned:
  - `asm-review-logic` — contender identity and selection modes — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — contender id contract and reminting — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — contender row rendering and summary truth — `sonnet[1M]`
  - `asm-review-logic` — offer-store reminting and structural gate — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — folding helper ownership — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-data-security` — no auth, secrets, persistence, or external data boundary changed
  - `asm-review-performance` — entries are structurally capped at 200 and contender metadata is derived linearly from those entries; no uncapped growth axis or hot-path recomputation was introduced
- Verdict: REJECT
- Counts: 4 BLOCK, 1 WARN, 0 SUGGEST
- Split over gating blockers: 4 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status merge-only-the-declarations-proven-to-be-one` records all six tasks at exit 0, with the known base-commit deadline flake and CPU-contention failures documented as out of scope. Review ran no project verify commands; only targeted in-memory scratch probes were used.

## Findings

### F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, corroborated by chair and `asm-review-reuse`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:286`
- Title: The generous detector still misses common-filesystem folds
- Evidence: `foldable()` ends with `normalize("NFC").toLowerCase()`, which is lowercase conversion rather than full Unicode case folding: `Straße` maps to `straße` while `STRASSE` maps to `strasse`, and the ligature `ﬀ` likewise remains distinct from `ff`. Its Win32 loop also applies `/[. ]+$/` only to the end of the complete relative path, although Win32 strips trailing dots/spaces from every component, so `parent./child` and `parent/child` retain different keys. Targeted probes reproduced both false negatives. The changed tests assert declaration conservation for `Straße`/`STRASSE` but never assert that pair is grouped; the three-member test substitutes `Strasse`, which simple lowercasing already handles.
- Impact: These pairs keep both rows, but they do not receive the advisory component that WT-012.18 needs to impose ordering. This is exactly D4's prohibited false-negative direction and reopens the wrong-winner defect for common APFS and Win32 destinations.
- SuggestedFix: Build connected components from a deliberately conservative union of detector relations, including multi-code-point Unicode folds and Win32 fixed-point stripping per normalized path segment. Extract the shared Win32 segment primitive used by `entryGate.ts` so the two implementations cannot drift, while keeping contender detection unconditional and advisory. Add witnesses for `Straße`/`STRASSE`, `ﬀ`/`ff`, and a non-final dotted/spaced component.
- Status: accepted
- Triage: The invariant is that every pair folded by a supported common filesystem must share a contender component; false positives are allowed, false negatives are not. Boundary inventory searched: ASCII/simple case, full Unicode multi-code-point case folds, NFC/NFD equivalence, Win32 final-component dots/spaces and `::$DATA`, composed fixed points, and Win32 non-final components. Affected: full Unicode folds and non-final Win32 components. Verified safe: simple case, NFC/NFD, final dots/spaces, and final `::$DATA` compositions.

### F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:442`
- Title: Standalone and switched framework offers never compute contenders
- Evidence: `contendersOf()` is called only inside `assemble()`, which runs only when the native adapter wins. The non-native branch returns `{ ...chosen.answer.model, providers }` directly, and every adapter model is initialized with `contenders: []`. An Asimov, Orca, or VS Code provider containing foldable declarations therefore has no groups when it is the initial winner, and the same omission occurs when the user switches to it through `prefer`.
- Impact: Identical declarations receive different advisory guarantees depending on which provider supplied the offer. Repositories without `.vscode/worktree.json`, and every framework-provider switch, can reach apply time without the ordering data this change exists to supply.
- SuggestedFix: Finalize contender components in one common post-selection step over every model's surviving offered entries, including native assembly, standalone framework selection, and provider switches. Add direct and switched framework witnesses with two foldable entries and no favoured member.
- Status: accepted
- Triage: The invariant is that every offered entry set is finalized through contender detection, independent of provider-selection mode. Boundary inventory searched: native-only, native-plus-base, initial standalone Asimov/Orca/VS Code selection, and `prefer` switches. Affected: every non-native initial or switched offer. Verified safe: native assembly with or without an inherited base.

### F003

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts` and `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:92`
- Title: Adapter-local id collisions collapse contender membership during reminting
- Evidence: Each adapter starts its own `ids()` sequence, so a normal inherited/native pair can both be `i1`. `contendersOf()` serializes that as `members: ["i1", "i1"]` at `readProvisioning.ts:333`; `remint()` then stores translations in `Map<string,string>`, and the second `reminted.set("i1", ...)` overwrites the first. The group becomes two copies of the second live id, while the first row remains in `entries` but leaves the group. A targeted probe reproduced `members: ["item-2", "item-2"]`. With other colliding ids, a member can translate to an unrelated row; `flatMap` also silently drops unresolved members and can leave a group below its two-member contract.
- Impact: The offer violates the new API contract exactly in the documented cross-adapter case: group membership is neither one-to-one nor complete, partner notes can disappear or name the wrong row, and later ordering can omit a real contender. Source-based native detection is correct before this transformation, but the id-only representation cannot preserve that answer through an ambiguous remint.
- SuggestedFix: Establish offer-wide unique entry identity before constructing id-based groups, or carry an occurrence/object identity through reminting and build groups only after final ids exist. Reject any translated group whose members are not distinct live entry ids of length at least two, and require `favoured` to be one of them. Test the actual collision case with base and native both minting `i1`, plus a collision with an unrelated row.
- Status: accepted
- Triage: The invariant is that every group transformation preserves a one-to-one mapping from each original member to one distinct live offered entry, and preserves the favoured row by declaration provenance. Boundary inventory searched: unique old ids, duplicate ids across adapters, duplicate ids shared with unrelated entries, unknown members, missing favoured ids, and UI read-back. Affected: all cross-adapter id collisions and malformed/stale translations. Verified safe: models whose pre-offer entry ids are already globally unique.

### F004

- ID: F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:438`
- Title: The summary calls every contender component a pair
- Evidence: `bringSummary()` counts `model.contenders.length` and unconditionally emits `N pair(s) may be one file`, but the accepted model uses connected components and the changed UI tests explicitly support a group with three members. A three-row component is therefore summarized as `1 pair`, even though the row notes correctly name two partners for each member.
- Impact: The dialog understates a three-way-or-larger collision in the sentence intended to keep the offered-row counts honest. Users are told two rows are involved when three or more checkboxes may compete for one destination.
- SuggestedFix: Describe components truthfully rather than calling each one a pair, or derive wording from each group's member count. Add a summary assertion for the existing three-member fixture and keep the summary derived from groups that resolve to live entries.
- Status: accepted
- Triage: Verified against the three-member rendering fixture. Two-member groups are worded accurately; every component of three or more members is misreported.

### F005

- ID: F005
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-logic`, corroborated by chair
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/oneOwner.test.ts:224`
- Title: The filesystem reachability gate misses ordinary helper shapes
- Evidence: `topLevelFunctions()` recognizes only top-level `function name(...)` declarations, and `reachableFrom()` can traverse only those bodies. A root calling a `const inspect = (...) => fs.realpathSync(...)`, an object/class method, or an imported/closure helper is not traversed; if the root body itself contains none of `deps`, `await`, `.readFile`, `.readdir`, `.realpath`, or `.lstat`, the gate remains green. A targeted in-memory witness using a local arrow helper was parsed as only `identityOf` and produced `detected: false`. These limits are additional to the test's documented bare-value edge and single-file scope.
- Impact: The current production path is clean and the test is armed for direct and top-level-function calls, but a future filesystem-based identity mechanism can return through a common refactor shape without failing the promised structural gate.
- SuggestedFix: Use TypeScript AST traversal that covers function declarations, variable-bound functions, object/class methods, imports, and closure call edges, or constrain the production file to helper forms the gate can prove and add explicit mutation witnesses for every allowed shape. Broaden the forbidden capability inventory beyond the four current `ProviderDeps` method names if the claim remains “no filesystem”.
- Status: accepted
- Triage: Support finding, so non-gating. Verified safe: current roots exist; direct hook calls and transitive top-level function declarations fail; pure spelling helpers pass. Affected: arrow functions, methods, imported helpers that own their own filesystem capability, closure-captured capabilities, and filesystem APIs outside the four named hook methods.

## Adjudication notes

- The performance suggestion that contender groups bypass `MAX_MODEL_ROWS` was rejected. Groups are derived from at most 200 admitted entries, add no additional rendered rows, and therefore remain structurally bounded; no unbounded growth axis exists.
- The reuse warning about duplicated Win32 stripping was merged into F001 because the duplication has already diverged in the exact false-negative boundary F001 inventories.
- The frontend stale-group summary warning was merged into F003: invalid or unresolved ids are a downstream symptom of the broken remint contract, not an independently actionable mechanism.
- Verified without findings: `source === NATIVE_PROVIDER_FILE` correctly identifies native provenance before reminting; contender rendering preserves each row's own `path` and `source`, retains both checkboxes, and assigns partner text with `textContent`; no contender consumer merges, drops, or reorders entries in this range.

## Author triage — round 1

All five findings reproduced independently before triage; none was taken on the chair's word.

- **F001 — accepted.** `node` probe on the shipped `foldable`: `Straße`→`straße` vs `STRASSE`→`strasse`, `ﬀ`→`ﬀ` vs `ff`, `parent./child` vs `parent/child` — three misses, all in D4's prohibited false-negative direction. `String.prototype.toLowerCase` is simple case mapping; full folding is a different table.
- **F002 — accepted.** `readProvisioning.ts:439` returns `{ ...chosen.answer.model, providers }` for a non-native winner, and every adapter's `modelFromDraft` answers `contenders: []`. So a single provider file declaring two foldable spellings gets no group at all, and neither does any switched provider.
- **F003 — accepted, and it crosses the remediation boundary.** Confirmed at the source: `asimovProvider.ts:144`, `orcaProvider.ts:152`, `vscodeTasksProvider.ts:133` and `nativeProvider.ts:145` each call `ids()`, which restarts at `i1`. `mergeEntries` keeps a base row and a native row whose spellings differ, so `kept` can hold two rows both named `i1`; `contendersOf` then emits `members: ["i1", "i1"]` and `remint`'s old-id-keyed map collapses them. I already knew ids collide across adapters — task 2_1 identifies the FAVOURED member by declaring file for exactly that reason — and I did not carry the same reasoning to MEMBERSHIP. That is the defect. It is not remediable inside the accepted artifacts: nothing in design.md says what a contender group names, and the assumption that it can name ids came from an advisory Plan step that is simply false about this codebase. Choosing between minting unique identity earlier and having a group name something other than an id is a design decision, so this is an artifact handback and Gate 2 is unticked here.
- **F004 — accepted.** The model is connected components and the summary says "pair". The three-member fixture exists in the suite and the summary was never asserted against it.
- **F005 — accepted, not deferred despite being WARN.** Task 3_1's Acceptance is "An identity path that reaches a dep hook fails the suite". A gate that only sees top-level `function` declarations does not deliver that, and an arrow-function helper is the ordinary shape a future mechanism would take. I documented two limits of the walk in the test's own comment; the chair found a third I had not seen, which is the one that matters most.

Nothing was rebutted. The next round is a verification round on the fix commits, not a new discovery round.
