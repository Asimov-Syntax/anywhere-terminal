# Review round 1 — detect-the-provider-the-repo-already-uses

- Date: 2026-09-01
- Cycle: 1
- Mode: discovery
- Scope: range `44553fd0~1..HEAD`, with change context from this change's artifacts
- Head: `99e9d6a8b406708d6ac17bfddcca6fdeda7b16ec` (tree dirty only in Asimov analytics written by review accounting)
- Reviewable lines: 1,949; changed test/support lines: ~1,620 reviewed inline
- Note: Large change — accuracy may decrease
- Agents spawned: 6 (performance, logic, data-security, contracts, frontend, reuse) + chair self-review and full-flow trace
- Agents skipped: none
- Verify gate evidence: `bun run asm change verify-status detect-the-provider-the-repo-already-uses` reports tasks 1_1 through 3_5 exit 0. The review did not re-run typecheck, lint, or tests.
- Verdict: **REJECT**
- Counts: 3 BLOCK / 2 WARN / 2 SUGGEST
- Split over gating blockers: 3 feature / 0 machinery

The accepted design decisions D3, D4, D6, D7, D8 and D9 were treated as obligations, not waivers. The deliberate D5 overlap between the opening re-check and retirement sweep was not reported. The out-of-scope design-owned HTML/CSS and WT-012.4's native provider/merge work were not reviewed.

---

## F001 — A failed later switch lowers the ceiling and re-admits an earlier choice

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-logic
- File: `src/providers/WorktreeHost.ts:2216-2222`
- Status: accepted · Triage: new discovery; gating
- Author triage: accepted — confirmed at `WorktreeHost.ts:2220-2222`. Going further than the chair: the delete is not merely unsafe, it is unnecessary. `WorktreeCreateDialog` mints `switchSeq` strictly increasing, so a retry already outranks any retained ceiling; releasing it buys nothing and costs the monotonicity. Fix drops the release entirely rather than replacing it with an in-flight marker.

**Invariant.** For one `(surface, repo, opening)`, once switch sequence N has been seen, no sequence below N may ever be accepted or published. The highest-seen sequence is monotonic until the opening retires.

**Boundary categories searched:** successful reads, reverse completion, read rejection, delayed/replayed messages, close, supersede, detach, and offer replacement.

**Evidence.** The handler raises `provisionSwitch` synchronously before the read, but the rejection handler deletes the slot when the rejected request still owns it. The schedule is: switch 1 starts and stays pending; switch 2 is accepted and rejects; its catch deletes the ceiling; a delayed or replayed switch-1 message then passes `msg.switch <= (provisionSwitch.get(slot) ?? 0)` because the slot is empty and can publish. The recorded highest sequence has moved from 2 back to nothing. This is outside the existing reverse-success test, which never exercises rejection followed by a lower replay.

**Affected boundary:** rejection plus replay/delay. **Verified safe:** reverse completion while the later read succeeds; retirement sweeps pending sequence state; a wrong opening/provider is refused before reading.

**Impact.** An older provider selection can be re-admitted after a later choice was already observed, replacing the section with stale rows and stale submission authority. This directly violates D5 and task 3_2's latest-choice acceptance.

**Fix.** Never lower the highest-seen sequence on read failure. Keep it until `retireOpening`; a retry from the dialog already carries a newly increased sequence. If retry bookkeeping is needed, use a separate in-flight marker rather than deleting the monotonic ceiling. Add a rejection → lower replay witness.

---

