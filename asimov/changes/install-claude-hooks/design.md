# Design: install-claude-hooks

## Decisions

### D1: One managed-config reconciler, agents supply a document adapter

`CursorHookInstaller`'s lock, read-compare-write retry, atomic rename, wrapper creation, and
typed failure reasons move into a shared `ManagedConfigInstaller`. Everything that differs
per agent becomes an `AgentConfigAdapter` the installer is constructed with. No second
installer exists.

The shipped machinery is correct and hard-won — a stale-lock timeout, a three-attempt
compare-and-retry, mode-preserving atomic rename. Reimplementing it for Claude would fork
those guarantees, and the PLAN task names that as the failure mode. What genuinely differs
between the two agents is narrow and entirely about the document: where entries live, what
counts as a supported shape, and what an entry looks like.

```
ManagedConfigInstaller (lock · read classification · retry · atomic rename · wrapper · reasons)
    └── AgentConfigAdapter
         ├── cursorConfigAdapter   hooks.json      flat entries under version:1
         └── claudeConfigAdapter   settings.json   entries nested in matcher groups
```

### D2: The adapter validates every structural container, and nothing below it

`isSupportedDocument` is adapter-owned. Cursor keeps requiring `version === 1` plus an object
`hooks` map. Claude requires, in order: a plain-object root; `hooks` absent or a plain
object; every event value an array; every matcher group a plain object carrying an array
`hooks`; every handler a plain object; `matcher`, when present, a string. Anything else is
`unsupported-config` and the file is left byte-for-byte alone.

Claude's `settings.json` carries the user's `permissions`, `env`, `model`, and anything a
newer CLI added, and has no `version` field at all, so the shipped check would reject every
real Claude settings file. But validating only "object of arrays of objects" stops one level
too early: entries live inside matcher groups, verified against this repo's own
`.claude/settings.json`, where `SubagentStart` is `[{matcher, hooks: [{type, command}]}]`. A
document like `{"hooks":{"Stop":[{"hooks":"broken"}]}}` would pass the looser gate and be
rewritten — silently repairing a file we were asked not to touch.

The gate stops at containers deliberately. Handler objects keep unknown keys and unknown
`type` values, because Claude's handler schema is extensible and freezing it here would make
a newer CLI's settings unsupported. See
`docs/research/20260827-claude-code-hooks-settings-schema.md`.

### D3: A managed entry is identified by its extension-owned directory suffix, not a bare filename

`isOwnedEntry` matches the managed entry shape plus a command whose path ends with the
extension-owned pair `<agent>-hooks/<agent>-hook-observer.<ext>`, compared on a normalized
path. It does **not** match a bare filename appearing anywhere in the command. The current
exact-string match narrows to this for Cursor too.

An earlier draft justified this by claiming the script path moves on every extension update,
citing § 4.7. That premise is false for this codebase: `src/extension.ts:128` puts the
wrapper under `context.globalStorageUri`, which is keyed by extension identity and is stable
across version upgrades — it is `extensionUri` that moves, and we do not use it. § 4.7's
rationale is therefore wrong about our implementation and should be corrected at blueprint
sync.

The decision survives the correction on a narrower basis. The storage root does move — across
VS Code profiles, between a local and a remote/WSL window, and if we ever relocate the
directory — and an exact-string sweep cannot recognise its own stale entry in any of those
cases: it leaves the dead entry in place and appends a second one. Suffix matching recognises
it, removes it, and re-appends the current command, which is what makes install idempotent
and convergent by construction with no separate migration step.

Matching on the directory pair rather than the filename is what keeps the sweep bounded: a
user's own `cursor-hook-observer.sh` in some other directory is preserved, because ownership
is the extension-owned directory, not the name.

### D4: Claude's config directory resolves setting → environment → default

`anywhereTerminal.agentHooks.claudeConfigDir` when non-empty, else `CLAUDE_CONFIG_DIR` when
set, else `~/.claude`. The file is `settings.json` inside it.

