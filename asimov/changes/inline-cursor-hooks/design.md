# Design: inline-cursor-hooks

## Decisions

### D1: The POSIX registration is one frozen inline literal

Darwin and Linux SHALL register this exact shell program as the Cursor hook command:

```sh
set +e +x 2>/dev/null; trap '' PIPE 2>/dev/null; unset -f command cat curl printf read 2>/dev/null || :; printf '{}\n'; payload=$(command -p cat 2>/dev/null) || { while IFS= read -r _; do :; done; exit 0; }; url=${ANYWHERE_TERMINAL_CURSOR_URL:-}; case "$url" in http://127.0.0.1:*) ;; *) exit 0 ;; esac; rest=${url#http://127.0.0.1:}; port=${rest%%/*}; path=${rest#*/}; session=${path%%/*}; token=${path#*/}; case "$port" in ''|*[!0-9]*) exit 0 ;; esac; [ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ] 2>/dev/null || exit 0; case "$session" in ''|*'@'*|*'?'*|*'#'*|*/*) exit 0 ;; esac; case "$token" in ''|*[!0123456789abcdef]*|*/*) exit 0 ;; esac; [ "${#token}" -eq 64 ] || exit 0; printf '%s' "$payload" | command -p curl --disable --silent --noproxy '*' --globoff --proto '=http' --output /dev/null --connect-timeout 0.5 --max-time 1.5 --request POST --header "content-type: application/json" --data-binary @- -- "$url/cursor" 2>/dev/null || :; exit 0
```

The source exports it as a literal, never reconstructs it from fragments, and a real `cursor-agent` spike executes these exact bytes before the generation is accepted. `set +e +x` prevents inherited errexit/tracing from aborting or printing later expansions; ignoring `PIPE` keeps a closed result channel from terminating the shell before stdin is consumed; imported functions named for every invoked regular builtin/utility are removed before payload use. `printf` emits Cursor's neutral response immediately; stdin is captured before URL/network decisions so an early exit cannot leave the caller writing into a closed pipe.

### D2: The literal closes ambient configuration, not pre-command code execution

The base URL is parsed as numeric port + one non-empty encoded-session segment + one 64-character lowercase-hex token. Userinfo, query, fragment, extra path segments, nonnumeric/out-of-range ports, and non-loopback schemes/authorities exit without a request. Curl also receives `--globoff`, `--proto '=http'`, and `--` before the single quoted URL operand.

`command -p` runs after exported `command`, `cat`, and `curl` functions are removed. The ignored `PIPE` disposition is installed before the neutral result is written, so stdout closure becomes a local write failure rather than process termination. `--disable` is curl's first argument, so `HOME`, `XDG_CONFIG_HOME`, or `CURL_HOME` cannot select startup options; `--noproxy '*'` defeats proxy variables. Redirects are not enabled, stdout/stderr are discarded, and the network attempt is bounded to 0.5s connect / 1.5s total. The registered handler's existing `timeout: 2` is the outer process bound, including a producer that delays EOF.

The payload contract is JSON semantics, not byte-for-byte transport: POSIX command substitution may remove trailing LF whitespace, which does not change valid JSON; NUL is invalid JSON and is not supported. Shell startup files or loader variables that execute arbitrary code before the command begins (`BASH_ENV`, `ENV`, `LD_PRELOAD`, `DYLD_*`) and replacement of system binaries are outside this boundary—such code already has the payload before any inline command can sanitize it. The real-agent spike records the shell behavior actually used by the supported Cursor version.

Direct-shell tests include sensitivity controls: inherited functions, xtrace, executable PATH hijack, authority escape, proxy/curlrc sinks, and an unread stdin all demonstrate the hazard under an unhardened control and the opposite under D1.

### D3: Ownership is exact, event-scoped, and platform-historical

The managed entry shape remains exactly `{command, timeout: 2}`. An entry is claimable only under one of the 12 released `CURSOR_HOOK_EVENTS` and only when its command is byte-equal to the host's candidate set:

| Host | Claimable commands |
|---|---|
| Darwin/Linux | D1 literal; POSIX-quoted `<current storagePath>/cursor-hook-observer.sh` |
| Windows | Windows-quoted `<current storagePath>\cursor-hook-observer.cmd` |

Entries under custom/future events are never claimed. No filename/quoting cross-product, path normalization, substring match, marker, handler-shape inference, or stale storage-root guess is permitted. A byte-identical user entry under a released event is fundamentally indistinguishable and is accepted as claimable evidence rather than provenance; a future literal generation appends its predecessor to the explicit set.

### D4: Configuration replacement commits before wrapper cleanup

POSIX install holds the config lock, compare-and-retries the supported document, atomically replaces exact managed/legacy entries with one D1 entry per released event, and only then attempts to unlink the exact released wrapper.

```text
read + validate → exact event-scoped sweep/add → atomic config rename → unlink old wrapper
        fail ───────────────────────────────────┘ old command and file remain executable
                                                        unlink fail → inline active + reported dead-file path
```

A pre-commit failure preserves the old executable registration but observability remains disabled, as it does for every failed reconciliation today; “working” here means the agent hook stays fail-open, not that runtime authority is granted. Uninstall removes exact current/legacy entries first and deletes the wrapper only while holding the same lock and after the config is durably free of them. `ENOENT` is idempotent success; no directory scan is performed.

