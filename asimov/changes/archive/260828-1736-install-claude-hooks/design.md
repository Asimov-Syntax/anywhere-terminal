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

> **Superseded by D12** after review cycle 1. The reconciliation goal below still holds; the
> matching rule does not. Kept for the rationale D12 builds on.

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

### D12: Ownership is exact equality against a ledger of what we wrote, never a parse of the user's string

> **Amended by D15** after review cycle 2: the matching rule below stands; the ledger no
> longer lives in `globalState`.

**Supersedes D3's matching rule.** The extension keeps a persisted ledger: per agent, the
destination it is installed into, the exact command strings it has written, and any
destinations whose cleanup has not yet succeeded. An entry is ours **iff** its
command is byte-equal to one the ledger records. Nothing else is ever removed.

D3's premise — that we could recognise our own entry by looking at the command — survived
three revisions and failed each time, in a widening way. Round 1: `includes()` claimed
`not-cursor-hooks/cursor-hook-observer.sh`. Round 2: the single-token unquoter claimed
`'…/observer.sh'.bak`, which the shell actually executes as the `.bak` file. Round 3: the
first-word parser claimed a single-quoted POSIX path containing a literal backslash, because
`my\cursor-hooks` is one real directory that separator normalization splits into two. Each
fix was correct about the case it named. The pattern is the point: recognising an arbitrary
user-authored shell string requires reimplementing two shell grammars correctly, and the
failure mode is silently deleting configuration the user wrote.

Exact equality inverts the risk. A command we did not write is never claimed, whatever it
looks like. A command the user hand-edited is also not claimed — we decline to remove it,
which is the safe direction and visible to the user rather than silent.

The ledger keeps what D3 was actually for. A moved storage root still matches, because the
ledger holds the command as written, not as recomputed. It lives under `globalStorageUri`,
which is stable across extension updates.

Entries written by the shipped Cursor build predate the ledger. On first run with no ledger,
the extension seeds it with the exact command that build emitted for the current
`globalStorageUri` — a deterministic construction, not a search. A user whose ledger was
cleared keeps whatever we cannot prove is ours; the uninstall command reports it rather
than guessing.

### D13: One serialized transition owner per agent

Every change to an agent's hook state — enable, disable, destination moved — is one operation
on a per-agent serial queue. An operation reads the ledger, acts, and writes the ledger back;
no two operations for one agent ever overlap.

The listener was the defect, not the individual transition. Each configuration event started
its own unawaited async run, so a slow migration could reinstall after a newer event had
disabled, two rapid moves could let the older continuation win the destination record, and a
failed cleanup left a file installed that nothing remembered. Making one transition correct,
as round 2 did, does not make a sequence of them correct.

Destinations whose cleanup failed stay in the ledger's pending list rather than being
forgotten, and are retried on the next transition and at activation. That closes the
cross-restart stranding recorded as out of reach in cycle 1 — with the ledger it is reachable,
so it is no longer deferred.

The pending list is bounded, and reaching that bound **stops the move rather than dropping the
destination**. A stale destination that can neither be cleaned nor recorded leaves the agent
where it is: the record still names it, so uninstall can still find it, and the user is told
which path is holding the queue. The alternative — refusing to track it and letting the
transition continue — was tried in round 4 and loses a file we modified, because the next
`recordInstalled` overwrites the last record naming it. Freezing a location the user asked to
change is visible and recoverable; forgetting a config file we wrote to is neither.

### D14: One process-runner contract, absolute and cancellable

The probe runner takes an absolute executable path, contains `error` and `close`, owns exactly
one deadline, and terminates the process group before reporting. The injected-runner bound the
installer applies is strictly greater than that deadline plus its reap grace.

`spawn("taskkill", …)` searched the working directory before PATH — the same defect as the
unqualified `more` corrected in task 2_3, reintroduced two tasks later, which is what a
one-off spot fix buys. The spawned process also had no `error` listener, so a lookup or policy
failure escaped the surrounding `try`/`catch`. And the two deadlines were both 2,000 ms, so the
outer one resolved before the inner reap wait it was supposed to back up: the awaiting added in
round 3 never actually ran.