## F002 — VS Code task setup rows bypass the model-wide row cap

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-performance
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:167-190`; `src/worktree/provisioning/orcaProvider.ts:78-100`
- Status: accepted · Triage: new discovery; gating
- Author triage: accepted — confirmed. `full()` is called only at `asimovProvider.ts:169,184` and inside `providerKit`'s glob paths; `addSetup`/`addEntry`/`addPort` charge the budget without enforcing it. The 1_2 comment 'every append is charged' promised an accounting the appends never completed. Enforcement moves into the append API so the promise and the code agree.

**Invariant.** One provisioning read emits at most `MAX_MODEL_ROWS` rows across entries, setup, ports and problems; every append must either reserve capacity or be refused under the shared budget.

**Boundary categories searched:** entries, ports, setup, problems, provider rows, active and inactive sources, success and diagnostic paths.

**Evidence.** `addSetup()` only increments `budget.rows`; it does not enforce `full()`. The VS Code task loop calls `addSetup()` for every eligible repository-controlled task without a preceding capacity check or stopping when the budget is capped. A targeted scratch probe supplied 250 valid `worktreeCreated` tasks and received `{"taskRows":250,"total":250}` despite `MAX_MODEL_ROWS = 200`. If `reportUnsubstituted()` fills the budget first, the same task is still appended afterward. Orca's single setup step has the same unchecked append and can push a model one row past a cap already reached by shared-directory expansion.

**Affected boundaries:** VS Code task setup is bounded only by the 256 KiB input-file cap rather than the 200-row model cap; Orca setup can exceed the cap by one. **Verified safe:** Asimov checks `full()` before each setup/port append; `entriesFor()` and `report()` enforce the shared account; provider switch rows are structurally capped by the three-entry detection order.

**Impact.** A checked-in task file can produce thousands of setup rows, crossing `postMessage` and creating proportional DOM work despite D9's accepted hard bound. The model the later shell task consumes is also larger than the invariant promises.

**Fix.** Make the append API enforce capacity itself, or replace it with a checked `tryAddSetup`/generic row append that reserves the cap diagnostic and refuses the row. Stop the VS Code task loop when capped, and cover both the many-task case and Orca setup after a full draft.

---

## F003 — Repository-root failure falsely activates the VS Code Tasks provider

- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Class: feature
- Agent: chair + asm-review-contracts
- File: `src/worktree/provisioning/readProvisioning.ts:87-106`; `src/worktree/provisioning/vscodeTasksProvider.ts:119-132`
- Status: accepted · Triage: new discovery; gating
- Author triage: accepted — confirmed asymmetry. `orcaProvider.ts:137` and `asimovProvider` both return `null` for `at === "root"`; `vscodeTasksProvider` returns `null` only for `absent`. Because it is last in `DETECTION_ORDER`, a root failure elects it with no file present.

**Invariant.** A provider is active if and only if at least one of its files is present. Repository-root resolution failure is neither provider absence nor provider presence and must not enter the `model !== null` active-provider path.

**Boundary categories searched:** root resolution, provider-file absence, file-level unreadable/refused, malformed content, inactive presence probes, and preferred-provider fallback.

**Evidence.** `asimovAdapter` and `orcaAdapter` return `null` when `openProviderFile` reports `at: "root"`, but `vscodeTasksAdapter` turns the same root failure into a non-null problem model. `readProvisioning` interprets any non-null model as detection and unconditionally pushes `{ id: adapter.id, active: true }`. A targeted scratch probe where `realpath(repoRoot)` throws returned `providers: [{"id":"vscodeTasks","files":[".vscode/tasks.json"],"active":true}]` and a problem naming that absent task file. No provider file was opened or proven present.

**Affected boundary:** repository-root failure. **Verified safe:** ordinary missing files return `null`; present-but-unreadable provider files remain hits; fixed-order and preferred-provider behavior are correct when the root resolves.

**Impact.** An inaccessible, looping, or transiently unresolved repository is shown as actively using `.vscode/tasks.json` even when that file does not exist. This falsifies D3's presence contract and the feature's central detection result.

**Fix.** Represent root failure as a distinct orchestration outcome and handle it once before provider selection, returning a problem model with no active provider. Do not let adapters independently map root failure to absence or presence. Add a production-path regression with a failing root `realpath`.

---

## F004 — D4 duplicates the repository's canonical POSIX quoting implementation

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-reuse
- File: `src/worktree/provisioning/vscodeTasksProvider.ts:42-44`
- Status: accepted · Triage: downgraded from specialist BLOCK because current output is byte-for-byte equivalent; the defect is duplicated security-sensitive ownership, not a present escaping failure
- Author triage: accepted — arrived out of band from asm-review-reuse before the chair's report and was verified read-only then: byte-identical to `src/utils/posixShellQuote.ts:12-13`, which was itself extracted for this reason (`integrate-cursor-agent/.reviews/round-2.md` W4) and has three importers. A reuse-first miss, not a preference. The existing rendering assertions stay untouched — unchanged output is the proof the swap is behaviour-preserving.

**Evidence.** Local `quoted()` implements the same single-argument encoding as `src/utils/posixShellQuote.ts:12-13`, including the apostrophe sequence. The utility is already the repository's canonical helper and is used by the PTY, Cursor hook, and vault launch paths. The new implementation is currently correct, so this is not a command-injection witness today.

**Impact.** D4's load-bearing shell boundary now has a second implementation that can drift independently from the repository's proven quoting helper.

**Fix.** Import `posixShellQuote` and remove local `quoted()`. Keep the D4 process/shell classification tests at this adapter boundary.

---

## F005 — Later globs still consume names after the shared scan budget is exhausted

- Severity: WARN · Confidence: HIGH · Priority: P2 · Class: feature
- Agent: asm-review-performance
- File: `src/worktree/provisioning/providerKit.ts:388-412`
- Status: accepted · Triage: new discovery; non-gating because total overrun remains structurally bounded by the row cap
- Author triage: accepted — confirmed at `providerKit.ts:396`: `for await` pulls a name before the `room()` check, so each glob reads one name past exhaustion. Fixed with F002 in the same bound.

**Invariant.** At most `MAX_SCAN` directory names are consumed across all globs in one read.

**Evidence.** In the async-iterator branch, `for await` requests the next name before `room() === 0` is checked. The first exhausted glob may need one look-ahead to prove truncation, but every later glob begins with zero room and still opens its directory and consumes one name before returning `truncated`. Diagnostics then bound the number of such later globs by the row cap, but the actual names read can reach roughly `MAX_SCAN + MAX_MODEL_ROWS`, not `MAX_SCAN`.

**Impact.** D9's scan account is not a hard whole-read bound; repository-controlled post-exhaustion globs continue performing directory opens and reads.

**Fix.** Return `{ names: [], truncated: true }` before entering the iterator when the shared budget has no room. Preserve at most one look-ahead only for the glob that consumes the final available slot.

---

## F006 — Multiple switch buttons have the same accessible name

- Severity: SUGGEST · Confidence: HIGH · Priority: P3 · Class: feature
- Agent: asm-review-frontend
- File: `src/webview/worktree/WorktreeCreateDialog.ts:403-426`
- Status: accepted · Triage: new discovery; non-gating support issue
- Author triage: accepted — non-gating but cheap; the accessible name will carry the provider's files.

**Evidence.** Every inactive-provider button is named only `Use this instead`. The provider file names are sibling text and are not associated with the button through `aria-label` or `aria-describedby`.

**Impact.** A screen-reader user navigating controls cannot distinguish Orca from VS Code Tasks when more than one inactive source is offered.

**Fix.** Include the file names in the accessible name, or assign the file span an id and reference it with `aria-describedby`.

---

## F007 — Draft-to-model assembly is copied across all three adapters

- Severity: SUGGEST · Confidence: MEDIUM · Priority: P4 · Class: feature
- Agent: asm-review-reuse
- File: `src/worktree/provisioning/asimovProvider.ts:198-205`; `src/worktree/provisioning/orcaProvider.ts:193-200`; `src/worktree/provisioning/vscodeTasksProvider.ts:194-202`
- Status: accepted · Triage: new discovery; non-gating cohesion issue
- Author triage: accepted — also removes the surface F002 exploited: one assembly point is where a shared rule such as the cap can be enforced once instead of three times.

**Evidence.** All three adapters independently assemble the same `entries/setup/ports/providers/excluded/problems` shape from `Draft`, while `providerKit.ts` already owns `Draft` and `emptyModel()`.

**Impact.** A future shared model field or assembly rule can update one adapter and leave the other two inconsistent.

**Fix.** Add a small `modelFromDraft` helper in `providerKit.ts`, with provider metadata supplied by the dispatcher, and use it from each adapter.