“Durable” in this change means process-crash ordering around a successful rename, not power-loss durability. No fsync/file-sync guarantee is added: a crash before rename leaves the old config; a process crash after rename may leave an unreferenced wrapper for retry.

### D5: Outcomes carry exact unresolved paths

Install and remove results retain their existing booleans/reasons and add `unresolved?: readonly string[]`. The array names paths not proven clean; it never contains inferred commands or scanned files.

A POSIX install whose config replacement succeeded remains `installed: true` if deleting the now-unreferenced wrapper fails, with reason `legacy-wrapper-delete-failed` and that wrapper in `unresolved`. The controller grants runtime authority and separately warns. Disable/remove succeeds only when configuration and exact wrapper cleanup are settled; incomplete cleanup returns false with the underlying reason and paths. `not-installed` means neither an exact registration nor the exact wrapper remains.

Config read/lock/write failures include the config path and any exact wrapper that cannot safely be deleted while the config is unresolved. Lock failures also name the lock path.

### D6: Windows is removal-only and preserves the cleanup answer

On Windows, `install()` runs exact released-entry cleanup. It returns `unsupported-platform` only when cleanup is complete. Unsupported/symlink config, unavailable lock, write failure, or remaining exact path is returned unchanged and surfaced; it is never replaced by a generic platform result.

No `.cmd` file is created, executed, or refreshed. This intentionally removes shipped Windows Cursor hook observability under the recorded waiver until a real Windows spike admits an inline generation.

### D7: The shipped Cursor lifecycle stays Cursor-specific

The existing `CursorHookController`, runtime, per-session URL/token contract, setting, config path, compare/retry, and atomic-replace mechanisms remain the implementation boundary. This change does not introduce `src/agentHooks`, a destination pointer, owner/lease state, or a general installer abstraction.

### D8: A live lock is never reclaimed by age

The existing 30-second mtime reclamation is deleted. Exclusive `open("wx")` acquisition remains bounded; a holder keeps authority until its own `finally` removes the lock, however long it is paused. Another host reports `lock-unavailable` rather than deleting a lock that may still be live.

A process crash can therefore leave a stale lock requiring removal/retry. That fail-closed operational cost is preferred to two concurrent config writers. The exact lock path is surfaced, and tests pause one holder beyond the former stale threshold to prove a second host neither mutates config nor releases the first lock.

## Failure Surface Inventory

| Resource | Writer / serialization | Crash or failure outcome | Failed-read policy | Two-host behavior |
|---|---|---|---|---|
| `~/.cursor/hooks.json` | Every cooperating extension host uses D8's exclusive sibling lock; compare-and-retry catches external writers | Before rename: old file intact. After rename: inline config committed for process-crash ordering; wrapper may remain | Malformed, unsupported, unreadable, or symbolic-link config fails closed without rewrite | Same lock serializes hosts; the second re-reads and converges to the same event-scoped entry |
| Config lock file | Exclusive `open("wx")`, bounded wait, no age reclaim | Normal exit removes it; process crash can leave a fail-closed stale file whose exact path is reported | Unexpected lock metadata/read errors never authorize deletion | A paused holder remains exclusive; waiters fail rather than mutate or release its lock |
| Released wrapper file | New code never writes it; only exact-path unlink under the config lock after commit | Crash before unlink leaves an unreferenced file; safe and retryable | `ENOENT` is clean; other errors retain and report the path | Cleanup stays under the lock; concurrent retries converge through `ENOENT` |
| Inline hook process | Cursor launches its hook shell; no extension-owned executable file exists | Every in-scope branch captures stdin, emits `{}`, exits 0; curl failure is ignored after bounded time | Missing trusted utility fails closed and does not consult inherited PATH | Per-invocation only; no shared mutable state |
| Loopback payload | Curl reads one captured JSON body and posts one request | Network work costs at most 1.5s; Cursor's handler timeout bounds the process to 2s | Invalid/non-loopback base URL sends nothing | Session URL/token isolation remains owned by `CursorHookRuntime` |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Frozen literal | One byte edit changes runtime behavior and ownership identity | D1 exact source literal, direct-shell controls, real Cursor Agent spike, append-only generation rule |
| URL authority | Prefix-only validation can encode userinfo and escape loopback | D2 field parsing plus curl protocol/glob/end-of-options guards |
| Shell ambient state | Exported functions, tracing, or closed stdout can hijack, expose, or terminate before drain | D1 disables xtrace/errexit, ignores PIPE, and removes invoked function names; D2 states the pre-command-code boundary |
| Curl ambient state | Proxy/config can exfiltrate raw payloads | D2 `--disable` first, `--noproxy '*'`, isolated proxy/curlrc controls |
| User config migration | Failure can disable a working released hook | D4 config-first ordering; failed reconciliation preserves fail-open executable bytes and revokes observability explicitly |
| Ownership | Broad candidates can delete user commands | D3 event + exact platform tuple; retained lookalike rejection table and explicit byte-identical waiver |
| Lock | Mtime reclaim permits concurrent writers | D8 removes age reclamation and tests a paused holder beyond 30 seconds |
| Windows | Untested inline bytes can be frozen as an invalid ownership key | D6 removal-only outcome-preserving path; no inline registration |
| Cleanup warning | A dead wrapper can hide behind successful install | D5 exact result schema and controller warning tests |
| Data scale | Event lists are fixed at 12; candidate commands are fixed at 2 per supported host | Constant bounded passes over the existing hook document; no new growing collection |
