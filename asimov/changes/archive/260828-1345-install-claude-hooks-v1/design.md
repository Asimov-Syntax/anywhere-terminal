# Design: install-claude-hooks-v1

## Architecture

```text
Cursor setting ─→ CursorHookInstaller bridge ─┐
                                              ├→ AgentHookController
Claude setting ─→ ClaudeHookInstaller v1 ─────┘       │
                                                       ▼
                                      AgentHookRuntime + existing presence

ClaudeHookInstaller v1
  resolve one path → lstat → sibling lock → classified read
  → exact event-scoped sweep/add → compare → temp+rename → release lock
```

## Decisions

### D1: Runtime and installation stay separate

`AgentHookRuntime`, `AgentHookController`, `agents/cursor.ts`, and `agents/claude.ts` SHALL remain unchanged capability owners except for result plumbing required by installer outcomes.

The rejected mechanism lives in installation ownership, not event decoding, tokens, or presence. Claude v1 replaces `src/agentHooks/install/**` without reverting WT-006.1 or WT-006.3.

### D2: Merge the independently reviewed inline Cursor replacement

The temporary pre-d31 bridge is superseded by the completed `huybuidac/inline-cursor-hooks` change. This change SHALL merge that branch rather than reimplement its safety fixes. The reviewed inline implementation owns Cursor command bytes, exact historical migration, no-age locking, config-first wrapper cleanup, Windows removal-only behavior, direct runtime compatibility, and the real Cursor Agent spike.

Merge conflict resolution SHALL retain current local-main runtime/presence behavior and the Claude v1 implementation while taking the inline branch's Cursor-owned source, tests, spec delta, research, and verification harness. No second Cursor probe, wrapper-hardening path, or duplicate migration logic is introduced here.

### D3: One Claude path and identity are frozen per operation

`ClaudeHookInstaller.install()` and `uninstall()` SHALL each call the resolver once and thread that absolute settings path through classification, lock acquisition, identity-safe read, comparison, replacement, and diagnostics.

Resolution order is absolute configured directory, absolute `CLAUDE_CONFIG_DIR`, then `<home>/.claude/settings.json`. Invalid relative candidates fall through. Under the sibling lock, every existing path component and the final file are classified without following symlinks; a stable regular-file identity and its bytes authorize reconciliation. The replacement is staged first, then final component/parent identity and source bytes are revalidated immediately before commit. Any substitution or concurrent edit aborts and retries within the existing bound; missing-target publication must not overwrite a file that appeared after classification. Location changes converge the new destination on the next reconciliation; no state remembers the old one.

### D4: Canonical groups are the ownership boundary

The exact handler is `{type: "command", command: CLAUDE_HOOK_COMMAND, timeout: 2}`. A claim additionally requires one canonical singleton group under a registered event: `{hooks: [handler]}` for ordinary events or `{matcher: "*", hooks: [handler]}` for `PreToolUse`.

Install and removal may sweep duplicate canonical groups while preserving all unrelated group order. If the exact handler appears with sibling handlers, extra group keys, the wrong matcher, or under an unregistered event, reconciliation returns `ownership-conflict`, leaves the entire document byte-identical, and revokes authority. This refuses ambiguous user rearrangement rather than changing its matcher/group semantics.

### D5: Locking and temporary publication fail closed

A sibling lock acquired with exclusive `open("wx")` serializes cooperating hosts for at most one second of bounded waiting. No mtime or age permits reclamation. Compare-and-retry runs at most three times.

Replacement uses a cryptographically unpredictable sibling temporary name created exclusively with `open("wx")`; bytes and mode are written through that owned handle, and cleanup removes only that operation's file. The staged file is committed only after D3's final no-follow identity/byte validation. A pre-created path, symlink substitution, parent identity change, or concurrent source edit aborts without replacing user bytes.

