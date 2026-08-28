# Audit — agent-hook recovery plan after round 18

Recorded 2026-08-28 at `f6822e8d` (`origin/main` `3ed52539`). This document
preserves the conclusion reached after `install-claude-hooks` cycle 9 / review
round 18. **Nothing here is implemented.** The active change is rejected and must
not be merged or have its specs applied in its current form.

## Executive decision

The recovery program has **three Asimov change boundaries**:

1. `inline-cursor-hooks` — mandatory; harden and migrate the Cursor hook that has
   already shipped. Independently mergeable into `main`.
2. `install-claude-hooks-v1` — mandatory; add Claude hooks with a deliberately
   smaller lifecycle contract after change 1.
3. `reconcile-moved-hook-configs` — separate, product-gated work for durable
   cleanup after a configuration destination moves. Do not create or implement
   it unless that guarantee is explicitly required.

Thus two changes are required to ship hardened Cursor + Claude v1. The third is a
real design boundary, not machinery to hide inside either shipping change. If the
product requires cleanup-on-move, all three are required; otherwise change 3 stays
unbuilt.

The existing `install-claude-hooks` change is superseded by this split. Preserve
its research and review history, but do not continue its review-fix loop or carry
its implementation wholesale into a replacement branch.

## Verified release boundary

The split is based on git evidence, not an assumption:

- `src/agentHooks/` does not exist on `origin/main`; none of its generalized
  installer, pointer, residue, or Claude code has shipped.
- The first `src/agentHooks` commit is dated 2026-08-27 on this change branch.
- v0.18.1 shipped only the Cursor installer under `src/cursor/`.
- The released Cursor installer writes
  `<globalStorage>/cursor-hooks/cursor-hook-observer.sh` on POSIX or `.cmd` on
  Windows and registers the quoted absolute path as `{command, timeout: 2}`.
- `anywhereTerminal.agentHooks.claudeConfigDir` has not shipped.
- The fixed `~/.anywhere-terminal/agent-hooks/*` paths were introduced only by
  the rejected change; no released user needs migration from them.

This means Cursor has a real compatibility boundary. Claude does not.

## Root problem in the rejected change

The change tried to preserve three guarantees simultaneously:

1. Find and remove entries from every historical configuration destination,
   including destinations no longer derivable.
2. Never remove a user-owned hook.
3. Carry no stable ownership or destination identity in the hook entry.

Those guarantees cannot all be satisfied. Exact byte equality cannot distinguish
an extension-written entry from a byte-identical entry a user wrote. Finding an
unknown old destination requires durable state; that state then needs a scope and
identity across profiles, windows, restarts, environment-derived paths, and
concurrent extension hosts.

The attempts to satisfy the contradiction produced the ledger → owner → lease →
pointer → residue sequence. Review findings moved with the mechanism rather than
converging. Recent blocker counts demonstrate the pattern rather than a normal
fix loop: rounds 11–18 reported 9, 8, 7, 3, 2, 0, 4, and 6 blockers respectively.

A correction to the discussion that led here: **keeping `claudeConfigDir` is not
expensive.** The inexpensive contract is merely resolution order:

```
extension setting → CLAUDE_CONFIG_DIR → ~/.claude
```

The expensive contract is the separate promise that changing the resolved
location must durably remember, sweep, and refuse to advance past the previous
location. Change 2 keeps the resolution feature and drops that cleanup-on-move
promise from v1.

## Change 1 — `inline-cursor-hooks`

### Goal

Secure and migrate the hook behavior that v0.18.1 actually shipped, without
waiting for Claude support or importing the rejected generalized lifecycle.

### Required scope

#### Darwin and Linux

- Replace the released wrapper registration with one frozen inline command.
- Resolve utilities independently of inherited `PATH` and fail closed rather
  than falling back to an untrusted binary.
- Drain stdin before a failed lookup exits, so the agent does not receive EPIPE.
- Disable curl ambient configuration and proxy routing. The literal must include
  the equivalent of:
  - `curl --disable` as curl's first option, preventing `~/.curlrc` / `CURL_HOME`
    configuration from being loaded;
  - `--noproxy '*'`, preventing `http_proxy` / `https_proxy` from carrying a
    loopback payload off-machine;
  - bounded connect and total timeouts.
- Spike the exact final bytes through real `cursor-agent` before freezing them.

Both proxy vectors were reproduced locally against the current frozen literal:
with `http_proxy` set, and separately with only `~/.curlrc` containing a proxy,
the local listener received nothing while the proxy received the full hook body.
A candidate using `--disable --noproxy '*'` sent the body only to the listener in
both probes.

#### Exact released migration

- Recognise only historical platform/path/quoting tuples a released build wrote.
- On POSIX that is the POSIX-quoted `.sh` path under the current Cursor
  `globalStorage/cursor-hooks` root.
- Do not generate the rejected cross-product of `.sh` and `.cmd` filenames with
  both quoting styles.
- Atomically replace the config entry first. Delete the legacy wrapper only after
  the inline entry is durable and the old command is absent.
- A wrapper command under a storage root no longer derivable is outside the
  claimable set. Do not guess or normalise it.

#### Windows