Straight from § 4.7. The environment variable is read at resolution time rather than
captured once, so a user who changes it and reloads the window gets the new location.

### D5: Symlink refusal lives in the shared layer, ahead of the lock

Before acquiring the lock, the installer `lstat`s the resolved config path; a symbolic link
returns `unsupported-config` and nothing is read, written, or locked — including the lock
file itself.

§ 4.3 and § 7 both require it and neither agent has it today, so implementing it once in the
shared layer fixes Cursor in the same stroke. Ahead of the lock because a lock file created
beside a symlinked config is itself a write into a directory we have decided not to touch.

### D6: Claude is transport-only in this task; the reducer is WT-006.3

`claudeAgentRegistration()` registers slug `claude` and env var
`ANYWHERE_TERMINAL_CLAUDE_URL`, and its session accepts and drops every payload without
publishing state.

WT-006.2's Design Ref is § 4.3, § 4.7, § 6, § 7 — installation, settings, edge cases,
security. The event→turn-state table is § 4.4, which is WT-006.3's ref and depends on the
roster work. A registration must exist regardless: without it the runtime answers `bad-path`,
no `ANYWHERE_TERMINAL_CLAUDE_URL` is minted, and the controller's `isAgentRegistered` guard
refuses authority. Publishing a coarse state invented here would be a mapping no design owns
and WT-006.3 would immediately have to unpick. Authentication, entitlement, dedup, and
containment all run before the session sees a body, so swapping the drop-only `handle()` for
the real reducer later touches neither transport nor configuration.

### D7: Registered event set

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `Stop`, `StopFailure`,
`SubagentStart`, `SubagentStop` — per § 4.4. `PreToolUse` carries `matcher: "*"`; the rest
carry no matcher.

Registering the full set now, while D6 leaves the reducer unwritten, means WT-006.3 needs no
config rewrite and no second pass over the user's file. Claude ignores event names it does
not know, so an unrecognised name costs a user on an older build nothing.

### D8: Both new keys are `machine`-scoped, matching the shipped key

`anywhereTerminal.agentHooks.claude.enabled` and `anywhereTerminal.agentHooks.claudeConfigDir`
are both declared `machine`, not the `application` scope § 4.7 tabulates.

The shipped `anywhereTerminal.cursorAgent.hooks.enabled` is `machine`, and § 4.7 itself
insists that key must not change under the user. Three sibling keys governing one feature
with two different sync semantics is worse than one deviation from the table. `machine` is
also the defensible scope for both: enablement installs a script at an absolute path into a
config file on *this* machine, and `claudeConfigDir` names a directory that need not exist on
another machine at all — syncing either would register or search a path that is not there.
§ 4.7's scope column should be corrected to `machine` at blueprint sync.

### D9: Uninstall is a command over every agent, independent of settings

`anywhereTerminal.agentHooks.uninstall` calls every registered adapter's removal path
directly, not through the controller's desired-state reconcile, and reports per-agent
outcomes. One agent's failure does not stop the other.

Routing it through the settings would make "remove everything" mean "set two booleans false
and hope the reconcile wins the lock", and would leave entries behind for an agent whose
setting is already false — which is the exact case a user hits after disabling the setting
and finding the config still modified.

### D10: A read is classified, and only a missing file may be created

`readConfiguration` returns a discriminated result — `missing`, `document`, or `unsupported`.
Invalid JSON, a non-object root (`[]`, `null`, a scalar), and an unreadable file are
`unsupported`; only `ENOENT` is `missing`, and only `missing` may seed a fresh document from
the adapter's `createInitialDocument()`.

The shipped read collapses a parse failure and a non-object root into `{}`
(`CursorHookInstaller.ts:229-237`). Cursor survives that only because its shape gate demands
`version === 1` and `{}` fails it. Claude has no such field, so under D2 an empty object is a
perfectly valid settings document — and the collapse would turn a user's malformed
`settings.json`, holding their permissions and env, into a fresh file containing nothing but
our hooks. That is the byte-for-byte refusal in the spec being violated by a read-path
detail, and it is why the classification is a decision rather than an implementation note.