### D15: The ledger is a lock-protected file, not `globalState`

> **Amended by D16** after review cycle 3: the lock-and-atomic-rename discipline below stands;
> the ledger no longer lives under `globalStorageUri`, and the read rule below is tightened
> from "inside the lock" to "inside the lock, per operation".

**Amends D12's persistence.** The ledger is a JSON file beside the agent wrapper directories
under `globalStorageUri`, written through the same lock-and-atomic-rename discipline the
managed config already uses: acquire the per-ledger lock, read fresh under it, mutate, replace
atomically, release.

`globalState` is a per-window cache flushed back on update, not a store two extension hosts
share. Two VS Code windows both reconciling the same agent therefore hold independent
snapshots, and the later write replaces the whole entry — including a pending destination the
other window had just recorded. The config file's own lock does not help: it guards a
different path, and `recordPending`/`clearPending` run outside it. The failure is not a lost
preference but a lost record that cleanup is still owed, which is exactly what D13 relies on
surviving.

The same authority covers reads, and it covers them per operation rather than once per host.
A snapshot taken before the lock is stale by definition; so is one taken under the lock and
then reused, because another host may write between the read and the decision it feeds.
Every operation that freezes an ownership or destination inventory — a transition, an
uninstall sweep, an ownership test under the config lock — takes its own snapshot under the
ledger lock first. A host that loaded once at activation and answered from that view could
report a clean uninstall while a destination another window recorded still holds our entries.

Failure is read differently on each side of the configuration write, because the two sides
lose different things. **Before** the write, a record that did not reach durable storage stops
the installation: the alternative is a command in the user's file that no future session can
recognise, which is the unowned-entry outcome the whole ledger exists to prevent. **After** the
write the bytes are already on disk, so refusing helps nobody; there the written path is
recorded pending and the host keeps it in memory for the rest of the session, so this window
can still reconcile it even when nothing persisted. A session-only record is therefore a
fallback for what already happened, never a licence for what has not happened yet — and it is
never reported to a caller as a durable one. A caller that asks whether a destination is
tracked is asking whether it will survive this window, so the answer is the durability of the
write, not the outcome of the in-memory bookkeeping.

Session-only records merge back under the same ceiling that governs direct insertion. Folding
one host's unpersisted list into another's durable one without re-applying the bound is how a
capped list becomes an uncapped one, and the bound exists to keep cleanup work from growing
with history.

### D16: Ownership history outlives the root it describes

**Amends D15's location.** The ledger is not stored under `globalStorageUri`. It lives at a
fixed per-user path — `~/.anywhere-terminal/agent-hooks-ledger.json` — and only the wrapper
scripts stay under the extension's storage root.

`globalStorageUri` is stable across extension **updates**, which is what D3 established and all
that it established. It is not stable across a profile change, portable mode, or a move between
a local and a remote window. When it moves, the wrapper moves with it, so the command this build
writes changes — and if the ledger moved too, nothing left can recognise the command the
previous root wrote. That entry is then unowned: never swept, and re-appended beside its
replacement, so the agent fires both. A parser is not the alternative; that was settled in
cycle 1 and the reasons have not changed.

The rule this expresses is narrow: **a record of what we wrote must outlive every location it
describes.** The wrapper is a location, so the ledger cannot live inside it. Relocating the
wrapper as well was considered and rejected — it would make the command itself stable, but the
registered executable path is the security surface this change was reviewed on, and moving it
out of the extension's own storage means nothing reclaims it when the extension is uninstalled.

The consequence is that one ledger now serves every VS Code installation for this user. That is
correct rather than incidental: they already share the agent configuration files they write
into, so they should share the record of what was written there. Concurrency is already handled
— the file's lock is a cross-process one, and D15's per-operation read makes a second
installation's writes visible to the first.

### D17: A write is reserved before it happens, and the reservation is the record

