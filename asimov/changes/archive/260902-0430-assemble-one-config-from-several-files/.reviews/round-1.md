# Review Round 1

- Date: 2026-09-01
- Cycle: 1
- Round: 1
- Mode: discovery
- Review profile: fastlane
- Scope: range `386f65ff~1..HEAD`
- Head: `d1f85c8412fa60d8206acbe3d5b60fbe46b96e0c` (working tree dirty after review accounting updated `analytics.json`; review content was taken from the committed range)
- Reviewable lines: 710
- Escalation flags: `new-api-contract`, `user-visible-ui`
- Agents spawned:
  - asm-review-data-security — extends containment, exact-target authorization, and read consistency — gpt-5.6-sol[1M]
  - asm-review-logic — merge, exclusion, provider state, and shared-budget behavior — gpt-5.6-terra[1M]
  - asm-review-contracts — ProviderAdapter/AdapterRead and ProvisionModel contracts — sonnet[1M]
  - asm-review-performance — row/scan growth axes and shared structural bounds — gpt-5.6-terra[1M]
  - asm-review-frontend — excluded-row rendering, selection, counts, and accessibility — gpt-5.6-luna[1M]
  - asm-review-reuse — shared inline reader, containment, and path-identity ownership — gpt-5.6-luna[1M]
- Agents skipped: none
- Recorded verification: `bun run asm change verify-status assemble-one-config-from-several-files` reports every task exit 0, including the final 279-file / 6544-test unit run recorded in `workflow.md`. The review did not rerun project verification commands.
- Chair probes: targeted in-memory reads reproduced F001, F002, and F003; `git diff --check 386f65ff~1..HEAD` was clean.
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 1 | SUGGEST 0
- Blocking split: 3 feature | 0 machinery

## Findings

### F001

- ID: F001
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:134`
- title: Merge and exclusion key by raw spelling instead of filesystem destination
- evidence: `mergeEntries()` builds `inline` from raw `entry.path` strings and `applyExclude()` compares exclusions to those same strings. Accepted entries are later resolved with `path.resolve()` by `entryGate.ts`, so `node_modules`, `./node_modules`, and `a/../node_modules` can name one destination while remaining distinct here. A targeted read with inherited `./node_modules` plus native `node_modules`, and inherited `cache` plus exclude `./cache`, returned both node_modules rows, kept cache, and reported no problem.
- impact: The native declaration does not reliably win the path it shares. An inherited link can be offered and applied before the native copy for the same destination, and an apparently excluded destination can still be materialized through an equivalent spelling. The per-row source badges remain individually truthful while the assembled authorization is false about override/removal semantics.
- suggestedFix: Define one canonical repo-relative path identity at the provider boundary, using the same resolved destination semantics as admission, and use it for native/base dedupe, inline contradiction checks, and exclusion matching. Preserve the declaring `source` and, if needed, the original spelling only for diagnostics.
- status: accepted
- triage: CONFIRMED by probe, and worse than reported on the exclusion half: a native `copy` of `node_modules` beside an inherited `link` of `./node_modules` offered BOTH rows, and `exclude: ["./.cache"]` against an inherited `.cache` moved nothing — `excluded` came back empty with the row still offered. Accepted as remediation rather than a handback: the spec requirement already says "exactly one row SHALL be offered for that path", and a path is a destination on disk, not a spelling — the design under-specified the mechanism rather than deciding the other way. The fix derives a canonical identity for dedupe, exclusion and the D10 contradiction check ONLY; the displayed path and the `source` stay exactly as the file wrote them, because § 4.3 forbids rewriting either.
- invariant: Every accepted spelling that resolves to the same repository destination is one merge identity; native wins that identity and exclude removes that identity.
- boundary inventory:
  - affected: merge/dedupe; exclude matching; inline-versus-exclude contradiction detection
  - verified safe: provider-file containment rejects escapes; offer reminting does not alter paths; apply-time admission rechecks containment
  - not safe: apply-time resolution happens after the offer has already exposed two contradictory rows and cannot restore native-wins semantics

### F002

- ID: F002
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-logic
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/provisioning/readProvisioning.ts:196`
- title: The exact `extends` target is reopened after authorization
- evidence: `baseFor()` opens and authorizes the exact named file at line 118, discards that snapshot, and returns only its adapter. `assemble()` then calls `base.read()`, which opens the adapter files again. A targeted read where `.worktreeinclude` was readable for `baseFor()` but absent when `orcaAdapter.read()` ran still returned the setup command from `orca.yaml`, marked orca active, and emitted no `missingExtends` or unreadable problem. A disappearing single-file base similarly becomes an empty inheritance without the required diagnostic.
- impact: Exact-file membership is only a transient check, not the file the model is built from. A changing checkout can silently inherit from an unnamed sibling file or lose the named base while reporting neither failure, violating D2's exact-target authorization and the one-read consistency rationale behind `AdapterRead`.
- suggestedFix: Carry the already-opened named-file snapshot into the selected adapter's whole-adapter read. For orca, consume that snapshot for whichever of its two files was named and open only the other; derive active-provider and `missingExtends` state from that same read result.
- status: accepted
- triage: CONFIRMED by probe, and the report understates it: with `.worktreeinclude` named and vanishing after authorization, the model inherited `node_modules` AND a `pnpm install` setup step from `orca.yaml`, marked orca active, and reported ZERO problems — silently inheriting a file the user never named, which is precisely the defeater D2 rule 2 was written for, re-entering through a seam D2 did not cover. Accepted as remediation, NOT a handback: closing it does not need D1 to change. The dispatcher already owns which `ProviderDeps` it hands each adapter, so the authorized bytes are pinned into that `deps` for the named path alone; the sibling file is still read live, which is what D2 rule 3 requires.
- invariant: The exact framework file named by `extends` is authorized and consumed from one consistent snapshot; whole-adapter expansion cannot replace or omit that named snapshot silently.
- boundary inventory:
  - affected: exact-target presence check; adapter handoff; absence/error reporting; active-provider state
  - verified safe: framework-only membership rejects native self-extension and unrelated paths; every individual open performs resolved containment
  - not safe: the handoff between the authorized open and the adapter's second open

