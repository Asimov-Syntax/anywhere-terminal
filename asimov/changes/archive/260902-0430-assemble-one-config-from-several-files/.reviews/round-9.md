# Review Round 9

- Date: 2026-09-02
- Cycle: 6
- Round: 9
- Mode: discovery
- Arbiter: no
- Review profile: fastlane
- Escalation flags: `new-api-contract`, `user-visible-ui`, `security-privacy`, `re-review`
- Scope: selected change-owned implementation commits `28084468`, `9f15d286`, and `c03f0aa9` from the requested range `f995fb7ef86605a21900125fe78112c0fa65d4de..HEAD`, reviewed in their final current-tree state. The plan commits carrying D12-D14 and the final verify-gate commit were context, not code scope. Commits owned by archived sibling `award-a-contested-destination-or-refuse-it` were excluded except for the shipped contender/apply seam this change depends on.
- Head: `f29a5867fc902d7c2bb48c6c6bd795a0c7b69def` (working tree dirty only in generated analytics files; review content came from committed source)
- Reviewable lines: 111 production-code lines; tests and change artifacts classified separately
- Agents spawned:
  - `asm-review-data-security` — JSONC parse-tree materialization, recovery equivalence, and prototype safety — `gpt-5.6-sol[1M]`
  - `asm-review-logic` — `extends` outcome classification and failure-path preservation — `gpt-5.6-terra[1M]`
  - `asm-review-contracts` — D12-D14 contracts and archived sibling integration seam — `sonnet[1M]`
  - `asm-review-reuse` — shared JSONC helper ownership and existing-capability search — `gpt-5.6-luna[1M]`
- Agents skipped:
  - `asm-review-frontend` — no scoped production UI change; the current model/remint/selection boundary was traced under contracts
  - `asm-review-performance` — no new growth axis or hot-path recomputation; provisioning rows remain structurally capped and task 8_3 is witness-only
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports tasks 1_1 through 8_3 exit 0. `workflow.md` records check-types clean, the Biome 3/14/1 baseline, I10 gate clean, shipped-bundle gate clean, and the full unit gate after the handback. Review did not rerun project verification commands.
- Chair probes:
  - Differential scratch probe compared `parse()` with `parseTree()` + `getNodeValue()` over 50,017 deterministic valid/malformed JSONC inputs. Error arrays and canonical recovered values had zero differences outside the intended `__proto__` ownership/prototype change.
  - Installed `jsonc-parser@3.3.1` was inspected: `parse()` and `parseTree()` share `visit()`, and `getNodeValue()` guards missing property value nodes and constructs every object depth with `Object.create(null)`.
  - `git diff --check 7ea05276..c03f0aa9` was clean; changed tests add no `.only` or `.skip`.
- Verdict: APPROVE
- Counts: BLOCK 0 | WARN 0 | SUGGEST 0
- Blocking split: 0 feature | 0 machinery
- Audit backlog: none
- Accepted risk: none

## Findings

No surviving findings.

## Prior finding dispositions

### F012

- ID: F012
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: `asm-review-data-security`, chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/providerKit.ts:184`
- title: A JSONC `__proto__` member supplied values without becoming a reported key
- evidence: `readJsonc` now uses `parseTree` plus `getNodeValue`; the installed dependency materializes every object node onto a null-prototype object and skips a property with no value node. Both JSONC providers use the helper. Native witnesses prove hidden `extends`, `exclude`, and setup values are not consumed and the member is reported; the tasks witness proves hidden `tasks` is not consumed.
- impact: The round-7/8 prototype-chain consumption mechanism is closed without changing malformed-file recovery.
- suggestedFix: none
- status: fixed
- triage: Fixed by task 8_1. Chair differential evidence found no error-count or recovered-value divergence outside the intended dangerous-member behavior.

### F014

- ID: F014
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: chair, `asm-review-logic`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:121`
- title: A present unreadable `extends` source was diagnosed as missing
- evidence: `BaseResolution` now distinguishes `missing` from a file-level `unreadable` problem. `assemble` carries the original problem through `report`; unmatched, absent, file-level containment `malformed`, and root-level failure remain on the accepted `missingExtends` path.
- impact: The reported diagnosis now names the read failure while native inline material, file attribution, budget accounting, and provider behavior remain intact.
- suggestedFix: none
- status: fixed
- triage: Fixed by task 8_2. The moved and deliberately unmoved outcome classes are separately witnessed.