Non-`ENOENT` lock-release failure preserves the committed install/remove boolean, reports `lock-release-failed`, and appends the exact lock path. Every failed operation also carries the exact affected settings path (and lock path when applicable) through controller diagnostics. Install may therefore grant runtime authority with a separate warning after the config committed; removal with unresolved paths remains unsuccessful at the controller boundary.

### D6: One in-memory queue owns current-setting transitions

Claude v1 SHALL delete the ledger, owner/lease records, destination pointer, pending residue set, historical sweeps, fixed wrapper, Windows probe, and startup ledger ordering.

A bounded per-agent queue rereads settings when each body begins. A location event executes disable → current setting value: false remains disabled; true installs at the newly resolved path, while the unknown old destination is untouched. Remove-all is ordered in the same queue, revokes before current-destination uninstall, and leaves the agent revoked until a later successful opt-in settings reconciliation. Racing events settle in queue order against values read at execution time.

### D7: The POSIX command is one frozen literal

Darwin and Linux SHALL register this exact shell program:

```sh
set +e +x 2>/dev/null; trap '' PIPE 2>/dev/null; unset -f command awk cat curl printf read 2>/dev/null || :; printf '{}\n'; payload=$(command -p cat 2>/dev/null) || { while IFS= read -r _; do :; done; exit 0; }; case ${CLAUDE_JOB_DIR:-} in '') ;; *) exit 0 ;; esac; url=${ANYWHERE_TERMINAL_CLAUDE_URL:-}; command -p awk 'BEGIN { u=ARGV[1]; if (u !~ /^http:\/\/127[.]0[.]0[.]1:[0-9]+\/[^\/?#]+\/[0-9a-f]+$/) exit 1; n=split(u,p,"/"); split(p[3],a,":"); port=a[2]+0; s=p[4]; if (n != 5 || port < 1 || port > 65535 || length(p[5]) != 64) exit 1; for (i=1; i<=length(s); i++) { c=substr(s,i,1); if (c == "%") { h=substr(s,i+1,2); if (h !~ /^[0-9A-F]{2}$/) exit 1; i += 2 } else if (c !~ /^[A-Za-z0-9_.!~*()-]$/ && c != sprintf("%c",39)) exit 1 } }' "$url" 2>/dev/null || exit 0; printf '%s' "$payload" | command -p curl --disable --silent --noproxy '*' --globoff --proto '=http' --output /dev/null --connect-timeout 0.5 --max-time 1.5 --request POST --header "content-type: application/json" --data-binary @- -- "$url/claude" 2>/dev/null || :; exit 0
```

It shares Cursor's proven transport controls but is a separate identity and command. Input is consumed before the background-job and coordinate guards. The validator admits exactly the decimal loopback port, one nonempty `encodeURIComponent` segment (including uppercase percent escapes), and the 64-lowercase-hex runtime token. Imported functions, inherited PATH, proxy variables, and curl startup files cannot alter managed execution.

`set +x` runs before payload expansion, but the first traced command and hostile `PS4` expansion occur before that control can take effect. Inherited pre-first-command tracing therefore sits beside startup/loader code outside the privacy boundary; tests may prove no payload expansion after entry, not that arbitrary inherited tracing is neutralized before entry.

### D8: Windows writes nothing

On Windows, Claude install and uninstall return `unsupported-platform` before path resolution or filesystem access. No `.cmd` or historical cleanup candidate exists because Claude hooks never shipped.

### D9: Controller authority and diagnostics follow settled outcomes

The generic controller SHALL retain per-agent serialization. Install/remove outcomes carry exact affected resource paths separately from unresolved cleanup residue. Installed config plus cleanup warning grants authority and logs once; failed install does not. Every warning merges the primary reason with exact settings/lock paths, including a failed operation whose lock release also left residue. Disable revokes immediately, and any removal result carrying unresolved paths remains unsuccessful.

The runtime remains registered for Claude so WT-006.3 assembly, turn-state, and pane cleanup invariants continue to execute.

### D10: Real Claude Code admits the final bytes

