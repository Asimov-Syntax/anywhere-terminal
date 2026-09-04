# Review round 5 — find-env-files-the-workspace-declares

- Date: 2026-09-04
- Cycle: 3
- Mode: verification
- Head reviewed: `73da233a054dafe5cab7a9312dafb675a62cfe0c`
- Diff scope: remediation commit `73da233a`, restricted by the caller to `src/worktree/provisioning/**`; cumulative behavior checked over `25bba4a3..73da233a` in that subtree
- Tree: active checkout Head is `dc96853c57ab350e905730b9c1d047ef39019e6f`; later picker commits do not touch `src/worktree/provisioning/**`; the unrelated dirty `asimov/changes/choose-the-destination-with-the-system-picker/analytics.json` was excluded
- Scope lock: passed — the reviewed delta implements the accepted D6/D7 remediation in the existing declaration owner and introduces no new capability or invariant owner inside the scoped subtree
- Reviewable lines: 86 added production lines; 150 added test lines reviewed inline
- Agents spawned: 3 specialists
- Agents skipped: `asm-review-contracts`, `asm-review-frontend`, and `asm-review-performance` — the cone is declaration control flow, filesystem refusal authority, path spelling, and direct witnesses; no route/schema/UI or budget implementation changed
- Verdict: **WARN**
- Counts: 0 BLOCK · 1 WARN · 0 SUGGEST open

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | manifest opening, precedence refusal, raw path boundary | filesystem security and fail-closed authority | `gpt-5.6-sol[1M]` |
| asm-review-logic | five-state classifier, raw-spelling order, witness matrix | control flow and edge cases | `gpt-5.6-terra[1M]` |
| asm-review-reuse | classifier/path guard and local fixtures | reuse and duplication | `sonnet[1M]` |
| chair | fix delta plus cumulative provisioning cone | all applicable lenses and prior-finding verification | `gpt-5.6-sol[1M]` |

Verification evidence: `bun run asm change verify-status find-env-files-the-workspace-declares` exits 0 with tasks 1_1, 2_1, and 3_1 stamped. The accepted workflow records the clean Verify Gate at `67d48740`: 7690/7690 tests, clean type check, green bundle and I10 gates, and the same 18 Biome diagnostics as the detached base. The chair did not run a project test, type-check, or lint command.

The author's pre-fix matrix claim was checked independently by source-level replay against `d85a156b`: the old code falls through for the all-invalid list, the all-empty-string list, and the containment-refused package manifest, and reinterprets the two drive-qualified spellings; the other added cases follow the old code's intended branches. That is exactly five failing cases. It was not re-run as a test suite under review policy.

---

## Open findings

### [F009] Absolute-spelling witness does not prove candidate probes are absent

- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.test.ts:567-576`
- Status: accepted
- Triage: The production guard is correctly ordered and F007 is fixed, but the D7 witness required by the accepted ledger is incomplete. The matrix proves an empty offer and no `readdir`; it does not inspect `statted`, so it cannot detect a future path that probes a refused spelling with `lstat` and then emits nothing.
- Evidence: `root()` records every `lstat` in `statted`, but the absolute-spelling cases destructure only `{ deps, listed }` and assert only `model.entries === []` and `listed === []`. The caller explicitly required both no directory read and no candidate `lstat` for POSIX, backslash/UNC, and drive-qualified spellings.
- Impact: A regression could inspect candidate environment paths derived from an absolute spelling without offering a row or enumerating a directory, and this security/privacy witness would remain green.
- SuggestedFix: Destructure `statted` and assert that no workspace-candidate path was probed, excluding the unchanged fixed root environment/lockfile probes. Keep the existing forward-slash, backslash, UNC, and drive-qualified cases.

## Prior finding dispositions

### [F002] Refusal state no longer falls through to a lower-priority declaration

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:105-255`
- Status: fixed
- Triage: `manifestBytes` preserves `openProviderFile.kind === "absent"` separately and maps every problem to `refused`; `patternsOf` distinguishes a valid empty list from a non-empty list with no surviving strings; `endsDiscovery` is exhaustive and only `absent`/`empty` fall through. Every package precedence witness supplies a valid pnpm manifest and terminal package states assert that it was not read.
- Evidence: The affected round-4 boundaries now classify as `unsupported` (all-invalid/all-empty lists) or `refused` (containment/open failure) and terminate before `pnpmDeclaration`. Safe boundaries remain: absent file/key and valid empty declarations fall through; declared and mixed-valid lists retain their patterns; parse errors, wrong shapes, and non-record package roots terminate.
- Impact: closed — a lower-priority pnpm manifest no longer gains authority after the package manifest is refused.
- SuggestedFix: none.

