# Review round 4 — find-env-files-the-workspace-declares

- Date: 2026-09-04
- Cycle: 2
- Mode: verification
- Master session id: `649500f6-d2af-47ae-ba3d-6351c690ebca`
- Head reviewed: `191fc07a2b48a82d4a3b0dfc2651bfdc190e77fa` (`review/find-env-files`)
- Diff scope: cumulative `git diff 25bba4a3fd218d326ff8c22f18279c82902799d0..review/find-env-files`; remediation delta `a7d22a461c5491ec273bd5c229e1f1e501eeb424..191fc07a2b48a82d4a3b0dfc2651bfdc190e77fa`
- Tree: the active checkout is on a different branch and its unrelated dirty state was excluded; only the named ref range was reviewed
- Scope lock: passed — the delta contains remediation in `suggestProvisioning.ts`, direct witnesses in its test, and persisted prior-round records; it introduces no new capability, contract, or invariant owner
- Reviewable lines: 77 added/modified remediation production lines; 70 added test lines reviewed inline. The cumulative explicit range contains 296 added/modified production lines.
- Agents spawned: 3 specialists
- Agents skipped: `asm-review-contracts`, `asm-review-frontend`, and `asm-review-reuse` — the verification cone is declaration control flow, path security, and budget behavior; no UI production, new contract, split, or reuse decision changed
- Verdict: **BLOCK**
- Counts: 2 BLOCK · 0 WARN · 0 SUGGEST open

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | manifest opening, candidate-byte boundary, resolved containment | security and refusal authority | `gpt-5.6-sol[1M]` |
| asm-review-logic | declaration states and path spelling classification | edge cases and control flow | `gpt-5.6-terra[1M]` |
| asm-review-performance | declaration and directory growth axes | bounded filesystem work | `sonnet[1M]` |
| chair | remediation delta plus cumulative behavioral cone | all applicable lenses and prior-witness verification | `gpt-5.6-sol[1M]` |

Verification evidence: `bun run asm change verify-status find-env-files-the-workspace-declares` reports both tasks at exit 0 with assertion additions and no inherited removals. The author additionally supplied clean typecheck, focused provisioning tests, the full 7,639-test unit run, and Biome evidence at this Head. The chair did not run a project verify command or suite; it used disposable direct probes against an archived `review/find-env-files` tree and removed each probe in the same command.

---

## Open findings

