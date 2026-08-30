# Review Round 1

- Date: 2026-08-31
- Cycle: 1
- Mode: discovery
- Review lane: fastlane
- Scope: range `c732ed7f^..f0de5fd51861e9f9722faf4edbe544767daebf7c`
- Head: `f0de5fd51861e9f9722faf4edbe544767daebf7c` (tree dirty after the reviewed range: `asimov/changes/assess-a-removal-before-offering-it/analytics.json`)
- Reviewable lines: 514
- Large change: no
- Recorded Verify Gate: task records in `.build/verified.ndjson` report exit 0 for type checks and focused/unit tests; `workflow.md` records only pre-existing Biome findings outside this change; review ran no project verify command
- Agents spawned:
  - `asm-review-logic` — removal authorization gate — `gpt-5.6-sol[1M]`
  - `asm-review-performance` — bounded ignored walk — `gpt-5.6-terra[1M]`
  - `asm-review-data-security` — irreversible removal evidence — `sonnet[1M]`
  - `asm-review-contracts` — assessment check contracts — `gpt-5.6-luna[1M]`
  - `asm-review-logic` — ignored adapter correctness — `gpt-5.6-luna[1M]`
  - `asm-review-reuse` — parser and seam reuse — `gpt-5.6-luna[1M]`
- Support spawned: `asm-finder` — removal evidence full-flow trace
- Agents skipped: `asm-review-frontend` — no UI files changed; rendering is explicitly WT-013.4
- Verdict: REJECT
- Counts: 4 BLOCK, 1 WARN, 1 SUGGEST
- Split: 4 feature blockers, 0 machinery blockers

## Findings

### B1
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-contracts`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/worktreeFingerprint.ts:153`
- Title: An unproven check authorizes a newly failed ignored-material check
- Evidence: `ignoredWithin()` returns `true` for every current reading whenever the approved reading was `unproven`. `checksFor()` maps that approved reading to outcome `unproven`, but a later measured reading with entries maps to `failed`; the accepted spec requires a check that was not failing at confirmation time and is failing at execution time to re-prompt. The new test at `src/worktree/worktreeFingerprint.test.ts:692` explicitly expects a token issued against unreadable ignored material to proceed against 4,000 measured entries. Invariant inventory — boundaries searched: check outcome translation, token issue, token redeem, forced mutation gate, refusal path, final git side effect; affected: token redeem for `unproven -> measured failed`; verified safe: measured growth re-prompts, measured-to-unproven re-prompts, refusal-class growth refuses.
- Impact: A held token shown only “ignored content could not be read” can authorize deleting an arbitrarily large ignored tree once the next assessment can measure it, even though that quantified failure was absent from the approved evidence.
- SuggestedFix: Compare the ignored check outcome as well as its magnitudes. An approved `unproven` reading may cover a current `unproven` reading or a measured zero, but a current measured failure must return `reprompt`.
- Status: accepted
- Triage: accepted. Verified against the accepted spec, not the design note. specs/worktree-panel/spec.md says "a check that was NOT FAILING at the time of confirmation is failing at execution time" re-prompts; `unproven` is not failing, so approved-unproven -> current-measured-failed must re-prompt. My design note ("confirming an amount nobody could bound authorizes any amount") is a reasoned position but it is a deviation from an accepted spec sentence, which is not mine to make in a fix loop. The fix also fails in the safe direction: strictly more re-prompts, never fewer. Fixing.