The ENOENT seed must also be adapter-owned: `{version: 1, hooks: {}}` is Cursor's document,
not Claude's.

### D11: The wrapper becomes executable before it is reachable

The wrapper is written to a temporary file in the extension-owned directory, `chmod`ed, then
renamed into place.

The shipped order writes the canonical path first and `chmod`s after
(`CursorHookInstaller.ts:139-146`), leaving a window where the agent can find the script
non-executable and the hook silently fails. Rename is atomic, so the canonical path is never
observable in the wrong mode.

## Interfaces

```ts
export type ConfigRead =
  | { kind: "missing" }
  | { kind: "document"; contents: string; document: JsonObject; mode?: number }
  | { kind: "unsupported" };

export interface AgentConfigAdapter {
  /** Absolute path to the agent's configuration file. */
  configPath(): string;
  /** Extension-owned directory + wrapper filename; together they are managed-entry identity (D3). */
  wrapperLocation(platform: Platform): { directoryName: string; fileName: string };
  /** Rejects a document this agent's installer must not merge into (D2). */
  isSupportedDocument(document: JsonObject): boolean;
  /** Seeds a document for a config file that does not exist yet (D10). */
  createInitialDocument(): JsonObject;
  /** Adds or refreshes the managed entry for every registered event; false when nothing changed. */
  applyManagedEntries(document: JsonObject, command: string): boolean;
  /** Removes entries owned by this extension, matched per D3; false when none were present. */
  removeManagedEntries(document: JsonObject, isOwned: (command: string) => boolean): boolean;
  /** The script the agent runs. */
  wrapperScript(platform: Platform): string;
}
```

`ManagedConfigInstaller` keeps `install()` and `uninstall()` returning the existing
`HookInstallOutcome` / `HookRemoveOutcome` shapes, so `AgentHookController` needs no change.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Malformed config (D10) | A parse failure rewritten as a fresh document destroys the user's permissions and env | Classification is the fix; tests assert invalid JSON, `[]`, `null`, and a scalar root each return `unsupported-config` and leave the file byte-identical, for both adapters |
| Cursor entry matching (D3) | Narrowing exact-match to suffix-match could sweep an entry the user wrote | Ownership is the extension-owned directory pair, not the filename; a test pins that a same-named script in another directory is preserved and that a stale entry under the owned directory is swept |
| Cursor regression from extraction (D1) | Behaviour-preserving refactor of a shipped security-relevant component | Cursor's existing installer tests move with it unchanged and must stay green; emitted wrapper bytes pinned by a test, as WT-006.1 had to verify by hand |
| Claude settings merge (D2) | A gate that stops too early rewrites a structurally broken file | Container-level validation with a rejection test per level (event value, matcher group, `hooks` array, handler, `matcher` type) |
| Symlink refusal (D5) | Refusing ahead of the lock changes the failure ordering for Cursor | Returns the existing `unsupported-config` reason rather than a new one; test asserts refusal leaves no lock file behind, on install and uninstall |
| Wrapper mode window (D11) | A hook firing mid-install finds a non-executable script | chmod before rename; the canonical path only ever appears complete |
| Managed entries per event | Entry count grows with the registered event set, bounded by D7's eight events; re-append after filter keeps it at one per event | Idempotence test: installing three times leaves exactly one managed entry per event |
| Config file size | Read whole, parsed, rewritten whole on every reconcile | Bounded by the agent's own settings file, which is user-authored and small; no growth axis this change introduces |
| Wiring (D8, D9) | A wrong settings key or an unregistered command fails silently at runtime | Manifest test asserts the declared keys match the ones read, both registrations reach the runtime, and the uninstall command is contributed and registered |