**Superseded by D21 and D22 (round 11).** Reserving before writing was right and survives in D22.
What failed is everything it kept: the collection it bounded still admitted keys through the
session fold, so B10 reappeared for the third time. Retained here as the record of why the
reservation itself is not the missing property — the admission monopoly is.

**Amends D13's pending list and D12's command history.** One agent entry holds one collection:
the writes this extension has made, each keyed by the pair a write actually is — the canonical
configuration path, and the exact command put there.

Three round-9 blockers were three views of one defect: `destination`, `commands` and `pending`
were bounded independently while describing one fact jointly. Commands were capped at eight and
pending paths at sixteen, so a pending path could outlive the command identifying its entries —
after which ownership refuses it, cleanup reads `not-installed`, and the pointer to a file we
modified is dropped while our hooks keep firing (B17). One `destination` string cannot name two
configurations (B14). And folding one host's list into another's re-derived a ceiling from a view
missing whatever only the other host knew (B10).

**The ceiling governs reservations, and a reservation is durable before the configuration is
touched.** Installing takes four steps in this order: reserve the canonical `(path, command)`
durably, refused at the ceiling with the paths currently holding it; write the configuration;
finalize the same record; and only then report success. Session-only state may update a record
that already exists — that is D15's post-write fallback, and all it changes is a state — but it
may never introduce a key. So the collection has a real bound, not an admitted overflow: nothing
can enter it except through a reservation that was already refused if there was no room.

An earlier draft of this decision let the post-write fallback add records and called the result
"bounded by this session's post-write failures". That is not a bound — neither host count nor
failure count is limited — and it would have been the third failed attempt at this invariant
after round 4 and round 7. The reservation is what makes the bound structural.

`fold` merges by `(path, command)` identity with the session state winning, and never trims. Two
records differing only in state are one record, not two. A reservation left behind by a crash
before the configuration write is a prepared obligation: it consumes capacity, and it is safe to
clean because cleaning a path that has none of our entries is already a no-op.

### D18: A write is claimed by installations, not by a flag

**Superseded by D20 (round 11).** The claim set was an unbounded axis (B23) resting on a minted
identity that was never durably written (B22), and it still let the last writer sweep a peer at a
shared path (B19). D20 replaces coordination between installations with exclusion between them.

D16 made one ledger serve every VS Code installation for this user, and two installations may
legitimately point `claudeConfigDir` at different files. A single active/inactive flag cannot
express that: one host's previous destination, which it may clean, is indistinguishable from
another host's current destination, which it must leave alone. Converting today's inventory
directly — everything recorded except the caller's own path is stale — would have each
installation sweeping the other's live registration.

So each write carries the set of installation scopes claiming it. A write with no claims is
cleanup owed. A disable or a move releases **only the calling installation's** claim, and the
entries come out of the file only when the last claim is gone. "Remove everything" is the
deliberate exception: it clears every claim, because that is what the user asked for.

The scope id is minted once per installation and kept in `context.globalState`. Everything that
made `globalState` wrong for the ledger (D15) makes it right here: it is per-installation and
deliberately not shared, which is exactly what an installation identity has to be. Losing it —
a fresh profile — correctly reads as a new installation. It must not be derived from
`claudeConfigDir`, the wrapper root, or the ledger, since all three move for reasons that are not
a change of installation. The ceiling counts claims as well as records, so the claim set cannot
become a new unbounded axis.

### D19: Ownership is a path and a command, and unprovable history says so

**Superseded by D20 and D23 (round 11).** Its two halves failed differently. The pair as
*deletion* identity was right and is kept by D20 — but the implementation passed only a command
to the ownership test, so a command recorded at one path authorised removal at another (B20), and
pair identity alone never excluded two commands competing for one file (B19). The honest-migration
half was right in intent and lost its evidence in practice (B21); D23 makes it a contract.