### B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:740`
- Title: A current-window idle Claude session is reclassified as an unknown external session
- Evidence: `listRunningClaudeSessions()` is user-wide and includes sessions already claimed by panes in this window. The presence projector removes those claimed identities before producing external rows (`presenceProjector.ts:787-801`), but the removal producer maps every registry session to `ExternalSessionFact` with `activity: undefined`. `evaluateRemoval()` then refuses every such rooted record at `worktreeBlockers.ts:223-231`, even when `facts.panes()` has already supplied the same current-window session as provably idle. Invariant inventory — boundaries searched: current pane evidence, registry evidence, external-session dedupe, busy-agent scoring, refusal, confirmable idle-pane evidence; affected: registry-to-removal translation; verified safe: genuinely external unknown sessions refuse and external rows are excluded from `busyAgents`.
- Impact: An idle Claude pane in the current window can make its worktree unremovable until the Claude process exits, contradicting the accepted rule that idle panes are confirmable and only genuinely external unknown sessions refuse.
- SuggestedFix: Preserve the current-window claimed-session set for removal assessment and exclude those identities from `ExternalSessionFact[]`, or carry ownership/session identity explicitly so the known pane activity classifies the session once. Add a production-boundary test with one idle pane and its matching registry entry.
- Status: accepted
- Triage: accepted as a defect; NOT fixed in this round — handed back to asimov-plan. Reachability confirmed: a Claude running in a VS Code terminal pane writes its own registry entry, so an idle local pane is listed user-wide with a live pid, and production maps every registry session to activity `undefined`, which refuses. This change introduced it (before 1_1 every external session was confirmable). Task 1_1's Plan step 4 asked for exactly this de-duplication and I covered only the rows-vs-busyAgents half. The fix needs a producer for "which registry sessions does this window already hold". That set exists only as a local inside presenceProjector's window pass (`claimed`, built from `identify()`, which does process-table reads and heuristics); publishing it to the removal path is either a new owner for that fact or a dependency of the refusal decision on the presence projection, which task 1_1's Boundary forbids in as many words. Per the remediation boundary that is a handback, and per fastlane a safety decision about what refuses an irreversible removal is never auto-chosen. Handback emitted.

### B3
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-logic`, `asm-review-contracts`, `asm-review-performance`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:152`
- Title: Ignored directory trees are measured as one directory inode
- Evidence: Production runs `git status --porcelain --ignored=matching`. A real Git probe with ignored `node_modules/` and `dist/` emitted only `!! node_modules/` and `!! dist/`; `--ignored=matching` did not enumerate their descendants. The adapter then calls `stat()` once on each directory and records the directory inode size. The changed test instead fakes `!! node_modules/react/index.js`, so it asserts output the selected Git mode does not produce for a directory ignore pattern. Invariant inventory — boundaries searched: Git enumeration, filesystem sizing, report translation, `atRisk`, fingerprint re-evaluation, final recursive removal; affected: enumeration, report magnitude, and fingerprint comparison; verified safe: a reported directory entry still makes unforced removal request confirmation.
- Impact: A multi-gigabyte ignored tree is reported as one entry and a few inode bytes. Child additions or file growth can leave the same false magnitudes at re-evaluation, allowing the held confirmation to delete materially more than its evidence represented.
- SuggestedFix: Enumerate the actual ignored deletion population recursively under the same budgets, using a machine-safe record format, and size those entries rather than directory inodes. Add a real-Git integration case for a directory ignore pattern and growth beneath it.
- Status: accepted
- Triage: accepted, and my own rationale was wrong. Probed git 2.50.1 directly: with `node_modules/` and `dist/` in .gitignore, BOTH `--ignored=matching` and `--ignored=traditional` emit `!! node_modules/` and `!! dist/` — the directories. `matching` does not enumerate their files, so the adapter stat'd a directory inode and the code comment and commit message asserting the opposite are false. My unit test faked descendant output git does not produce, which is why it stayed green. Fix is not a recursive walker: `git ls-files --others --ignored --exclude-standard -z` enumerates every ignored FILE recursively, and NUL-delimited output is unquoted, so it closes W1 in the same move. Note this changes the enumeration command D3's rejected-alternatives paragraph named; D3's actual Decision (one walk, one pair of budgets, unproven on every terminating condition) is untouched, and I am correcting the false sentence in design.md rather than leaving a wrong fact as the record.