A bounded `.mjs` harness SHALL run the exact exported literal through installed Claude Code using a scratch project, an explicit settings file containing the exported bytes, and a uniquely tokened loopback recorder. Independent checked-in byte-count and SHA-256 expectations pin D7 before the import is used. User and local setting sources are excluded explicitly; excluded scratch sources contain sentinel hooks that must not fire.

Acceptance requires at least `SessionStart` and `Stop`, exit 0, byte-for-byte command equality in the loaded settings, unchanged scratch/user settings, the independent command hash/count match, observed shell/startup behavior, no sentinel event, and no payload-specific sensitive marker or field on stderr. The harness is task evidence, not part of the normal unit suite.

### D11: The rejected change is archived, never applied

The old `install-claude-hooks` artifacts SHALL move intact to the archive with an explicit superseded note and incomplete gates visible. Its delta is not applied. The aborted `remove-rejected-hook-installer` plan is likewise archived as implementation evidence that established the WT-006.3 dependency.

WT-006.2 is completed only by this v1 implementation; blueprint sync narrows installer sections without rewriting runtime/presence sections owned by WT-006.1/WT-006.3.

## Failure Surface Inventory

| Resource | Writer / serialization | Crash or failure outcome | Failed-read policy | Two-host behavior |
|---|---|---|---|---|
| Current Claude `settings.json` | Dedicated installer under D3/D5 identity-safe sibling lock | Staged exclusive temp commits only after final no-follow identity/byte validation | Malformed, unsupported, unreadable, symlinked, substituted, or concurrently edited paths fail closed unchanged with exact diagnostics | Cooperating hosts serialize; non-cooperating drift retries or fails without overwrite |
| Claude lock file | Exclusive create; owner releases after result | Process crash may leave a stale fail-closed lock; exact path reported | Unexpected errors never authorize deletion | Second host waits boundedly then reports residue |
| Prior Claude destinations | No writer or inventory | Existing development entries may remain inert | Never read unless currently derivable | Hosts share no historical state to race over |
| Cursor `hooks.json` and wrapper | Restored shipped installer bridge | Existing shipped behavior until inline change replaces it | Existing policy preserved | Existing bridge behavior preserved, not redesigned here |
| Managed hook process | Claude Code-selected shell executes D7 | Neutral output and exit 0; network bounded to 1.5 s within handler timeout 2 s | Invalid/missing coordinates or utilities drain and send nothing | Invocation-local; no mutable shared state |
| Loopback payload | Curl to one validated runtime coordinate | Failure discarded after bound; runtime retains no raw body after event decode | Invalid authority/path sends nothing | Per-pane token and entitlement remain runtime-owned |
| Rejected artifacts | Git archive only | Review/research history preserved with incomplete gates | Missing source blocks archive task | One branch performs forward move; no runtime coordination |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Claude settings | User keys/groups are reordered or deleted | D4 canonical-group identity plus byte-unchanged conflict tests over mixed/newer shapes |
| Destination change | One operation locks one path and writes another | D3 one resolver call per operation with call-count tests |
| Historical cleanup | State machinery recreates the non-convergent lifecycle | D6 hard deletion plus source absence checks |
| Lock | Paused live host loses ownership | D5 no age reclaim and two-host paused-holder test |
| Runtime authority | Installer failure still emits coordinates | D9 controller result tests and existing assembly invariants |
| Payload privacy | Proxy, curlrc, functions, PATH, or tracing leaks body | D7 managed-entry controls, explicit pre-entry tracing boundary, and D10 isolated real-agent spike |
| Background jobs | Inherited coordinates publish as the wrong pane | D7 consumes then exits on `CLAUDE_JOB_DIR`; real and direct tests |
| Windows | Untested bytes become a durable identity | D8 filesystem-zero unsupported path |
| Cursor regression | Shared deletion removes shipped writer or duplicates reviewed migration logic | D2 merges the independently reviewed inline Cursor branch and resolves only its integration seam with Claude v1 |
| Data scale | No growing destination inventory remains | Event set is fixed; config passes are bounded by existing file size and three retries |
