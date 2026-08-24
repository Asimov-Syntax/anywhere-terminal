# Review Round 1

- Date: 2026-08-24
- Scope: working tree (`git diff HEAD` plus untracked additions)
- Reviewable lines: 3028
- Note: Large change — accuracy may decrease
- Agents spawned: asm-review-data-security, asm-review-logic, asm-review-contracts, asm-review-frontend, asm-review-performance, asm-review-reuse
- Agents skipped: none
- Verdict: REJECT
- Counts: BLOCK 3 | WARN 4 | SUGGEST 4

## Findings

### B1

- ID: B1
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: asm-review-performance, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:180
- title: Every Cursor metadata event rescans the entire unbounded chat history
- evidence: `readCursorSessions` always re-lists the root and every bucket, then stats both `meta.json` and `store.db` for every candidate before consulting the per-chat cache. `VaultService` watches every `meta.json` create/change/delete, and the 300 ms debounce still calls the full aggregate list refresh. The growth axis is total historical Cursor chats per machine, which has no structural cap; one changed chat causes O(N) directory/stat I/O across all chats.
- impact: Refresh cost grows with lifetime chat history and is paid on each metadata event. The cache avoids unchanged JSON parsing but does not make indexing incremental, contradicting the approved D3 scalability claim and risking filesystem churn/UI lag for large histories.
- suggestedFix: Propagate the changed watcher path/chat id and update only that chat subtree, or persist a high-water mark/bucket index that skips unchanged buckets and candidates without full readdir/stat traversal.
- status: accepted
- triage: Accepted — watcher-driven refresh must not pay lifetime-history O(N) I/O; implement path-targeted Cursor refresh while retaining a full initial/manual scan.

### B2

- ID: B2
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair, asm-review-data-security, asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorHookInstaller.ts:256
- title: Windows hook installation and removal always build an invalid temporary path
- evidence: `atomicReplace` derives the filename with `configPath.split("/").pop()`. On Windows, `C:\\Users\\alice\\.cursor\\hooks.json` is not split, producing a joined temp path like `C:\\Users\\alice\\.cursor\\.C:\\Users\\alice\\.cursor\\hooks.json.<ts>.tmp`; the embedded drive colon is invalid. The win32 tests still use POSIX paths from the Darwin test host and miss this.
- impact: After a successful Windows no-op probe, both install and uninstall return `write-failed`; the accepted native-Windows hook path is non-functional and cannot reverse owned entries.
- suggestedFix: Use `path.basename(configPath)` or a canonical-sibling temp path helper, and test with win32-shaped paths through an injected filesystem/path seam. Prefer the repository's existing atomic temp-path seam to prevent further platform drift.
- status: accepted
- triage: Accepted — the Windows-shaped config path can generate an invalid sibling temp name; use path-flavor-aware basename/dirname/join and a Windows-path fixture.

### B3

- ID: B3
- severity: BLOCK
- confidence: HIGH
- priority: P1
- agent: chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:128
- title: Unsupported hook schemas leave runtime acceptance enabled
- evidence: `reconcileCursorHookInstall` only logs `installed:false`; its result is not connected to runtime state. Independently, startup constructs the runtime with `enabled: initialCursorHooksEnabled` and attaches it, while a setting enable immediately calls `setEnabled(true)` and attaches before the asynchronous installer result. If `hooks.json` is malformed/future-version and still contains prior owned entries, installation returns `unsupported-config` but those stable wrapper entries continue posting to an enabled runtime.
- impact: This directly violates the approved requirement that malformed or unsupported schemas remain unchanged and disable runtime acceptance immediately. The extension can observe events through configuration it has declared unsupported and cannot reconcile safely.
- suggestedFix: Make reconciliation return an awaited outcome to one serialized state-application function. Attach/enable runtime authority only after successful installation; on unsupported or failed reconciliation, detach and disable immediately while retaining PTY-output fallback and reporting the reason.
- status: accepted
- triage: Accepted — runtime authority must be contingent on successful supported-schema reconciliation and must fail closed to PTY-output fallback on every install failure.

### W1

- ID: W1
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-logic
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/extension.ts:149
- title: A setting change during async activation can leave the opposite final hook state
- evidence: Activation snapshots `initialCursorHooksEnabled`, queues reconciliation, then awaits runtime binding before the configuration-change listener is registered. A setting change during that await is missed, so installer, runtime, and contributor remain based on the stale startup value.
- impact: Hooks and semantic status can remain enabled or disabled contrary to the current setting until another toggle or activation.
- suggestedFix: Register the listener before the await or re-read the setting after runtime initialization, then route startup and changes through the same serialized state-application function.
- status: accepted
- triage: Accepted — route startup and settings changes through one serialized state transition and re-read the current setting after async runtime initialization.

### W2

- ID: W2
- severity: WARN
- confidence: HIGH
- priority: P1
- agent: asm-review-contracts, asm-review-data-security, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorExecutableResolver.ts:24
- title: Capability probing does not prove Cursor identity or positional-prompt support
- evidence: The resolver accepts `agent --help` when independent lowercase substrings `prompt`, `--resume`, `--mode`, `plan`, and `--force` occur anywhere. A CLI with a `--prompt` option rather than a positional prompt, or an unrelated `agent` with these common terms, passes. The selected binary then receives the user's handoff prompt as argv and may receive `--force`.
- impact: Continuation can invoke the wrong executable or an incompatible CLI and disclose the handoff prompt to it, violating the collision-safe probe contract.
- suggestedFix: Validate an official Cursor-identifying usage shape and structural positional-prompt/flag syntax rather than independent substrings; add negative tests for `--prompt`-only and unrelated help output.
- status: accepted
- triage: Accepted — collision-safe launch requires a Cursor-identifying usage shape and an actual positional prompt operand, not independent common substrings.