Ownership answers `isOwned(path, command)`. The command-only fallback it replaces claimed
`seedCommand` whenever nothing was recorded, which is a condition an entry re-enters every time
it is cleaned — `recordRemoved` never consumed the seed — so the fallback re-armed permanently
and could eventually claim a byte-identical entry the user wrote themselves. The seed exists for
exactly one situation, an installation predating the ledger, so it is materialized once as a
concrete `(currentPath, seedCommand)` record before any sweep, and consumed. An entry that has
been cleaned is not an uninitialized one.

Records written in the previous shape cannot be converted faithfully, and this design does not
pretend otherwise: the old schema stored `destination`, `commands` and `pending` with no relation
between a path and the command written there, and a pending path whose command aged out of the
eight-command cap has no recoverable command at all. Producing every path × command pair and
calling them writes would state as fact something we do not know. Such a path is migrated as a
legacy obligation carrying whatever candidate commands survive, or none — and an obligation with
no candidate is surfaced to the user rather than silently dropped. A legacy obligation consumes
capacity and is not cleared merely because a sweep with its surviving candidates reported
`not-installed`, since that is the expected answer when the real command is the one we lost.

Activation reads authoritatively before anything reconciles. Installing first and loading after
let the initial install record against an empty view, overwriting the last record naming the file
the previous session wrote (B14). `load()` is best-effort and swallows read failures, so it is
not that authority on its own; the pre-write reservation is, and it takes the ledger lock.

### D20: A destination has one owner, and the owner is a place rather than an identity

**Replaces D18, and the ownership half of D19.** Five cycles tried to let two installations share
a configuration file safely, and each attempt moved the defect rather than closing it. This
decision stops trying. Exclusion is cheaper than coordination and it is the property the user
actually needs, because the failure being prevented — one installation deleting another's live
hook — is irreversible.

Two keys, deliberately different:

- **Deletion identity** is the exact `(canonical configuration path, command bytes)` pair. Every
  ownership check receives both. A command recorded at one path never authorises removal at
  another, which is B20.
- **Exclusivity** is keyed by `(agent, canonical configuration path)`. Pair identity alone is not
  enough: two *different* commands can still compete for one user file and the later one sweeps
  the earlier, which is B19. The destination is what has to be exclusive.

A record carries one scalar `owner`, never a claim set. One owner holds at most one lifecycle
record per agent — a second destination is a move (D21), not a second claim. No implicit takeover:
another owner may neither replace nor remove a record. There is no stale-owner reclamation, on any
timeout or heuristic — an abandoned owner keeps blocking until it is cleared exactly, because every
rule that decides someone else is "probably gone" is a rule that eventually deletes a live hook.
`AGENT_HOOK_UNINSTALL_COMMAND` (D9) stays the one deliberate exception and removes by exact
recorded pairs regardless of owner, because that is precisely what the user asked for.

**The owner is the canonical extension storage root** from `context.globalStorageUri.fsPath`,
stored directly or as a deterministic digest. Nothing is minted and nothing is kept in
`globalState`, which is what B22 was: an identity used before the write that created it had
settled, so two first activations could mint and use different ids. A physical root cannot be
lost between minting and use because it is never minted. This deliberately does **not** claim to
identify a VS Code profile — the API documents no such guarantee, and D18 assumed one. It
identifies the wrapper domain actually doing the managing, which is the thing that matters.

What this gives up, stated plainly rather than discovered later:

- Two installations cannot independently manage one configuration path. The second receives
  `destination-owned` and mutates nothing.
- Profiles sharing a storage root share one owner domain. Independent enable/disable between them
  is unsupported, and is documented as shared behaviour rather than left to surprise someone.
- A storage-root change is a new owner, not a transparent relocation: it yields `transfer-required`
  and the previous registration stays recorded and removable.

A refusal the user cannot act on is not a refusal, it is a dead end — the same reasoning that put
`blockedBy` on `at-capacity` in D17. So `destination-owned` names the holder and the route to
clear it. Without that, "no stale-owner reclamation" would strand a destination forever.

### D21: A record is a lifecycle state, not a history