### [F007] Absolute spellings are refused from raw syntax on every host

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:91-92,296-316`
- Status: fixed
- Triage: `ABSOLUTE_SPELLING` runs on `raw` before slash normalization and before `splitGlob`. It rejects POSIX roots, backslash-rooted/UNC syntax, and every drive-qualified `X:` spelling, including the POSIX-host counterexamples `C:/apps/*` and `C:\\apps\\*`; valid relative `*`, `apps/*`, and traversal spellings continue to the existing containment/budget machinery.
- Evidence: A direct classifier probe confirmed the guard accepts all named absolute categories while leaving `apps/*`, `*`, and `../*` to the existing logic. The fix changes no containment, directory charging, scan, row, or candidate-probing code. F009 concerns witness completeness, not the current production behavior.
- Impact: closed — absolute workspace spellings are no longer reinterpreted as repository-relative declarations.
- SuggestedFix: none beyond F009's witness hardening.

### Carried fixed dispositions

| ID | Status | Verification |
|---|---|---|
| F001 | fixed | Manifest bytes still pass through `openProviderFile`; no candidate environment file reaches `readFile`. |
| F003 | fixed | Per-pattern `readdir` failures remain caught without discarding root/setup rows. |
| F004 | fixed | Literal and glob directory work still uses the shared `ProviderBudget`; the remediation did not change charging. |
| F005 | fixed | Valid relative root `*` still uses the root-glob exemption. |
| F006 | fixed | Non-record package roots terminate safely without throwing or suppressing independent root/setup rows. |
| F008 | fixed | The post-parent budget check still precedes the `readdir` dependency call. |

## Boundary verification

- Filenames probed: unchanged `SUGGESTED_ENV_FILES` and manager lockfile constants.
- Depth: unchanged root plus exactly one declared workspace-directory level; no recursive discovery.
- Budgets: no remediation changes to `MAX_SCAN`, `MAX_MODEL_ROWS`, charging, or model assembly.
- Row display/copy semantics: unchanged repo-relative `path`, `source`, and explanation.
- Provider precedence: unchanged; a present provisioning source still suppresses fallback in `readProvisioning`.
- Earlier witnesses: commit `73da233a` appends tests and does not edit or remove the round-1/round-3 witness bodies.

## Adjudication notes

The reuse specialist's duplicated `PKG`/`PNPM` fixture warning was dropped: the copies are tiny test-local readability fixtures, behaviorally equivalent, and the specialist's own checklist excludes such repetition absent a behavioral divergence. The vendored drive-letter helper was also not reported: it is unused application-wide, does not supply the whole D7 predicate, and importing it would create a new dependency on inert vendored internals.


---

## Triage (author)

### [F009] Absolute-spelling witness does not prove candidate probes are absent

**Status:** accepted
**Triage:** Verified rather than taken on report. The seven witnesses captured `listed` and asserted
it empty, but never read `statted` — and offering nothing is not the claim D7 makes. A regression that
probed candidates derived from a refused spelling would still offer nothing once containment refused
them, so it would have stayed green on both existing assertions while reading paths the manifest never
declared.

Fixed as task 3_2, test-only. Each witness now also asserts that nothing NESTED under the root was
statted — the root's own fixed names are probed either way and are the only paths directly under it,
so no exclusion list is needed and none can drift.

Non-vacuity, established two ways rather than asserted: the budget witness at
`suggestProvisioning.test.ts:264` already proves nested `statted` entries DO occur for honoured
patterns, so an empty `nested` is a real constraint; and disabling the `ABSOLUTE_SPELLING` guard in a
scratch edit fails 3 of these 7 cases, with the production file restored and verified clean afterwards.

## Round outcome

0 gating blockers. F002 and F007 — the two BLOCK findings that survived rounds 1, 3 and 4 and forced
the option-1 handback — are confirmed fixed by the D6/D7 classifier at `73da233a`. The one WARN is
fixed above. The cycle exits here.