### F015

- ID: F015
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, `asm-review-logic`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:71`
- title: Multiple native contenders erased native precedence and let inherited material win
- evidence: The archived dependency now carries every repository-owned member in `ProvisionContenders.natives`; apply recomputes the selected group and refuses it entire when more than one native remains. The dependency's round 8 recorded zero blockers and the change is archived. D14's current producer computes the group from `kept` rows and its remint witness preserves both `members` and `natives` cardinality.
- impact: No inherited member can regain the ordinary pass merely because multiple repository declarations claim priority.
- suggestedFix: none
- status: fixed
- triage: Closed by the shipped `award-a-contested-destination-or-refuse-it` owner; this round verified the integration seam rather than re-reviewing that archived change.

### F016

- ID: F016
- severity: BLOCK
- confidence: HIGH
- priority: P2
- agent: chair, `asm-review-logic`
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/applyProvisioning.ts:174`
- title: A held member's own admission refusal vetoed an admissible native winner
- evidence: The archived dependency distinguishes a member-level `refused` result that observed no destination from `inadmissible`; the former is answered independently and does not make `contended()` refuse an admissible favoured member. D14's producer preserves the group and native provenance needed for that decision.
- impact: A held member's own name/mode rule no longer prevents the repository-owned admissible member from claiming a destination proven free.
- suggestedFix: none
- status: fixed
- triage: Closed by the shipped dependency; current read/offer/apply composition preserves the required facts.

- F001-F006: fixed — remain closed in the current integration seam.
- F007: rejected — reserved non-finding ID; not reused.
- F008-F011: fixed — remain closed; the scoped diff does not reintroduce identity filesystem I/O or the prior authorization gaps.
- F013: fixed — merge/exclusion identity remains lexical; folding only groups without discarding declarations.

## Risk map and full-flow trace

- **JSONC trust boundary:** `readProvisioning` enters through `nativeAdapter` or `vscodeTasksAdapter`; `openProviderFile` prepares/resolves the repository root, proves containment, and reads the authorized file. `readJsonc` produces null-prototype mappings at every depth. Native parse errors are reported while recoverable siblings continue; tasks parse errors retain their prior fail-file behavior. Ordinary property lookup can no longer reach a member hidden through a changed prototype.
- **Extended-source outcome:** native `extends` is translated by `baseFor` into successful authorized bytes, missing/unmatched, or file-level unreadable. Only successful authorization reaches the base adapter; unreadable keeps the original file problem and native inline rows; containment refusal and root failure preserve D2/D8 behavior.
- **Assembly and grouping:** base/native rows are capped at append time, merged lexically, filtered by `exclude`, then `contendersOf(kept, NATIVE_PROVIDER_FILE)` computes group membership and repository provenance. No group can name a superseded or excluded row.
- **Offer hot path:** `offerStore.issue` remints every entry id and translates both group lists through the same map. The new witness counts list sizes, so silent shrink is observable.
- **Selection and authority:** the webview receives the reminted model and submits only offer id plus selected opaque item ids. The host looks up the exact surface/repository offer and filters its own stored entries; no path or command from the webview becomes authority.
- **Apply and output:** the archived sibling recomputes contests from selected entries, handles zero/one/multiple selected natives under its shipped rules, and emits structured per-entry results plus contest membership. This scoped change supplies only the post-merge membership/provenance seam it requires.

## Adjudication notes

- All four specialists returned no findings. The chair's independent parser differential and full-flow trace agreed.
- F012 and F014 are closed by the scoped implementation commits. F015 and F016 are closed by the archived dependency and the current integration seam.
- No audit-backlog item, accepted risk, or external blocker remains.
- No agent message was treated as user approval or risk acceptance.