- Do not ship an inline literal that has never been executed by a real Windows
  Cursor agent.
- The accepted safe fallback is removal-only: remove an exact released
  registration and report the real outcome.
- Propagate `unsupported-config`, lock failure, write failure, symlink refusal,
  residue, and the unresolved path. Never discard the removal result and report
  only `unsupported-platform`.
- This temporarily removes Cursor hook observability on Windows and therefore
  requires an explicit release note / retained waiver. If that regression is
  unacceptable, the change blocks on a real Windows spike instead.

### Merge boundary

This change must branch from `main`, depend on no Claude setting or Claude
installer, pass its own verify/review gates, and can then merge and release
independently. The rejected `install-claude-hooks` branch is not the merge source.

## Change 2 — `install-claude-hooks-v1`

### Goal

Add the never-shipped Claude capability without inheriting Cursor migration or a
durable destination lifecycle it does not need.

### Required scope

- Keep `claudeConfigDir` resolution:
  `setting → CLAUDE_CONFIG_DIR → ~/.claude`.
- Snapshot one resolved path per operation so a single lock/read/write cannot
  cross destinations.
- Do not add `DestinationPointer`, owner, lease, previous-destination sweep, or
  residue-as-gate.
- A changed setting/environment installs at the newly resolved destination on
  reload/reconcile. v1 does not promise immediate or durable cleanup of a path
  that is no longer derivable.
- A stranded entry is inert when its coordinates are absent, matching the
  existing accepted requirement “An Unreachable Hook Costs The Agent Nothing”.
- `remove everything` covers exact-known entries at destinations derivable now;
  it does not claim unknown historical paths.
- Claude has no historical wrapper migration. Do not invent migration candidates
  for paths introduced only by the rejected branch.
- Use a separately frozen Claude literal with the same bounded transport
  hardening as change 1, and spike the exact bytes through real Claude Code.
- Darwin/Linux only until a real Windows spike exists. Unlike Cursor, no Claude
  registration has shipped on Windows, so there is nothing to sweep there.
- Reuse shared HTTP runtime/config primitives only where two concrete uses prove
  the common seam. Do not generalize Cursor's migration lifecycle into Claude's
  installer; their compatibility contracts differ.

### Review boundary

Review this as a new capability after change 1 is on `main`. Do not review it as
an incremental fix to the 1,605-production-line cycle-8 range.

## Change 3 — `reconcile-moved-hook-configs`

### Goal

Provide the guarantee deliberately removed from Claude v1:

> after a configuration destination changes, the extension can durably find and
> clean the previous destination across restart and concurrent extension hosts.

### Admission gate

Do not open this change merely to make internal cleanup feel complete. It needs a
product requirement with a concrete user-visible failure that inert stranded
entries do not already neutralize.

If admitted, it must design the isolation unit and state protocol from first
principles. Required questions include:

- What stable identity distinguishes profile, extension installation, window,
  environment-derived destination, and agent?
- Which simultaneous destinations are supported?
- How are concurrent writers synchronized across extension hosts?
- What happens when one host holds a stale cached view of shared extension state?
- What evidence authorizes removal without treating an ordinary user hook shape
  as ownership proof?
- What bounded inventory is retained, and when may it be garbage-collected?

Do not revive the rejected owner/lease/pointer design without answering these
questions and proving its state transitions.

## Round-18 disposition under the split

| Finding | Disposition |
|---|---|
| B42 — one globalState scalar cannot isolate divergent destinations | Eliminated from Claude v1; belongs only to optional change 3 |
| B43 — Windows discards removal outcomes | Fixed in change 1 |
| B44 — legacy wrapper deleted before durable replacement | Fixed in change 1 |
| B45 — historical command cross-product claims impossible entries | Fixed in change 1 |
| B46 — curl proxy variables leak loopback payloads | Fixed in changes 1 and 2; include `.curlrc`/`CURL_HOME`, not proxy env alone |
| B47 — pointer records a destination never written | Eliminated from Claude v1; belongs only to optional change 3 |
| W13 — shape-only residue matches ordinary user hooks | Removed; neither shipping change uses shape as ownership proof or move gate |
| W14 — residue is consumed as successful cleanup | Removed with residue state; change 1 reports concrete migration/removal failures directly |

## Oracle use

Do not request another open-ended architecture proposal. That repeats the failure
mode where an oracle optimizes inside an unchallenged premise and introduces more
machinery.

Use at most one bounded adversarial question per replacement plan:

- Change 1: “Enumerate every ambient input that can change which executable curl
  runs, where it sends the request, or what bytes it reads for this exact
  literal.”
- Change 2: “Give a concrete user-visible failure showing why inert entries at
  no-longer-derivable paths make the narrowed v1 contract unacceptable.”
- Change 3, if admitted: verify the complete identity/state-machine invariants,
  not individual implementation hunks.

## Next action

1. Mark the current `install-claude-hooks` effort superseded by this split; do not
   apply its specs or merge its implementation.
2. Plan and build `inline-cursor-hooks` from `main`; merge it independently.
3. Plan and build `install-claude-hooks-v1` from the updated `main`.
4. Open `reconcile-moved-hook-configs` only after explicit product admission.