**Replaces D17's collection and what remained of D13's pending list.** Every incarnation of this
model stored *what happened* and then tried to bound it. History has no natural bound, which is
why the ceiling had to be re-derived at every merge and why B10 survived rounds 7, 9 and 11.
Current recoverable state does have one: it is a single value.

Each owner record is exactly one of `prepared(target)`, `installed(current)`,
`moving(current, target)`, `removing(current)`, or a bounded `legacy` obligation (D23). A move
durably enters `moving` before either configuration is touched; the target is installed first and
the previous pair cleaned afterwards. If that cleanup fails the record stays `moving` and both
paths are surfaced; no further move is admitted until it resolves.

That window can leave two live hooks, and the agent then posts every event twice. This is
deliberate — bounded duplication is recoverable and silent forgetting is not — but it is a real
consequence, not a footnote: **WT-006.3 consumes these events, so its turn-state reducer must treat
a duplicate post as idempotent rather than as two turns.** The recovery set is fixed at two exact
pairs, so the duplication cannot compound.

**The session fold is deleted outright.** A durable reservation already contains everything needed
after a crash, so post-write processing may only advance an existing state. The fold was the hole
every bound leaked through.

Serialization reuses the accepted authorities and adds none: `createKeyedSerialQueue`
(`src/utils/keyedSerialQueue.ts`) keyed by agent for same-process work, then the ledger's
`LockedFile` (`src/agentHooks/install/lockedJsonFile.ts`) as the cross-process transition
authority, then configuration `LockedFile` locks taken in canonical path order while the ledger
transition is held. Path ordering is what keeps two agents touching two files from deadlocking.

### D22: Capacity is admission-only, and exactly two operations may create a record

**Keeps D17's reserve-before-write and drops everything it could not bound.** The bound is stated
as numbers rather than as a principle, because three rounds proved a principle is not checkable:

- 16 lifecycle records per agent.
- At most two exact pairs per record, and only while `moving` — so at most 32 pair slots per agent.
- A `legacy` obligation holds at most the shipped pre-D17 ceiling of 8 candidate commands, and
  consumes the same 16-record budget rather than forming a second collection to be merged.

`AGENT_HOOK_REGISTRY` (`src/agentHooks/install/agentHookRegistry.ts`) has two entries, so the whole
ledger holds at most 32 records.

**Exactly two operations may create a record**: the ordinary prepare/reserve transaction under the
ledger lock, and the one-time all-or-nothing migration of D23, which must prove its complete output
fits every bound before it writes anything. No catch path, session fallback, fold, finalizer,
reconciliation repair, or compatibility shim may introduce one. That monopoly is the property
missing from all three B10 appearances — each time, one more path could add a key.

Ordinary admission succeeds only when the operation is an idempotent retry, the owner has no
unresolved earlier lifecycle state, the destination is not held by another owner, and there is room
under the ceiling. At the ceiling, `at-capacity` carries the occupied paths and nothing is written.
A shared-path conflict returns `destination-owned` instead — capacity is not what is wrong, and
offering more of it would mislead.

### D23: Migration is lossless or it is refused whole

**Replaces the migration half of D19.** D19 said unprovable history should say so; the
implementation then dropped the candidate evidence and let a `not-installed` sweep report the path
clean, which is B21 — the user is told there was nothing to remove while our hooks keep firing.

Migration runs under the ledger lock and does not rewrite the previous bytes until the complete
conversion has been validated against every D22 bound. Where it is malformed, oversized, or over
capacity, the previous bytes are left untouched, the activation reports `migration-overflow` or
`migration-unresolved`, and **no user configuration is reconciled in that activation**. Refusing to
act is the only honest response to not knowing what we wrote.

Conversion rules, in order of what can be proven:

- Every non-empty exact `(path, command)` is preserved as positive evidence.
- `claims[]` is ignored. B22 makes those identities unreliable, and an unreliable identity is worse
  than none.
- `candidates[]` is preserved exactly within the 8 bound; a source exceeding it refuses the whole
  migration rather than truncating, since a truncated candidate list is indistinguishable from a
  complete one afterwards.