### F003

- ID: F003
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/any-terminal/create-worktree-harden/src/worktree/provisioning/nativeProvider.ts:106`
- title: A recoverable JSONC error discards every valid native key
- evidence: `jsonc-parser.parse()` returns both a partial value and parse errors for recoverable input, but any non-empty `errors` array immediately returns an empty draft before `extendsOf()`, `excludeOf()`, or `readInlineKeys()`. For `{"copy":[".env"],"exclude":,"setup":["echo ok"]}`, the installed parser returns `{ copy: [".env"], setup: ["echo ok"] }` plus one error; `nativeAdapter.read()` returns no entry and no setup step. This contradicts approved task 2_1 line 43, task 2_3 lines 66–71, and the accepted spec's requirement that malformed state be reported without discarding the rest of the file.
- impact: One damaged key can hide unrelated copy/link/setup/port declarations. The dialog says only that the file could not be read and omits material the parser successfully recovered, defeating the change's fail-partial contract.
- suggestedFix: Charge and report the JSONC parse error, but continue through a recovered mapping when `parsed` is an object. Return early only when no usable mapping exists; add a witness with a malformed middle key and valid keys before and after it.
- status: accepted
- triage: CONFIRMED: `jsonc-parser` returned `{copy: ['.env.local'], setup: ['pnpm i']}` alongside 1 error for a file with a damaged `exclude`, and this adapter discarded both recovered keys. The code comment asserting "there is no rest to keep: nothing was parsed" is simply false. This is a direct violation of the accepted spec requirement — "One unreadable part never discards the rest of a configuration" — so the fix is in-contract and the requirement is what defines it.

### F004

- ID: F004
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-frontend
- class: feature
- file:line: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/webview/worktree/WorktreeCreateDialog.ts:510`
- title: Excluded rows collapse into the checkbox grid column
- evidence: The changed excluded-row branch appends `top` and `meta` without the checkbox. The shared production rule in `src/webview/worktree/worktreePanel.css:1204` still defines `.wt-brow` as `13px minmax(0, 1fr)`, while only `.wt-brow-meta` explicitly selects column 2. Without the checkbox, `top` auto-places into the 13px column and `meta` occupies column 2 on the same grid row rather than the normal two-line content layout. JSDOM assertions verify text and selection but cannot observe this layout.
- impact: “Excluded”, “removed on purpose”, and the source badge can be cramped, overflow, or collide with the subject, undermining the required deliberate removal presentation.
- suggestedFix: Give `.wt-brow--excluded` an explicit one-column/content-column layout, or explicitly place both `top` and `meta` in the content column on separate rows.
- status: accepted
- triage: CONFIRMED: `.wt-brow` is `grid-template-columns: 13px minmax(0, 1fr)` and only `.wt-brow-meta` selects column 2, so an excluded row's `top` auto-places into the 13px checkbox column. Accepted despite being a WARN, because the row exists to make a removal legible and an illegible one fails its own purpose. `src/webview/worktree/worktreePanel.css` is this repository's file; the externally-owned design-pass files are `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css`, and neither is touched. Noted: jsdom cannot observe layout, so the witness here is the CSS rule itself, not a rendering assertion.

## Adjudication notes

- The contracts specialist proposed splitting the D10 declared-and-excluded contradiction from `unknownKey`. Rejected: approved D10 explicitly requires an `unknownKey`-class problem, and task 2_3's boundary forbids a new problem reason in this change.
- The performance and reuse specialists found no additional issues. The 200-row and 2000-name accounts remain structurally shared across native and inherited drafts.

## Author triage — round 1

All four accepted; none rebutted. Every finding was reproduced against the source before triage
rather than taken on the report's word, and two turned out to be worse than written (F001's
exclusion half, F002's missing diagnostic).

Remediation-boundary test applied to each: none needs a new or changed `D#` and none mints a new
invariant owner, so this is a fix round rather than an artifact handback. F002 was the close call —
threading the authorized snapshot through `ProviderAdapter.read` WOULD have changed D1, so it is
being closed the other way, by pinning the authorized bytes into the `deps` the dispatcher already
constructs for that read.

The out-of-band message from `asm-review-reuse` (no findings) matches the chair's adjudication note
for that specialist. Nothing was dropped between them.