### B4
- Severity: BLOCK
- Confidence: HIGH
- Priority: P2
- Agent: `asm-review-performance`, `asm-review-contracts`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:91`
- Title: The production walk is not bounded by its entry or time budgets
- Evidence: `diskIgnoredDeps.ignoredEntries()` awaits `GitCommandRunner.run()` before yielding its first record. That runner buffers up to 32 MiB and uses a 10,000 ms default timeout, so Git can enumerate and materialize the whole listing before the 5,000-entry/1,500 ms checks execute. During sizing, elapsed time is checked only before `await deps.size(relPath)`; an individual `stat` has no deadline or cancellation and can finish after the limit while the function still returns `measured`. Invariant inventory — boundaries searched: enumeration process, stdout buffering, record admission, serial stat, deadline result, error fallback; affected: production enumeration and each stat await; verified safe: once control returns between records, the pure loop stops at its counters and converts thrown I/O to `unproven`.
- Impact: A large or slow ignored tree can consume the runner’s larger buffer/time limits or stall on a filesystem read instead of returning confirmable `unproven` within the promised single budget. This breaks the core bounded-walk acceptance condition.
- SuggestedFix: Carry one absolute deadline through the production adapter; stream records with backpressure, abort Git at the entry/deadline boundary, and deadline-race or cancel each stat using the remaining time. Expiry must return `unproven: budget` without waiting for more work.
- Status: accepted
- Triage: accepted, with one correction to the impact. Git's whole output is buffered before the first budget check, so MAX_IGNORED_MS bounds the stat phase only — that part is right and the declared budget overstates what it covers. But the walk cannot "stall": the runner carries a 10s timeout and a 32MiB maxBuffer, and either produces a non-zero result, which the adapter throws on and `measureIgnoredMaterial` reports as confirmable `unproven`. So the failure is a slower-than-declared bound, not an unbounded one. Fixing by passing the walk's own remaining budget to the runner as `timeoutMs` and re-checking the deadline after each stat rather than only before it.

### W1
- Severity: WARN
- Confidence: HIGH
- Priority: P3
- Agent: `asm-review-logic`, `asm-review-data-security`, `asm-review-reuse`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/worktree/ignoredMaterial.ts:163`
- Title: Git’s quoted paths are not decoded
- Evidence: Porcelain C-style quoting escapes quotes, backslashes, control bytes, and—depending on `core.quotePath`—non-ASCII bytes. The adapter only removes the outer quotes, so a record such as `!! "quo\\\"te"` is statted as a path containing the backslash escape rather than the real filename. The resulting `ENOENT` turns the whole walk into `unproven`.
- Impact: Valid, readable ignored trees with such filenames consistently degrade to “could not be read,” withholding the count and size the assessment was meant to provide. This fails conservatively rather than silently passing, so it is not a blocker by itself.
- SuggestedFix: Use a NUL-delimited Git format whose paths are unquoted, or decode Git’s quoted-path grammar exactly; cover quotes, backslashes, tabs, and non-ASCII filenames.
- Status: accepted
- Triage: accepted, fixed as a side effect of B3 — `-z` output is NUL-delimited and never quoted, so there is nothing to decode. Note for the chair: `asm-review-reuse` messaged this session directly with a second, distinct finding that did NOT reach this file — that `ignoredMaterial.ts` and `worktreeBlockers.ts#parsePorcelain` each parse `git status --porcelain` lines. Only the C-quoting half of it survived into W1. I verified their stated failure scenario and it does not hold as written (the two quote strips are character-identical, so the copies cannot disagree with each other, and git never emits a rename arrow on a `!!` record), but the duplication itself was real. The B3 fix removes it: the adapter no longer parses porcelain status lines at all.

### S1
- Severity: SUGGEST
- Confidence: MEDIUM
- Priority: P4
- Agent: `asm-review-logic`, `asm-review-data-security`, `chair`
- Class: feature
- File: `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/asimov/worktrees/anywhere-terminal/create-worktree-harden/src/extension.ts:763`
- Title: Symlink entries are sized through their external targets
- Evidence: Production injects `fsp.stat`, and `diskIgnoredDeps.size()` follows that result. For an ignored symlink, `stat` follows the target—including a target outside the worktree—while worktree removal deletes only the symlink entry.
- Impact: The displayed byte total can substantially overstate what removal will delete and can incorporate metadata from an external target, though no target content is read or deleted.
- SuggestedFix: Use `lstat` for symlink entries and, if recursive directory sizing is added, never follow a symlink outside the worktree’s deletion set.
- Status: accepted
- Triage: accepted. `fsp.stat` follows an ignored symlink and sizes its target, while the removal deletes only the link — so the reported size can include bytes outside the worktree entirely. `fsp.lstat`. Fixing.

## Accepted risk

None.

## Audit backlog

None.