- For pre-D17 records the old `destination` plus the newest command is the only positive relation
  available; pending paths keep whatever commands survive as candidates.
- A path with no surviving command becomes an unresolved `legacy` obligation. It consumes capacity
  and is **never** cleared by `not-installed`, because that is the expected answer when the real
  command is the one we lost.
- Two live exact commands at one path produce `migration-conflict`. No winner is chosen
  automatically.
- The bootstrap-consumed marker is materialized and persisted whether or not the deterministic seed
  is found. D19 consumed it only on success, so an absent seed left the fallback armed to re-arm —
  the second half of B20.

A current owner may adopt a legacy record only when its own generated pair is byte-identical to the
recorded one and that exact entry is present at that path. Anything less is a guess.

What the user is told when we cannot prove it: that Anywhere Terminal can no longer prove which
command it previously wrote in that file, that nothing in the file was changed, that the hook may
still be active, and that it needs inspecting before automatic installation resumes. Any
acknowledge/forget affordance may discard the obligation after confirmation and must never mutate
the configuration.

### D24: A refusal keeps its detail all the way to the surface that can act on it

**Amends D13's transition contract.** The vocabulary already existed and was thrown away one layer
above where it was produced: `AgentHookController` reduced every installer result to
`{success, reason}`, discarding the `blockedBy` paths D17 added precisely so a refusal could be
acted on, and the transition then reported `reconciled: true` whether or not anything settled. A
move could therefore remove the old hook, fail to install the new one, and report success (B24).

The existing outcome union in `src/agentHooks/install/types.ts` is extended — not replaced, and not
joined by a second reporting mechanism — with `destination-owned`, `transfer-required`,
`migration-unresolved`, `migration-overflow` and `ledger-unavailable` alongside `at-capacity`. The
controller preserves the structured result, and `reconciled` is derived from the settled outcome
rather than from calls having been attempted.

Uninstall carries the same discipline in the other direction: it must require that the caller owns
the exact record before removing anything (B14), and `not-installed` is no longer folded into
success when an unresolved obligation remains (B21).

### Guarantee this design can honestly claim

Ownership is byte equality against a command we recorded writing. That refuses every lookalike:
a foreign root, a re-quoted equivalent, a suffix past the closing quote, our command as somebody
else's argument. What it cannot do is distinguish an entry this extension wrote from a
byte-identical copy the user wrote themselves — nothing in the document records provenance, and
D16 does not change that.

So the claim is **"never removes a non-identical lookalike or a command-edited entry"**, not
per-occurrence provenance. Stating the stronger version would be the same overreach the parsers
made. The weaker claim is still the one that matters, because the failure it prevents — silently
deleting configuration the user owns — is the irreversible one.

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
`HookInstallOutcome` / `HookRemoveOutcome` shapes. D24 widens their reason vocabulary and requires
`AgentHookController` to stop narrowing them — the shapes are reused, the pass-through is not
optional.

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
| Abandoned owner blocks a destination (D20) | An installation that vanished without clearing its record leaves a configuration no other installation can manage | Accepted deliberately: guessing staleness is how a live hook gets deleted. Mitigated by making it clearable — `destination-owned` names the holder and the route out, and the uninstall-everything command removes by exact pair regardless of owner; a test pins that the refusal carries both |
| Duplicate hooks during `moving` (D21) | A failed cleanup leaves old and new entries installed, so the agent posts every event twice | Bounded to two exact pairs and recoverable, which silent forgetting is not; the reducer WT-006.3 builds must be idempotent per event, and a test pins that a retried reconcile clears the previous pair rather than adding a third |
| Migration refusal blocks installation (D23) | An unprovable prior record stops hooks installing at all until the user intervenes | Fail-closed is the intended behaviour where we cannot prove what we wrote; mitigated by telling the user exactly what to inspect and asserting the configuration is byte-identical after a refused activation |
| Wiring (D8, D9) | A wrong settings key or an unregistered command fails silently at runtime | Manifest test asserts the declared keys match the ones read, both registrations reach the runtime, and the uninstall command is contributed and registered |
