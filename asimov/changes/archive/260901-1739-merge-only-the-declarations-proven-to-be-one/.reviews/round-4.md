# Review Round 4

- Date: 2026-09-02
- Cycle: 3
- Mode: discovery
- Requested lane: fastlane
- Extension grant: round 4 was already open; `round-start` accepted the user-granted extension
- Scope: range `061116d16311cb3bb05916b083a8eb0d3826a673..85232a8d46d1ee9fc0018ea0b316f68434ba2d98` (the round-3 reviewed Head through current Head)
- Head: `85232a8d46d1ee9fc0018ea0b316f68434ba2d98` (the reviewed range is committed; `round-start` left generated analytics/workflow changes dirty outside the explicit range)
- Reviewable lines: 283
- Agents spawned:
  - `asm-review-logic` — D9 fold and model-finalization flow — `gpt-5.6-sol[1M]`
  - `asm-review-contracts` — ProvisionModel contender and favoured contracts — `gpt-5.6-terra[1M]`
  - `asm-review-logic` — closed identity import boundary — `sonnet[1M]`
  - `asm-review-reuse` — helper relocation and one-owner cohesion — `gpt-5.6-luna[1M]`
  - `asm-finder` — provisioning identity callers, consumers, and filesystem-capable boundaries — context trace
- Agents skipped:
  - `asm-review-data-security` — no auth, secrets, persistence, public API, or changed filesystem authorization path; containment was traced by the chair
  - `asm-review-frontend` — no production UI source changed; the existing contender consumers were traced by the chair
  - `asm-review-performance` — entries remain structurally capped at 200, and folding/grouping is linear in that cap
- Verdict: WARN
- Counts: 0 BLOCK, 1 WARN, 0 SUGGEST open; 5 prior findings fixed
- Split over gating blockers: 0 feature / 0 machinery
- Verify evidence: `bun run asm change verify-status merge-only-the-declarations-proven-to-be-one` records tasks 5_1, 5_2, and 5_3 at exit 0, including RED witnesses and the full unit/type/lint gate. Review ran no project verify command or test suite.

## Findings

### F001

- ID: F001
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:354`
- Title: The generous detector still misses common-filesystem Unicode folds
- Evidence: Fixed. `foldSegment` now implements D9's per-segment `NFKC -> toLowerCase -> foldWin32Name -> toUpperCase -> NFKC` key. The range gate checks every case-varying code point below `U+30000` against its lowercase and uppercase forms; direct witnesses cover sigma/final sigma, sharp-s expansion, ypogegrammeni expansion, compatibility ligatures, and Win32 non-final segments. The lower-before-upper and final-normalization stages have independent load-bearing witnesses.
- Impact: None remaining for the accepted D9 relation. The prior sigma/final-sigma and ypogegrammeni false negatives now share keys without changing merge/exclusion identity.
- SuggestedFix: None.
- Status: fixed
- Triage: The same invariant inventory was rechecked: normalization-only merge/exclusion; per-segment Unicode and Win32 advisory folding; native assembly; framework winner and provider switch; direct exported reader; offer reminting; UI consumption. The fold is no longer a curated expansion list, and no contender consumer merges, drops, reorders, or rewrites a declaration.

### F002

- ID: F002
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:327`
- Title: Standalone and switched framework offers never compute contenders
- Evidence: Remains fixed. Every adapter model now receives contenders in `modelFromDraft`; the non-native dispatcher branch preserves that completed model while replacing only `providers`.
- Impact: None remaining across initial framework selection or provider switches.
- SuggestedFix: None.
- Status: fixed
- Triage: Framework initial selection and provider-switch paths were traced through adapter assembly, dispatcher return, offer reminting, and UI consumption.

### F003

- ID: F003
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts` and `asm-review-logic`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/offerStore.ts:91`
- Title: Adapter-local id collisions collapse contender membership during reminting
- Evidence: Remains fixed. One `ProviderBudget.nextId` sequence spans a dispatcher read, and `offerStore.remint` translates every contender member and favoured id through the completed entry-id map.
- Impact: None remaining on native-plus-base, framework, switch, or offer-redemption paths.
- SuggestedFix: None.
- Status: fixed
- Triage: Shared-read id uniqueness and reminting were unchanged by this range and remain compatible with model-level finalization.

### F004

- ID: F004
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-frontend`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:448`
- Title: The summary calls every contender component a pair
- Evidence: Remains fixed. The unchanged consumer reports a single group's actual member count and describes multiple groups as sets.
- Impact: None remaining for two-, three-, or multi-group summaries.
- SuggestedFix: None.
- Status: fixed
- Triage: The chair traced the unchanged row and summary consumers to confirm the relocated producer preserves their member/id contract.

