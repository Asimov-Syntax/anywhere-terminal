# Design: inline-cursor-hooks

## Decisions

### D1: The POSIX registration is one frozen inline literal

Darwin and Linux SHALL register this exact shell program as the Cursor hook command:

```sh
printf '{}\n'; payload=$(command -p cat 2>/dev/null) || { while IFS= read -r _; do :; done; exit 0; }; case "${ANYWHERE_TERMINAL_CURSOR_URL:-}" in http://127.0.0.1:*) ;; *) exit 0 ;; esac; printf '%s' "$payload" | command -p curl --disable --silent --noproxy '*' --output /dev/null --connect-timeout 0.5 --max-time 1.5 --request POST --header "content-type: application/json" --data-binary @- "${ANYWHERE_TERMINAL_CURSOR_URL}/cursor" 2>/dev/null || true; exit 0
```

The source exports it as a literal, never reconstructs it from fragments, and a real `cursor-agent` spike executes these exact bytes before the generation is accepted. `printf` emits Cursor's neutral response immediately; stdin is captured before any URL/network decision so an early exit cannot leave the caller writing into a closed pipe.

### D2: The literal closes every identified ambient transport input

The command accepts only the runtime's `http://127.0.0.1:<port>/<session>/<token>` prefix, resolves `cat` and `curl` from the POSIX default path with `command -p`, and never falls back to inherited `PATH`.

`--disable` is curl's first argument so neither `~/.curlrc` nor `CURL_HOME` can add options. `--noproxy '*'` defeats `http_proxy`, `https_proxy`, `ALL_PROXY`, and their case variants. The URL is one quoted operand, redirects are not enabled, stdout/stderr are discarded, and connection/total time remain 0.5s/1.5s.

Direct-shell tests must include sensitivity controls: inherited fake binaries do run under the released form; proxy and curlrc sinks do receive the released payload; a process that exits without reading does produce EPIPE. Each control's hardened counterpart must show the opposite.

### D3: Ownership is exact and platform-historical

The managed entry shape remains exactly `{command, timeout: 2}`. Ownership requires both that whole shape and byte equality against the platform's closed candidate set:

| Host | Claimable commands |
|---|---|
| Darwin/Linux | D1 literal; POSIX-quoted `<current storagePath>/cursor-hook-observer.sh` |
| Windows | Windows-quoted `<current storagePath>\cursor-hook-observer.cmd` |

No filename/quoting cross-product, path normalization, substring match, marker, handler-shape inference, or stale storage-root guess is permitted. A future literal generation appends its predecessor to the explicit set.

### D4: Configuration replacement commits before wrapper cleanup

POSIX install holds the existing advisory config lock, compare-and-retries the supported document, atomically replaces exact managed/legacy entries with one D1 entry per event, and only then attempts to unlink the exact released wrapper.

```text
read + validate → exact sweep/add → atomic config replace → unlink old wrapper
        fail ───────────────────────────────┘ old command and file still work
                                                  unlink fail → inline works + reported dead-file path
```

Uninstall removes exact current/legacy entries first and deletes the wrapper only after the configuration is durably free of those entries. `ENOENT` is idempotent success. Any other unlink failure is reported with its exact path; no directory scan is performed.

### D5: Cleanup detail reaches the warning surface without revoking a successful install

Install/remove outcomes may carry exact unresolved paths. A POSIX install whose config replacement succeeded is successful even when deleting the now-unreferenced wrapper fails; the controller grants runtime authority and separately warns with the path.

Disable/remove succeeds only when the configuration and exact wrapper cleanup are both settled. An incomplete cleanup keeps runtime authority revoked and reports the underlying reason plus paths. `not-installed` means neither exact registration nor exact wrapper remains.

### D6: Windows is removal-only and preserves the cleanup answer

On Windows, `install()` runs the same exact legacy cleanup as disable. It returns `unsupported-platform` only when cleanup is complete. An unsupported document, unavailable lock, write failure, or remaining exact path is returned unchanged and surfaced; it is never replaced by a generic platform result.

No `.cmd` file is created, executed, or refreshed. This intentionally removes shipped Windows Cursor hook observability under the recorded waiver until a real Windows spike admits an inline generation.

### D7: The shipped Cursor lifecycle stays Cursor-specific

The existing `CursorHookController`, runtime, per-session URL/token contract, setting, config path, lock, retry, and atomic-replace mechanisms remain the implementation boundary. This change does not introduce `src/agentHooks`, a destination pointer, owner/lease state, or a general installer abstraction.

## Failure Surface Inventory

| Resource | Writer / serialization | Crash or failure outcome | Failed-read policy | Two-host behavior |
|---|---|---|---|---|
| `~/.cursor/hooks.json` | Every cooperating extension host uses the existing sibling advisory lock; compare-and-retry catches external writers | Before rename: old file intact. After rename: inline config durable; later wrapper cleanup cannot roll it back | Malformed, unsupported, unreadable, or symbolic-link config fails closed without rewrite | Same lock serializes hosts; the second re-reads and converges to the same exact entry |
| Config lock file | Exclusive `open("wx")`, bounded wait, stale timeout | Crash may leave a lock; stale reclamation is bounded by existing 30s policy | Unexpected lock metadata/read errors retry within the existing bound, then fail closed | One holder writes; others wait or report `lock-unavailable` |
| Released wrapper file | New code never writes it; only exact-path unlink after config commit | Crash before unlink leaves an unreferenced file; safe and retryable | `ENOENT` is clean; other errors retain and report the path | Concurrent unlinks converge through `ENOENT` |
| Inline hook process | Cursor launches `/bin/sh`; no extension-owned executable file exists | Every branch drains/captures stdin, emits `{}`, exits 0; curl failure is ignored after bounded time | Missing trusted utility fails closed and does not consult inherited PATH | Per-invocation only; no shared mutable state |
| Loopback payload | Curl reads one captured stdin body and posts one request | Unavailable listener costs at most 1.5s; body is not persisted or logged | Non-loopback/missing URL sends nothing | Session URL/token isolation remains owned by `CursorHookRuntime` |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Frozen literal | One byte edit changes both runtime behavior and ownership identity | D1 exact source literal, direct shell controls, real Cursor Agent spike, append-only generation rule |
| Ambient curl behavior | Proxy/config can exfiltrate raw payloads | D2 loopback shape, `--disable` first, `--noproxy '*'`, isolated proxy/curlrc tests |
| User config migration | Failure can disable a working released hook | D4 config-first ordering under existing lock and atomic replace |
| Ownership | Broad candidates can delete user commands | D3 explicit platform tuples and retained lookalike rejection table |
| Windows | Untested inline bytes can be frozen as an invalid ownership key | D6 removal-only outcome-preserving path; no inline registration |
| Cleanup warning | A dead wrapper file can be hidden behind successful install | D5 success + warning split and exact path in controller tests |
| Data scale | Event lists are fixed at 12; candidate commands are fixed at 2 per supported host | Constant bounded passes over the existing hook document; no new growing collection |