### [F002] Refusal still collapses into “nothing declared” on two higher-priority boundaries

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:121-135,146-159,179-183,223-232`
- Status: accepted; persists from round 3
- Triage: The scalar/object wrong-shape and non-record fixes close their quoted witnesses, but the accepted fail-closed invariant remains open. A disposable probe at the reviewed Head produced `apps/web/.env`, read `pnpm-workspace.yaml`, and listed `apps` for both (a) `package.json` with `workspaces: [1, null, {a: 1}]` and (b) a `package.json` proven by `openProviderFile` to resolve outside the checkout while a valid pnpm manifest remained inside.

**Invariant.** A present higher-priority declaration that this reader refuses to interpret must terminate workspace discovery. Only true absence, an absent declaration key, or an intentionally valid empty declaration may fall through.

**Boundary inventory.** Affected: a non-empty package array/object-form list whose accepted string set filters to `[]`; a proven-outside package provider file whose `openProviderFile.kind === "problem"` is mapped by `manifestText` to the same `undefined` as absence. Verified safe: JSONC syntax errors; unsupported scalar/object `workspaces`; top-level package non-records; absent `workspaces`; valid `workspaces: []`; valid non-empty declarations; mixed lists retaining valid string members; final pnpm refusals, which have no lower authority. Prior-round intentional fallthrough for an absent or ordinarily unreadable manifest is not relitigated here.

**Evidence.** `patternsOf` returns `[]` for both a genuinely empty list and a non-empty all-invalid list, and `packageDeclaration` maps both to `none`. Separately, `manifestText` returns `undefined` for every non-text `openProviderFile` result, so a proven containment refusal is again mapped to `none`. The new F002 witness covers scalar/object shapes only; the old all-invalid test has no pnpm manifest and remains vacuous for precedence. The round-3 boundary inventory explicitly named all-invalid arrays as affected.

**Impact.** A lower-priority manifest still gains authority after the primary manifest was refused, causing workspace `readdir`, fixed-name `lstat` probes, and environment-file suggestions that the accepted D1 decision requires the reader to suppress.

**Suggested fix.** Make manifest opening and pattern parsing a total declaration-state classifier. Preserve `absent` separately from provider-file refusal; preserve a genuinely empty valid list separately from a non-empty list with no accepted members. Add a table-driven witness matrix for package array/object forms and pnpm forms, with a valid lower-priority pnpm manifest wherever precedence is the property under test.

This invariant has expanded from syntax errors in round 1, to unsupported shapes in round 3, to filtered-empty and provider-file-refusal boundaries in round 4. Patch-level case fixing has failed; hand this classifier back to planning as one exhaustive state table before another implementation attempt. No new invariant owner has been introduced, so extraction into a separate change is not required.


**Status:** accepted
**Triage:** Verified against the source, not taken on report. `packageDeclaration` ends `return patterns.length > 0 ? { kind: "declared", patterns } : { kind: "none" };` (`suggestProvisioning.ts:180`), so `workspaces: [1, null, {}]` — which `patternsOf` filters to `[]` — is indistinguishable from `workspaces: []`, and only the second may legitimately fall through. `manifestText` (`:145-152`) is the second boundary: `opened.kind === "text" ? opened.text : undefined` gives a containment refusal the same answer as an absent file.

**This is the third fix attempt on one invariant** (round 1, round 3, round 4), and each attempt closed the boundary the previous round named while leaving the invariant itself unowned. That is the thrash-stop condition, and the chair reaches the same conclusion independently. Not fixed here: handed back to `asimov-plan` for an exhaustive declaration-state classifier with a state/witness matrix, per the review fix loop's option 1.

### [F007] Drive-qualified absolute globs are still reinterpreted on POSIX hosts

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:277-289`
- Status: accepted; persists from round 3
- Triage: Leading-slash absolute spellings now close, but the cross-platform absolute-spelling boundary remains open. On macOS/Linux, a disposable probe with `workspaces: ["C:/apps/*"]` read the repo-local directory `C:/apps`, performed the workspace scan, and emitted `C:/apps/web/.env`.

**Invariant.** An absolute or otherwise unsupported spelling must be refused before glob splitting; it must never be reinterpreted as a different repo-relative pattern.

**Boundary inventory.** Affected: drive-qualified forward-slash and backslash spellings such as `C:/apps/*` and `C:\\apps\\*` when the repository is opened on a POSIX host. Verified safe: `/*`, `/etc/*`, `//*`, relative `*`, `../*`, `apps/../*`, unsupported `apps/*/../..`, and stable outside-resolving workspace-directory symlinks.

**Evidence.** Backslashes are normalized into `/`, but `path.isAbsolute(raw)` applies only the host platform's semantics. On POSIX, neither `C:/apps/*` nor `C:\\apps\\*` is absolute, and the normalized pattern does not start with `/`; `splitGlob` accepts it and `path.resolve(repoRoot, "C:/apps")` turns it into a repo-local path. The added F007 witness covers only leading-slash forms.

**Impact.** The result remains host-dependent and generous: a manifest spelling an absolute path is executed as a different relative declaration, contrary to D2 and the explicit refuse-not-clamp obligation. Although resolved containment prevents this case from escaping the checkout, it still scans and offers files from a directory the manifest did not declare as repo-relative.

**Suggested fix.** Classify absolute syntax independently of the host OS before `splitGlob`, including POSIX roots, UNC roots, and drive-qualified roots after slash normalization (for example with explicit POSIX and Windows path semantics). Add `C:/apps/*` and `C:\\apps\\*` witnesses that assert no `readdir` and no workspace candidate probes.


**Status:** accepted
**Triage:** Correct, and the mechanism is exactly as reported: the round-3 guard is `pattern.startsWith("/") || path.isAbsolute(raw)`, and on a POSIX host `path.isAbsolute("C:/apps/*")` is `false`. The pattern survives to `splitGlob` and is executed as the repository-relative declaration `<repo>/C:/apps`. Containment holds — nothing escapes — but the accepted contract is refuse, not reinterpret, and a Windows-authored manifest reviewed on macOS is an ordinary case rather than a hostile one.

