# Review round 4 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 2
- Mode: verification
- Scope: range `71784821..HEAD` — commits `0cfabaa8`, `1e4c335d`, and `124b6041`, reviewed using the change context. Head `124b60416851829ba1b1300a2d7c5e310b86ed17`.
- Authorization: bounded extension round accepted by `asm review round-start` under the standing user grant.
- Working tree: `asimov/changes/write-only-the-native-config-file/analytics.json` is modified and `asimov/changes/prove-entry-reconstruction-on-windows/analytics.json` is untracked; neither is part of the explicit reviewed range beyond committed telemetry.
- Scope lock: passed. The delta remediates round-3 findings, reconciles D7 with D16, assigns D16's descriptor-anchored writer to WT-012.19, and adds only the path-returning form of the existing containment walk. No new capability or invariant owner entered this cycle.
- Reviewable lines: 124 changed lines across 4 production files (98 additions, 26 deletions); 122 changed test lines reviewed inline. Change artifacts, telemetry, and project Markdown were context or skipped support surface.
- Verify gate: `bun run asm change verify-status write-only-the-native-config-file` records tasks `4_1` and `5_1` `[x] exit 0`; the caller records the final `verify-task` result as 7014/7014. Review did not re-run project verification.
- Targeted probe: a temporary real-filesystem repository used the recognized base `asimov/worktree.yaml` through a stable symlinked `asimov/` ancestor. The writer returned `{ ok: true, wrote: true }`; the D17 `lstat` resolved to the outside file. The temporary tree was removed in the same command.
- Agents spawned: 3 (data-security, logic, frontend) plus chair self-review. Contracts, performance, and reuse were skipped because the verification cone did not require separate lenses.
- Verdict: **BLOCK**
- Status: **blocked**
- Counts: 1 BLOCK · 0 WARN · 0 SUGGEST.

## Cross-round filter

| ID | Round 3 | Round 4 | Evidence |
|---|---|---|---|
| F014 | SUGGEST accepted | **fixed** | Every non-cached redraw now derives the shared button's disabled state from `pendingSave.has(draft.repoId)`; the same-offer early return preserves the state already set by the click. The repo-picker witness is discriminating. |
| F019 | WARN accepted | **fixed** | `writeNativeConfig` no longer resolves the directory separately and builds every `LockedFile` path from `authorizedPathInsideRoot`'s returned value. The old boolean predicate is a wrapper over the same branches. D7 withdrew the partial `mkdir`/`lstat` mechanism and D16 now names WT-012.19. The replacement test's two-hop fake is not faithful to stable native `realpath`, but the value-flow fix is established directly by the code and no production defect follows from that witness weakness. |
| F022 | WARN accepted | **fixed** | First creation passes `0o644 & ~umask` to `stageReplacement`, so its exact chmod cannot broaden the process policy; existing files still use their captured mode. The strict-mask witness distinguishes the fix. |
| F023 | SUGGEST accepted | **fixed** | A distinct switch answer evicts the switched-from offer's set after the state needed for the answer is captured. The old set has no reachable dialog consumer; omitting a behavioral witness for map-only retention is justified. |
| F025 | BLOCK accepted | **persists** | Exact filename membership closes traversal and unknown literal values, but a recognized adapter path still reaches raw `lstat` without resolved containment. A stable symlinked ancestor redirects that probe outside and the save succeeds although `baseFor` would reject the same source. |

## Findings

### F025 — A recognized base can still probe outside through a symlinked ancestor

- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-data-security + chair
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:466-470`
- Title: A recognized base can still probe outside through a symlinked ancestor
- Evidence: `FRAMEWORK_ORDER.some(...)` proves only that the untrusted `extends` string equals a known adapter filename. The following `deps.lstat(path.join(repoRoot, base))` follows symlinks in parent components. With `.vscode/worktree.json` declaring `asimov/worktree.yaml`, a stable `repo/asimov` symlink to an outside directory containing `worktree.yaml` made the writer return `{ ok: true, wrote: true }`, and the probe's resolved path was the outside file. `readProvisioning.ts:228-244` sends the same recognized name through `openProviderFile`, whose resolved-containment boundary rejects it. This is present before the call and does not depend on D16's parent-replacement race.
- Impact: Repository-controlled structure retains an outside-repository existence/error oracle for each recognized base spelling. The writer can also commit and report success under a base the next read rejects, violating D17's read/write agreement.
- SuggestedFix: After membership, authorize the known base through the read side's resolved containment and usable-file boundary before any presence probe—preferably a shared helper used by `baseFor`—and probe only the authorized path. Add a stable symlinked-ancestor witness asserting no outside probe and no write.
- Status: accepted · Triage: accepted. Confirmed by probe before fixing: with `repo/asimov` a symlink to an outside directory holding `worktree.yaml`, the writer returned `{ ok: true, wrote: true }` and its D17 probe resolved to the outside file. The round-3 fix checked the base as a NAME and stopped there; a name proves nothing about where it leads. The joined path now goes through the same resolved boundary the reader routes a base through — `authorizedPathInsideRoot`, which this change had already introduced for the destination — before the probe rather than after it, so an outside base is never asked about. Remediation: no `D#` moves, no invariant owner is minted, and the writer still spells no containment rule of its own (D2).
- Triage: Persists from round 3 under the same ID and severity. The remediation closed arbitrary literal traversal but not the same invariant's containment boundary for recognized names. Boundary inventory searched: lexical membership, resolved traversal, presence probe, reader/writer agreement, and write result. Affected: recognized base under a symlinked ancestor. Verified safe: unknown, absolute, and traversal-bearing strings are refused before the base probe; the native target directory itself is built from the authorized containment result; ordinary in-root adapter files retain their prior behavior.

## Verified sound

- `authorizedPathInsideRoot` preserves every old boolean verdict: each former `false` branch is `null`, the former success returns the same reconstructed/resolved `full`, and `isResolvedPathInsideRoot` maps that result back to boolean. All existing boolean consumers remain behind the unchanged wrapper.
- The ENOENT branch reconstructs the unresolved tail beneath the nearest resolved ancestor inside the prepared root. Passing that value to `LockedFile`'s recursive `mkdir` introduces no separate escape on a stable filesystem; identity-changing replacement remains D16/WT-012.19.
- The F019 replacement witness is discriminating for the injected dependency but is not an ordinary native symlink chain: native `realpath` follows the whole chain and is idempotent on its canonical answer while the filesystem is stable. This does not reopen F019 because the remediated value flow is correct independently of the witness story.
- F014's disabled state and F023's eviction preserve save-answer carry-forward and switch-answer reseeding. The switched-from set is not needed after a distinct switch answer, and the saved selection is held in its own copied set.
- The descriptor-anchored writer remains correctly separated as WT-012.19. The F025 witness is a pre-existing stable base-path symlink, not an adversarial replacement of the authorized destination directory, so D16 does not absorb it.
- The reported `extension.worktreeAssembly.test.ts` load flake is outside this cone, reproduces on clean HEAD, and remains a Knowledge candidate rather than a finding in this round.

## Sub-agents spawned

- asm-review-data-security: writer containment, base validation, D17 presence, and mode handling — `gpt-5.6-sol[1M]`
- asm-review-logic: shared containment extraction, ENOENT reconstruction, state/error paths, and witness fidelity — `gpt-5.6-terra[1M]`
- asm-review-frontend: pending save/switch redraw and selection eviction — `sonnet[1M]`
