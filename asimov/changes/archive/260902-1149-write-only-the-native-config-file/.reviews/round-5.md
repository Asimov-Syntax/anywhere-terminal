# Review round 5 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 2
- Mode: verification
- Review lane: fastlane
- Scope: range `124b6041..HEAD` — the single round-4 remediation commit `5184b613`, reviewed using the change context. Head `5184b613b912bfa828517bc9286cfa9964dfa1d6`.
- Working tree: `asimov/changes/write-only-the-native-config-file/analytics.json` is modified and `asimov/changes/prove-entry-reconstruction-on-windows/analytics.json` is untracked; neither is part of the explicit reviewed range.
- Scope lock: passed. The delta is only F025 remediation, its witness, and review/task telemetry; it adds no capability, changed contract, or invariant owner.
- Reviewable lines: 16 changed production lines (15 additions, 1 deletion); 30 added test lines reviewed inline. Change artifacts and telemetry were context or skipped support surface.
- Verify gate: `bun run asm change verify-status write-only-the-native-config-file` records task `6_1` `[x] exit 0`; the caller records the final `verify-task` result as 7014/7014. Review did not re-run project verification.
- Targeted probe: a temporary repository used a recognized, contained `asimov/worktree.yaml` of `MAX_PROVIDER_BYTES + 1`. The writer returned `{ ok: true, wrote: true }`; the immediate production read rejected the named base as `unreadable` with `EFBIG`. The temporary tree was removed in the same command.
- Agents spawned: 3 (data-security, logic, reuse) plus chair self-review. Contracts, frontend, and performance were skipped because the verification cone did not require separate lenses.
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 0 WARN · 0 SUGGEST.

## Cross-round filter

| ID | Round 4 | Round 5 | Evidence |
|---|---|---|---|
| F014 | fixed | **fixed** | `WorktreeCreateDialog.ts` is untouched; pending-save disabled-state derivation did not regress. |
| F019 | fixed | **fixed** | Destination construction is untouched: `target`, and therefore every `LockedFile` lock and temporary path, still derives from the value returned by `authorizedPathInsideRoot`. |
| F022 | fixed | **fixed** | The masked first-create mode is untouched. |
| F023 | fixed | **fixed** | `WorktreeCreateDialog.ts` is untouched; switched-from selection eviction did not regress. |
| F025 | accepted | **persists** | The stable outside-ancestor witness is closed, but the writer still substitutes containment plus `lstat` for the reader's exact-name, containment, and bounded readable-file open. A contained oversized base makes the writer succeed and the next read reject it. |

## Findings

### F025 — Existence-only validation still admits a base the reader rejects

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-data-security + asm-review-logic + asm-review-reuse
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:479-486`
- Title: Existence-only validation still admits a base the reader rejects
- Evidence: Commit `5184b613` correctly closes the stable outside-repository symlink witness: exact membership is followed by `authorizedPathInsideRoot` before any `lstat`. It does not, however, reuse the reader's complete base decision. `baseFor` at `readProvisioning.ts:228-245` requires `openProviderFile` to return `kind: "text"`; `openProviderFile` at `providerKit.ts:668-699` performs containment and then the production bounded read. The writer instead treats any successful `lstat` as sufficient. A targeted real-filesystem probe supplied a recognized, contained `asimov/worktree.yaml` of `MAX_PROVIDER_BYTES + 1`: `writeNativeConfig` returned `{ ok: true, wrote: true }`, while the immediate `readProvisioning(createProvisioningDeps(), root)` reported that same base `unreadable` with `EFBIG`. A directory, permission-denied file, FIFO, or other present-but-unreadable target has the same mismatch.
- Impact: The save can report success and persist an `extends` base that the next read cannot honor, which is the reader/writer disagreement D17 exists to prevent. This is the fourth partial boundary under the same invariant, not a new independent defect: the writer has progressed from omitted declared-base probe, to unvalidated probe, to name-only validation, to name-plus-containment-plus-existence while still omitting reader-equivalent usability.
- SuggestedFix: Stop rebuilding base eligibility from separate primitives. Share one operation with `baseFor` that performs exact adapter membership, resolved containment, and the same bounded readable-file open, and require its text result inside the lock immediately before writing. Extend the writer's production dependencies to supply that reader-owned capability rather than replacing the read with `lstat`; checking only `isFile()` would still miss permission and size-limit failures. Because the inventory has expanded for three consecutive remediation rounds, hand this back to planning as a single shared base-authorization obligation rather than another patch-level predicate.
- Status: accepted · Triage: accepted, and NOT fixed here — this is the artifact handback. The chair's inventory is right and it is the decisive fact: four rounds, four partial reconstructions of one check the reader already owns whole. `baseFor` in `readProvisioning.ts` performs exact-name membership, resolved containment AND the bounded readable open in one operation; the writer has now rebuilt the first two of those three and disagreed with the reader on the third. Patching the third would be the fifth partial. The fix is that the writer stops having a base-eligibility rule at all and calls the reader's — but `baseFor` takes `ProviderDeps` (`readFile`, `readdir`) and a budget, none of which `NativeConfigDeps` carries, so this changes D17's mechanism and the writer's dependency surface. That is a `D#` change, which puts it past the remediation boundary.
- Triage: Persists from round 4 under the same ID and severity. The stable outside-ancestor boundary is fixed, but reader/writer agreement remains affected through the same partial-reimplementation mechanism. Boundary inventory searched: exact-name membership, resolved traversal, authorized-value use, existence/type, bounded readability, repository-root preparation, native destination, `LockedFile` target/lock/temporary derivation, injected dependency paths, immediate reread, and error mapping. Affected: contained bases that exist but the production reader cannot return as text. Verified safe: unknown/absolute/traversal names are refused before probing; stable outside-resolving bases are refused before probing; `repoRoot` is prepared once; `NATIVE_PROVIDER_FILE`, the lock, and temporary paths all derive from the authorized destination; using the original base spelling after containment is equivalent on a stable filesystem, while identity-changing replacement remains the accepted D16/WT-012.19 boundary.

## Verified sound

- The new symlinked-ancestor witness is discriminating for round 4's exact failure and the production fix closes it before an outside `lstat`.
- No other stable joined-then-used escape remains in the writer's path inventory. The destination consumes the path returned by authorization; `LockedFile` derives all lock and temporary paths from that target; `NATIVE_PROVIDER_FILE` and adapter filenames are repository constants; injected dependencies are seams, not production path authorities.
- Discarding the returned authorized base path and probing the original spelling does not create a separate supported-state defect: on a stable filesystem `lstat` follows the same ancestor chain. A mismatch requires identity replacement after authorization and remains in D16/WT-012.19's delegated adversarial boundary.
- F014, F019, F022, and F023 did not regress. Their implementations are untouched by the one-commit delta, and F019's destination-value flow remains intact.
- The reported `extension.worktreeAssembly.test.ts` load flake is outside this cone and is not a finding.

## Sub-agents spawned

- asm-review-data-security: complete filesystem path inventory and base authorization — `gpt-5.6-sol[1M]`
- asm-review-logic: D17 read/write agreement, error paths, and prior-finding regression — `gpt-5.6-terra[1M]`
- asm-review-reuse: reader-owned base eligibility versus writer reimplementation — `sonnet[1M]`