### W3

- ID: W3
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-contracts, chair
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorPaths.ts:89
- title: Unsafe Cursor chat ids are silently omitted instead of counted unreadable
- evidence: `listCursorChatCandidates` immediately continues when `isSafeCursorChatId` fails and returns only `candidates` plus `ambiguous`. `readCursorSessions` therefore cannot add unsafe ids to `unreadable`; the changed test explicitly expects zero for a traversal-shaped id.
- impact: The Vault suppresses the partial-failure signal required by the approved safe-lookup contract, so users cannot distinguish rejected unsafe metadata from an empty/complete index.
- suggestedFix: Return a rejected/unsafe count from candidate scanning and add it to `unreadable`, while continuing to avoid joining or reading those paths.
- status: accepted
- triage: Accepted — unsafe directory names remain rejected before path joining, but the aggregate unreadable count must include those rejected candidates.

### W4

- ID: W4
- severity: WARN
- confidence: HIGH
- priority: P2
- agent: asm-review-data-security
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorHookInstaller.ts:332
- title: POSIX wrapper paths containing apostrophes are quoted as invalid shell syntax
- evidence: `shellQuote` replaces `'` with an escaped-double-quote sequence that yields unbalanced POSIX shell quotes, rather than the standard close-quote, quoted-apostrophe, reopen sequence. A global storage path under a home directory containing an apostrophe produces broken commands in every installed hook entry.
- impact: Hook observation permanently fails for affected users after mutating their user-owned `hooks.json` with unusable commands.
- suggestedFix: Use a proven POSIX argv quoting helper or the standard `'"'"'` shell representation without literal backslashes, and add a storage-path fixture containing an apostrophe.
- status: rejected
- triage: Rebutted — the implementation already emits the standard POSIX `'<prefix>'"'"'<suffix>'` form; a path containing an apostrophe produced `'/tmp/O'"'"'Brien/hook.sh'`, and `/bin/sh -n` accepted it with status 0. Add a regression test only if re-review produces a failing fixture.

### S1

- ID: S1
- severity: SUGGEST
- confidence: HIGH
- priority: P4
- agent: asm-review-reuse
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/vault/readers/cursorReader.ts:59
- title: Reuse the repository's bounded-read primitive
- evidence: Cursor adds another open/read/cap/close implementation while `/Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/providers/readBytesBounded.ts` already owns the same resource-safety concern.
- impact: Bounds, short-read handling, and descriptor cleanup can drift across readers.
- suggestedFix: Extract a path/dependency-neutral bounded byte reader used by both callers; keep Cursor-specific UTF-8 and overflow interpretation in `cursorReader`.
- status: rejected
- triage: Deferred as non-blocking — extracting a shared dependency-neutral reader broadens this review fix; Cursor's bounded read is independently TOCTOU/overflow/cleanup tested and currently has no observed behavioral drift.

### S2

- ID: S2
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-data-security
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorHookInstaller.ts:104
- title: Disable leaves empty event keys in user hook configuration
- evidence: Install creates all managed event keys; uninstall filters owned entries but assigns empty arrays rather than deleting keys that did not previously exist.
- impact: Enable/disable is not a byte- or shape-reversible round trip for a user-owned config, although the residue is functionally inert.
- suggestedFix: Track keys created by the installer or delete event keys when the retained array is empty and no prior user value existed.
- status: rejected
- triage: Deferred as non-blocking — deleting empty keys safely requires durable provenance to distinguish installer-created keys from pre-existing user-owned empty arrays; exact owned entries are removed and unrelated arrays are preserved.

### S3

- ID: S3
- severity: SUGGEST
- confidence: MEDIUM
- priority: P5
- agent: asm-review-data-security
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorHookInstaller.ts:342
- title: POSIX curl exposes the pane token in process arguments
- evidence: The wrapper expands the token-bearing `ANYWHERE_TERMINAL_CURSOR_URL` into curl's argv. On systems where other local users can inspect process command lines, the token is visible while the hook request runs.
- impact: Another local user could transiently spoof working/idle status for that pane; the token grants no content read or execution capability.
- suggestedFix: Move authentication out of argv, such as a header/config supplied through a protected stream, while retaining bounded fail-open behavior.
- status: rejected
- triage: Rebutted as non-material for the stated threat model — a same-user process able to inspect curl argv can already inspect the parent PTY environment containing the same URL token, while the authority can only spoof local status and is revoked per PTY incarnation.

### S4

- ID: S4
- severity: SUGGEST
- confidence: MEDIUM
- priority: P4
- agent: asm-review-data-security
- file: /Users/huybuidac/Projects/ai-oss/anywhere-terminal/src/cursor/CursorHookInstaller.ts:364
- title: Windows no-op probe has no process timeout
- evidence: `runCommand` resolves only on child `error` or `close`; a hung `cmd.exe`/PowerShell probe never settles, and all later reconciliations remain queued behind it.
- impact: Enable/disable reconciliation can wedge for the extension-host lifetime on an abnormal Windows child-process hang.
- suggestedFix: Add a bounded spawn timeout or timer that kills the child and resolves the probe as failed.
- status: accepted
- triage: Accepted — the Windows no-op probe needs an independent deadline that kills a hung child and unblocks later serialized reconciliations.

## Verification

- `pnpm run test:unit`: passed, 149 files / 2632 tests.
- Focused Cursor, lifecycle, and UI tests: passed, 287 tests total.
- `pnpm run check-types`: exited 2 with only the documented pre-existing `src/webview/vault/markdownLite.ts:80` error.
- `pnpm exec biome check src/`: completed with 13 warnings and no errors; formatting/style warnings were not reviewed as findings.
- `git diff HEAD --check`: passed.