Not fixed here: absolute-syntax classification is one of the states the handed-back classifier owns, and splitting it into a separate point fix is what produced three rounds of the same finding.

## Prior finding dispositions

### [F001] Workspace manifests bypass resolved containment before reading bytes

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security + asm-review-reuse
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:146-153`
- Status: fixed
- Triage: `openProviderFile` still authorizes both manifest paths before `readFile`. The round-4 outside-provider probe read no package bytes. F002 concerns loss of the refusal classification afterward, not an external byte read.
- Evidence: candidate secret reads remain impossible through the changed detector: direct probes recorded only `package.json`/`pnpm-workspace.yaml` in `readFile`, while root and nested `.env` candidates were decided by fixed `lstat` calls.
- Impact: closed for the byte-read invariant.
- SuggestedFix: none.

### [F003] A missing or unreadable glob directory discards the fallback offer

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:313-321`
- Status: fixed
- Triage: Per-pattern enumeration remains inside the awaited catch; no remediation weakened the round-1 synchronous or asynchronous failure boundary.
- Evidence: the cumulative implementation still preserves independent root and setup rows when one workspace listing rejects.
- Impact: closed.
- SuggestedFix: none.

### [F004] Refused declarations perform filesystem work without spending the scan budget

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-performance + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:262-275,300-315`
- Status: fixed
- Triage: Filesystem-costing literal and glob-parent paths remain charged before containment; the outer loop remains gated. Pure syntax refusals perform no filesystem work and are structurally bounded by manifest bytes.
- Evidence: the performance review found `budget.scanned <= MAX_SCAN`, accepted workspace directories `<= MAX_SCAN`, fixed workspace candidate probes `<= 7 * MAX_SCAN`, and model rows `<= MAX_MODEL_ROWS`.
- Impact: closed.
- SuggestedFix: none.

### [F005] A supported root-level `*` workspace pattern can never match

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-logic + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:295-315`
- Status: fixed
- Triage: The root-glob exemption remains limited to relative root globs; a direct probe and the carried witness still find root packages. F007 is the surviving absolute-syntax classification boundary.
- Evidence: relative `*` continues through the authorized root listing while leading-slash forms stop before `splitGlob`.
- Impact: closed for valid relative root globs.
- SuggestedFix: none.

### [F006] A top-level JSON `null` aborts all fallback suggestions

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:105-110,169-183`
- Status: fixed
- Triage: `recordOf` refuses null, scalar, string, and array package roots before dereference. A direct round-4 probe with `package.json: null`, root `.env`, root `pnpm-lock.yaml`, and a valid lower pnpm manifest returned the independent root copy and setup rows, read only `package.json`, and performed no workspace listing.
- Evidence: no non-record result reaches `.workspaces`; refusal is terminal in this boundary.
- Impact: closed — no throw and no whole-offer loss.
- SuggestedFix: none.

### [F008] The final parent-budget charge can still trigger an eager directory read

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-performance + asm-review-logic
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:300-315`
- Status: fixed
- Triage: The post-parent `scanExhausted` guard executes before `deps.readdir` is invoked. A direct probe starting at `MAX_SCAN - 1` ended at `MAX_SCAN` with no listing and no workspace candidate stat.
- Evidence: the ordering protects both Promise-backed eager arrays and lazy AsyncIterables because the dependency call itself is skipped.
- Impact: closed.
- SuggestedFix: none.

## Verification summary

- **Refusal order:** still blocked by F002 on filtered-empty lists and proven-outside provider-file refusal.
- **Candidate secret bytes:** safe; only the two manifest constants can reach `readFile` in this detector.
- **Resolved containment:** `..` traversal, unsupported mid-path globs, and stable outside symlinked workspace directories remain refused before candidate probes. F007 is reinterpretation inside the checkout, not an outside-containment bypass.
- **Budgets:** F008 closes; filesystem work remains bounded by the shared scan account and rows by the existing model cap.
- **Witness integrity:** F006 and F008 witnesses are live. F002 and F007 were narrowed to quoted examples and do not cover the prior invariant inventories, leaving both accepted blockers open.
