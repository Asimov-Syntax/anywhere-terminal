# Review round 7 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 4
- Mode: discovery
- Review lane: fastlane; escalation flags `security-privacy`, `re-review`; opened under the recorded user-approved continuation.
- Scope: range `cd338c63..HEAD`, reviewed at Head `29e75cf9d8ef4ef9a602c8455b60642f75a6707a`.
- Working tree: clean. Caller-excluded `asimov/changes/prove-entry-reconstruction-on-windows/analytics.json` as telemetry from another change. The archived dependency's artifacts were context; its settled helper internals were not re-litigated.
- Change context: Gate 2 is approved. This is cycle 4 discovery because round-6 F026 was closed by a handback to the independently planned, built, reviewed-to-APPROVE, and archived dependency `open-a-provider-file-without-waiting-on-it` (WT-012.20). This round scopes only the dependency's integration seam with the parent writer.
- Reviewable lines: 350 added/modified by the classifier: 86 TypeScript production lines and 264 Asimov build/analytics lines. The 324 changed test lines were reviewed inline. Ordinary Markdown/docs were skipped; the caller-excluded telemetry was not counted.
- Verify gate: `bun run asm change verify-status write-only-the-native-config-file` records task `7_1` `[x] exit 0`. The dependency archive records tasks `1_1`–`1_3` exit 0 and its own review APPROVE. This review did not re-run project verification.
- Agents spawned: 3 — logic, data-security, contracts — plus chair self-review and mandatory full-flow trace.
- Agents skipped: frontend (no changed UI or rendering path), performance (one bounded provider open and one target open; no changed growth axis), reuse (the helper's ownership and reuse were settled in the independently approved dependency).
- Verdict: **APPROVE**
- Counts: 0 BLOCK · 0 WARN · 1 SUGGEST.
- Split over gating blockers: 0 feature · 0 machinery.

## Risk map

- Reader/writer agreement: a newly refused non-regular base must travel through reader-owned `baseFor` without recreating base eligibility in the writer.
- Lock-held target read: a non-regular target must refuse promptly, release the sibling lock, and leave later saves able to run.
- Refusal vocabulary: base failure must remain `unnamed`; target failure must remain `unwritable`; the host must publish both as write-side `unsaved`, reserving `malformed` for document content.
- Read-value compatibility: the opened handle must preserve empty-versus-absent, UTF-8 text, create-versus-replace, and the mode captured by the locked `lstat`.
- Regression witnesses: both FIFO cases must fail the former hanging implementation rather than pass through an unrelated branch.

## Full-flow trace

- Save entry and authority are unchanged: the live offer and repository cache choose the repository root, the host derives the divergence, and no webview-supplied path becomes a destination.
- `writeNativeConfig` prepares and authorizes the native target, acquires `LockedFile`, and performs its `lstat`, mode capture, target read, base confirmation, edit, and commit inside that lock.
- Base path: `baseFor` reaches `openProviderFile` and `readBounded`; `openRegularFile` rejects a non-regular opened handle with `ENOTSUP`; `openProviderFile` classifies that as present-but-`unreadable`; `baseFor` returns non-ok; the writer returns `unnamed`. No base rule was added back to the writer.
- Target path: `LockedFile.readText` propagates `ENOTSUP`; `withLock` converts the callback throw to the caller's `unwritable` value and then releases the owned lock. No edit, temporary, link, or rename is reached.
- User output: `WorktreeHost.refusedSave` keeps `malformed` as the only content refusal and maps `unnamed` and `unwritable` to `unsaved`, with details that identify an unreadable base versus a replacement that could not be placed. Create remains enabled as D9/D13 require.
- Regular target: `fstat` does not move the file offset; `FileHandle.readFile("utf8")` starts at offset zero, returns `""` for an empty regular file, preserves UTF-8 decoding, and leaves `undefined` exclusive to `ENOENT`/`ENOTDIR`. The preceding locked `lstat` still owns the mode and `existing === undefined` still alone selects create rather than replace.

## Cross-round filter

| ID | Round 7 disposition | Seam evidence |
|---|---|---|
| F003 | fixed; not reopened | Target `lstat`, symlink verdict, mode capture, and the changed target read remain inside the same `withLock` callback. |
| F004 | fixed; not reopened | JSONC edit spans and application are untouched. |
| F005 | fixed; not reopened | The independent comment/span witnesses are untouched. |
| F009 | fixed; not reopened | Save-control capability and rendering are outside the integration cone. |
| F013 | fixed; not reopened | Detection order and active-provider selection are untouched. |
| F014 | fixed; not reopened | Pending-save redraw state is untouched. |
| F017 | fixed; not reopened | The base's authorized open is still carried to the adapter; `fstat` adds no second content read. |
| F018 | fixed; not reopened | Selection carry-forward across save answers is untouched. |
| F019 | fixed; not reopened | Native destination construction still uses `authorizedPathInsideRoot`'s returned value. |
| F021 | fixed; not reopened | The base in force still passes through `baseFor`; ENOTSUP broadens an existing unreadable-base state and still returns `unnamed`. |
| F022 | fixed; not reopened | Locked mode capture and first-create umask masking are unchanged; refusal reaches no staging path. |
| F023 | fixed; not reopened | Superseded selection eviction is untouched. |
| F025 | fixed; not reopened | Reader-owned exact membership, containment, and readable-open eligibility remain the writer's sole base decision. |
| F026 | **fixed** | Both provider and locked target reads now refuse non-regular opened handles promptly; the writer receives a failure, releases the lock, and does not reconstruct the rule locally. |

## Findings

### F027 — The stationary-pipe witness does not assert its claimed refusal

- Severity: SUGGEST
- Confidence: HIGH
- Priority: P5
- Agent: asm-review-contracts
- Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.test.ts:918`
- Title: The stationary-pipe witness does not assert its claimed refusal
- Evidence: The changed test named “refuses a pipe already there” asserts only that `first` and `second` are not `"waited"`, that the second result is not `unavailable`, and that the lock path is absent. It never asserts the first call's accepted result `{ ok: false, reason: "unwritable" }`. The raced-replacement witness does assert `unwritable`, so the production mapping is covered at that timing boundary, and the stationary witness still kills the prior hanging implementation; however, its own stationary refusal claim is broader than its assertions.
- Impact: A future stationary-only regression that answers promptly with success or another refusal could pass this witness while contradicting its title and the target-refusal contract. This is a non-gating test precision gap; no current production defect was found.
- SuggestedFix: Add `expect(first).toEqual({ ok: false, reason: "unwritable" })` while retaining the second-call and lock-removal assertions.
- Status: open
- Triage: New non-gating support finding. The test is not vacuous against F026: restoring the former blocking read makes its timer assertion fail. The missing assertion is only the exact stationary refusal result.

## Verified sound

- Base `ENOTSUP` is not a new refusal category: it is reader-side `unreadable`, writer-side `unnamed`, and host-side `unsaved`, matching D12/D13/D17 and the existing directory/permission/size refusal family.
- Target `ENOTSUP` is not content `malformed` and is not absence. It becomes writer-side `unwritable`, the lock is released, and the host reports `unsaved`.
- Empty regular files remain `""`; absent paths remain `undefined`; UTF-8 decoding, `existing === undefined`, and locked mode handling are unchanged.
- The raced-replacement FIFO witness is non-vacuous and exact: the injected `lstat` returns a regular-file observation, swaps in a FIFO, and the test requires prompt `{ ok: false, reason: "unwritable" }` plus no remaining lock. Restoring the old path-based blocking read reaches the 3-second sentinel instead.
- The stationary FIFO witness is also non-vacuous for the hang and stranded-lock mechanism: the former implementation cannot satisfy its prompt-return and following-save assertions. Its only gap is F027's omitted exact first-result assertion.
- No prior closed finding named in the review brief reopened.

## Sub-agents spawned

- asm-review-logic: writer integration, error flow, races, and witness discrimination — `gpt-5.6-sol[1M]`
- asm-review-data-security: filesystem refusal, lock release, containment, and mode preservation — `gpt-5.6-terra[1M]`
- asm-review-contracts: refusal vocabulary, `readText` contract, and test-contract coverage — `sonnet[1M]`