### F005

- ID: F005
- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: `chair`
- Class: machinery
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/oneOwner.test.ts:537`
- Title: The closed identity boundary still drops unresolved value edges
- Evidence: `boundaryOffenders` follows a reference only when it is a named local callable or a directly imported binding. Any other referenced value reaches `imported === undefined` and is silently ignored. That leaves several ordinary filesystem-helper shapes invisible. For `import * as probes from "./probes"; identityOf(){ return probes.realpathName(...); }`, `importsOf` records the namespace as exported `"*"`, the walk queues `probes.ts#*`, and lines 519-522 treat the missing callable as a harmless non-callable without inspecting `realpathName`. A default import similarly queues `#default`, which `callablesOf` does not index; a local alias such as `const probe = importedProbe` is neither a callable nor an import under the alias and is dropped at line 537; a named re-export barrel has the same stop. The new mutation witness proves only a direct named sibling import whose local/exported names resolve to one indexed function.
- Impact: Current production roots are clean, and direct named imports are now caught, but an ordinary namespace/default/barrel extraction or local callable alias can reintroduce a filesystem identity probe while the promised structural gate stays green. This is the same support-machinery risk as round-3 F005, not a production defect in the current roots.
- SuggestedFix: Resolve references with a TypeScript `Program` and checker so aliases, property accesses, defaults, re-exports, scopes, and callable-valued variables follow their actual symbols; alternatively reject every callable edge the current walker cannot resolve rather than treating it as inert. Add namespace/default/barrel/local-alias mutation witnesses against a sibling helper that reaches `node:fs`.
- Status: accepted
- Triage: Persists from round 3 under the same invariant and causal mechanism: a symbol-free, name-keyed walk stops at callable edges it cannot represent. Verified safe now: direct dep hooks; local function declarations, arrows/function expressions, and named methods; local named callable values; direct named sibling imports including named import aliases; explicitly pure `node:path`; and the current real roots. Still affected: namespace imports, default imports, re-export barrels, local aliases of imported callables, same-named/shadowed callables, and direct capability acquisition such as `require` that is not represented as an import. Support finding; non-gating by Phase 2.5.

### F006

- ID: F006
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-contracts`, corroborated by chair
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:421`
- Title: The exported direct Asimov model bypasses contender finalization
- Evidence: Fixed. `modelFromDraft` now computes `contendersOf(draft.entries)`, and `readAsimovProvisioning` reaches that assembly point on successful, empty, malformed, and unreadable-file model paths. Its direct-reader witness groups `MixedCase`/`mixedcase` and leaves `favoured` absent.
- Impact: None remaining. Direct and dispatcher-produced models now carry the same advisory contender relation.
- SuggestedFix: None.
- Status: fixed
- Triage: All model constructors were traced. Native cross-source assembly alone recomputes after merge/exclusion and supplies `NATIVE_PROVIDER_FILE`; single-adapter drafts correctly have no favoured source.

## Full-flow trace

- Initial native selection, with and without `extends`: one read budget spans native and base adapters; each adapter finalizes its own draft; merge/exclusion continue to use `identityOf` only; native assembly recomputes contenders from surviving rows and supplies the native declaring file as the favoured source; offer reminting translates group ids; UI reads paths back from entries; selected ids redeem against the host-held offer.
- Initial framework selection and provider switch: `modelFromDraft` finalizes contenders before the adapter returns; the dispatcher changes only `providers`; latest-wins/opening guards remain unchanged; offer reminting and UI consumption follow the same path as native.
- Direct `readAsimovProvisioning`: absent returns `emptyModel`; error, malformed, empty, and successful files return through `modelFromDraft`, with a provider row where appropriate and no fabricated favoured member.
- Containment remains independent: provider files and declared entry destinations may reach `realpath`/`lstat` to authorize reads and reject escapes, but filesystem answers do not participate in `identityOf`, merge/exclusion identity, or advisory folding. Grouping remains after accepted rows exist and never changes row path, source, mode, order, checked state, or availability.
- Empty/error paths carry empty contender arrays. Groups remain capped by the 200-row model budget and are constructed linearly.

## Adjudication notes

- The four specialists found no production logic, contract, reuse, performance, or UI regression in the reviewed range.
- The chair retained F005 because the logic specialist's checklist explicitly declined import-shape and test-vacuity correctness; direct code evidence shows the new boundary still silently terminates at multiple callable edge shapes.
- No audit-backlog, external-blocker, or user-granted accepted-risk entries exist.
