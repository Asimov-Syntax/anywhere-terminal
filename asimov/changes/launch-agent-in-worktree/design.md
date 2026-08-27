# Design: launch-agent-in-worktree

The blueprint for this change is `docs/design/worktree-actions.md` § 3.2 / § 4 and
`docs/design/worktree-rpc.md` § 2 / § 4. This file settles only what those leave open.

## Decisions

### D1: The registry declares `startCommand`; the launcher never assembles one

`AgentVaultDefinition` gains an optional `startCommand: CommandTemplate`. An agent without one
is not a launch target, exactly as `continueCommand` already gates Continue.

`resume` / `fork` / `continue` all describe *returning to* a session, and `continue` throws
`no-prompt` without one — none of the three can express "start fresh here, maybe with a
prompt". Declaring it per agent keeps `LaunchBuilder` the only expander of argv and stops two
callers inventing two start APIs (worktree-actions.md § 4).

```ts
// src/vault/types.ts
startCommand?: CommandTemplate;      // may carry a PromptFragment
```

Whether an agent can be seeded is not a second declaration: it is `startCommand.args` containing
a `PromptFragment`. One fact, one owner — a separate `promptDelivery` flag could contradict the
template it describes.

Per-agent values (registry.ts) — the same argv as `continueCommand` plus a permission posture,
with the prompt made optional:

| Agent | Start argv |
|---|---|
| claude | `claude [--permission-mode <p>] [<prompt>]` |
| codex | `codex [-a <a> -s <s>] [<prompt>]` |
| opencode | `opencode [--prompt <prompt>]` |
| cursor | `cursor-agent [--mode plan\|--force] [<prompt>]` |

### D2: The prompt is an argv fragment, so absence is representable

`CommandTemplate.args` gains a third member kind alongside `string` and `FlagFragment`:

```ts
export interface PromptFragment {
  prompt: true;
  /** Flag emitted ahead of the text, e.g. opencode's `--prompt`. Positional when absent. */
  flag?: string;
}
```

`expandArgs` drops the fragment when no prompt is supplied. The existing `{{prompt}}` string
token stays for `continueCommand`, where a prompt is mandatory — that path is unchanged. A
sentinel empty string would have shipped a bare `""` argv token to every agent that got no
prompt, which claude reads as an empty first turn.

**A single argv token stops shell injection, not option parsing.** Claude, codex and cursor take
the prompt positionally alongside their permission flags, so a prompt of `--force` or
`--dangerously-bypass-approvals-and-sandbox` would silently replace the posture the user picked.
The guard is the repo's own `readsAsFlag` (`src/worktree/worktreeMutations.ts:26`), already used
for branch names and lock reasons: a prompt that reads as a flag is refused before any spawn.
A `--` separator is not used, because the reference implementation sets `argvPromptSeparator`
only on the agents that need it and none of ours are among them — emitting it unverified would
make the prompt an argument these CLIs do not expect.

### D3: Native prefill only; the pty-write path is deferred to the blueprint

Every agent that can be seeded declares a `PromptFragment` in its `startCommand`. `VaultLaunchTarget`
gains `canSeedPrompt: boolean`, derived from that template, and the panel offers a prompt field
only where it is true. No agent is written to by pty in this change.

`docs/design/worktree-actions.md` § 4 asks the launcher to fall back to a pty-write path with a
readiness declaration when an agent has no native prefill. All four registry agents accept a
prompt as argv, so that writer would ship a render gate, a bracketed-paste chunker and a
readiness subscription (`docs/research/20260822-orca-deep-dive/05-prompt-injection.md` § 1) with
zero consumers and no way to test it against a real agent.

Declaring a one-member `promptDelivery` union instead would be worse than either: a seam with no
alternate branch, no readiness data, and nothing to dispatch on. So the deferral is recorded
where deferrals live — `docs/PLAN.md` § Deferred, at Blueprint Sync — rather than disguised as a
capability. `canSeedPrompt` is the part that is load-bearing today, because without it the
panel cannot tell which agents may be offered a prompt at all.

The reference implementation splits the same axis per agent
(`orca/src/shared/tui-agent-config.ts` — `promptInjectionMode: 'argv' | 'flag-prompt' |
'stdin-after-start' | …`, consumed by `tui-agent-startup.ts`), and its no-prompt launch is an
explicit `allowEmptyPromptLaunch` branch rather than an empty argument. Claude and codex are
`argv` there and opencode is `flag-prompt`, matching D1's table; every agent it delivers by pty
is one this registry does not carry.

### D4: `cwd` is an explicit launch override, not a new mode

`VaultLauncher.resolve` and `LaunchBuilder.build` take an optional `cwd`. When present it wins
over `entry.cwd`; when absent, `cwdPolicy: "preserve"` behaves exactly as today.

A fresh start has no entry to override, so it does not go through `build` at all: `buildStart`
is a separate entry point taking the agent id and the directory directly. Synthesizing a
`VaultSessionEntry` to reach `build` would put a fabricated session id and empty captured flags
into a code path whose whole job is honouring them.

This is what makes "resume this session in *that* worktree" expressible with the existing
resume template, instead of a fourth mode duplicating it (worktree-actions.md § 4, last line).

### D5: Launch targets reuse the existing `requestVaultLaunchTargets` pair

The message gains `capability?: "continue" | "start"`, defaulting to `"continue"` so the
Continue dialog is untouched. `detectContinuationTargets` generalizes to
`detectLaunchTargets(capability, deps)`, filtering on the declared command for that capability.

The reply already carries what both dialogs need, and `ContinueDialog` already renders postures
from it. A second worktree-specific pair would duplicate the detection probe and the payload for
no new content.

Two corrections the reuse forces:

- **The reply echoes `capability`.** The two questions return different agent sets, and
  `src/webview/main.ts:768` currently hands every `vaultLaunchTargets` to `vaultPanel`. Without
  the echo there is nothing to route on, and a `"start"` answer would populate the Continue
  dialog. `main.ts` routes `"continue"` to the vault panel and `"start"` to the worktree
  controller.
- **The wire shape drops `args`.** `AgentPermissionChoice` carries the argv a posture
  contributes; the webview only ever sends the posture's `id` back. The message carries
  `{ id, label, dangerous?, canSeedPrompt }` and the host resolves argv from the registry by id,
  so host-only launch mechanics stop crossing the boundary.

### D6: Starting a pane is a surface capability, mirroring `openTerminal`

```ts
// WorktreeSurface
launchAgent?(options: CreateSessionOptions): Promise<void>;
```

`WorktreeActions` cannot hold it for the same reason `openTerminal` is not there: creating a
pane is `createSession(viewId, webview, …)` and only the provider that built the surface holds
both. The host still resolves *which* worktree and *which* agent; the surface receives values,
never ids (D2 of the shipped worktree design). A surface without it offers no launch — which is
what makes the editor surface truthfully agentless.

### D7: One agent box, two dialogs

The create form's agent/posture/prompt block moves to `src/webview/worktree/worktreeAgentBox.ts`
and is mounted by both `WorktreeCreateDialog` and a new `WorktreeLaunchDialog`. The hardcoded
three-posture `PERMISSIONS` constant in the create dialog is deleted: postures come from the
chosen target and change with it.

Splitting the block is the only way "create then launch" and "launch here" can be the same
path rather than two implementations of one contract (worktree-actions.md § 3.2).

### D8: A failed launch after a create reuses `openFailed`

`worktreeMutationResult`'s `{ kind: "ok"; openFailed?: string }` already means *the worktree
exists and the after-create step did not happen*, and the panel already renders it as a
warn-toned success naming the reason. The launch failure rides that field; no new result shape,
no rollback.

The field is **not** renamed to `afterCreateFailed`. `docs/design/worktree-rpc.md` § 2.2 today
documents it as "the window did not open", which is narrower than what it now carries — so the
protocol doc's wording is broadened to "the after-create step did not happen", and a launch
failure is wrapped as `Agent did not start: <reason>` so the panel's notice reads correctly
without the identifier moving. Renaming a shipped protocol field would touch six source files,
their tests and the doc to buy a better name for the same contract.

### D9: The agent list stays shaped per repo

`WorktreeCreateDefaults.agents` keeps its per-repo shape and receives the same host answer for
every repo. Availability is host-global today, but the type, the fixtures and the dialog's
repo-switch rebuild all already assume per-repo, and flattening them buys nothing this change
needs.

### D10: A launch is one immutable intent, minted by the host and re-checked at handoff

Rounds 1-4 fixed three symptoms of one defect: a value read on one side of an `await` and
trusted on the other. Round 1 added admission, round 3 added an offer id, round 3's extension
moved where the incarnation is read — and round 4 still found the offer read from live state
(B1), the incarnation read after admission (B5), and the incarnation not being an identity at
all (B6). Patching the next occurrence is not converging, so the launch becomes one object
instead of a sequence of independent reads.

**What the intent contains** — `{ offerId, worktreeId, generation, agent, permissionChoiceId?, prompt? }`.
The host mints `offerId` and `generation`; the webview mints nothing and quotes both back.

**Where each half is captured.** The offer id and the generation are captured together with the
agent list and the worktree row the dialog RENDERS, at the moment it opens, as one frozen
object. The context menu captures the same way, when the menu is BUILT — every other value its
items act on is already captured there, and the generation must be too, because excluding it
from the render signature means the tree can move under an open menu without repainting it
(round-7 B5). Submission reads only that object. Capturing at submit — or reading the controller's
current field, as the code does now — is what lets a refresh landing under an open dialog
relabel an old choice as current.

**What `generation` is.** A monotonic counter per repository, owned by `WorktreeCache` and
advanced on every authoritative apply of that repository. It is not derived from git state:
`head:branch` collides across a remove-and-recreate onto the same commit (round-4 B6), and the
admin directory is no better — git reuses `.git/worktrees/<name>` after deletion, as
`worktreeFingerprint.ts` already documents. The cache advances the counter because it cannot
prove an entry is the same registration, which is exactly the honest claim.

**The cost, and why it is accepted.** A launch spanning an authoritative rebuild of its own
repository is refused. Rebuilds are not driven by working-tree watches — `worktreeWatchTargets.ts`
watches main `HEAD`, the `worktrees` admin directory, linked admin entries and linked `HEAD`
only — so ordinary editing never triggers one. What does: a git structural change, a
checkout/reset, an explicit refresh, or a concurrent worktree mutation. Those are precisely the
moments when refusing is the wanted answer, the exposed window is admission plus executable
resolution, and the user retries immediately. Scoped per repository, never the global
`treeVersion`: an unrelated repository rebuilding must not refuse this launch.

**A retained listing carries no token at all.** The cache keeps the last-good worktrees when a
listing fails, because dropping to zero would read as "the user deleted these". That is right
for display and no basis for authority: those registrations were not observed. So a retained
apply publishes NO generation, which does both halves of the job — an intent quoting the old
number stops matching, and a new one has nothing to quote. Advancing the number instead would
have done only the first while minting fresh authority over registrations nobody looked at
(round-5 B7). Being unwatched is different: that listing WAS read, it may merely go stale
unnoticed, so it is an annotation on the repository rather than a re-listing of it, and it
keeps its token.

**Degradation is two claims, and three consumers wanted different ones.** `WorktreeRepo.degraded`
was carrying "this listing failed" and "this repository is not being watched" in one string,
which lost the second on every repo-scoped rebuild and let each overwrite the other. They are
now stored apart and composed only for display. The authority consumers — launch admission, and
the two removal bindings that judge whether a listing can be relied on — ask the registration
token instead, which is absent exactly when a listing was retained rather than read. So a
watcher that cannot be established no longer vetoes a removal, and a listing failure is no
longer described to the user as a future watcher limitation (round-7 W8).

**One seam owns the sequence.** `admitLaunch` becomes synchronous — it performs no I/O today
despite being `async`, and that gratuitous promise boundary is B5 — and returns the admitted
intent rather than a boolean, so a caller cannot check one value and act on another. This is
the shape `matchedRow` already uses for session rows — and a resume quotes its registration for the same
reason a launch does: it is raised on a rendered row, and the row can outlive the worktree
under it (round-5 B5). Immediately before the surface handoff
the worktree is re-resolved and the generation required to match; the path used is the one that
re-resolution returned, never one captured earlier.

**Create-then-launch is deliberately outside the generation guard.** The offer is validated
before git runs, as it is today, and no registration token is required for the worktree —
because there is nothing to quote: the create names a path that does not exist yet, and the
launch is handed over inside the same mutation body as the `git worktree add` that made it.

Gating it on the created record's generation was implemented and withdrawn: the host only
learns a new registration from a rebuild, and the rebuild that follows a create does not
reliably report the worktree the create just made — settling it before the launch still left
the created path absent from the tree, so the guard refused real launches. A guard that refuses
the ordinary path is worse than the exposure it closes, and that exposure is one executable
resolution over a directory the user just asked to be created. What protects this path instead
is the pairing rule and the pre-create offer admission that already exist. The menu and
resume paths, where the user picks an existing worktree from a rendered list, are what rounds
1-4 found defects in, and they are guarded.

Rejected: a persisted per-worktree UUID (orca's `instanceId`,
`orca/src/shared/worktree/meta-types.ts:16-20`) is stronger lineage, but it is authoritative
only if its lifecycle is inseparable from the git registration — persisted in extension state
it cannot see an external delete-and-recreate between observations, and writing a marker into
git's admin directory is intrusive for a launch guard. Inode plus birth time was rejected as a
first implementation: platform-varying, inodes are reused, and it still needs the generation as
its fallback.

### D11: An unwatched repository keeps launch authority; an unobserved one does not

Round 5 accepted B7 as "refuse new registration admission while the containing repository or
global git state is degraded". Implementing that literally disabled the feature, and the
assembly walk proved it: `degraded` carries two unrelated claims.

| Claim | What produced it | Were the registrations observed? |
|---|---|---|
| "this listing failed, I am showing what I had" | `applyRepo` with a degraded listing | **No** — retained, not read |
| "this repository is not being watched" | `reconcileWatches`, after a watcher failed to establish | **Yes** — the rebuild that just ran read it |

Only the first is a reason to withhold authority. The second says future changes may go
unnoticed, which is a statement about the future, not about what was read.

**Options considered**

- **A — refuse on any `degraded`.** What round 5's wording asks for. Every launch is refused on
  any host where file watching is unavailable; `extension.worktreeAssembly.test.ts` is exactly
  such a host and every launch case in it failed. The capability would simply not exist there.
- **B — split the two claims (chosen).** A retained listing publishes no registration; an
  unwatched one keeps its own, and `markDegraded` exists so the annotation cannot travel the
  retain path by accident.
- **C — re-list the repository at admission.** Superficially the strongest, and it collapses:
  the token means "I re-observed", so re-listing always advances it, so the quoted value never
  matches and every launch refuses. Identical outcome to A, at the cost of a git call.
- **D — refuse when unwatched and not re-observed within some window.** Needs a clock and an
  arbitrary constant, and still cannot distinguish a replacement from quiet.

**What B accepts.** On an unwatched repository the host's view can be stale without the host
knowing, so a quoted registration can be current and wrong. That ceiling is not the launch
guard's to raise: the guard can be no fresher than the tree it reads, and the panel already
tells the user that repository may be out of date. Refusing would remove the capability without
making anything more correct — the user cannot launch, and the stale tree is just as stale.

The guard's actual claim is therefore narrower than "the worktree is the one you picked". It is
"the host has not observed a change to it since you picked it", which is exactly what the
generation records, and is the strongest claim any listing-derived identity can make.

### D12: One predicate — "this repository was observed" — authorizes both a launch and a removal

Round 8 refused to verify `711c9cf` because it changed what authorizes a destructive removal,
which is a different boundary from what authorizes a launch, and round 7 never approved it. The
refusal was right, and it caught a regression: launch admission checks `tree.gitAvailable` AND
the registration token, while the two removal readers I changed check only the token — and the
cache still publishes a token for a repository re-listed before git became unusable. Removal
would have been authorized on an unusable git, which is strictly worse than what it replaced.

**What each authority actually needs.**

| Reader | Question it is really asking |
|---|---|
| launch admission | were these registrations observed, so the one I quote still means something? |
| `mutationBindings.isDegraded` | can I judge what a removal did by comparing listings? |
| `observeAfter`'s `listingDegraded` | same, after the attempt |

All three want "this repository's listing was READ, by a usable git" — and none of them wants
"a watcher could not be established", which says nothing about whether the listing was read.
Including the watcher in the removal predicate was never a safety margin; it was noise that
happened to point the conservative way, and it disabled removal on watcher-less hosts for no
reason a user could act on.

**The decision.** One claim, minted where it is known and read everywhere: a repository publishes
a registration token only when its own listing was observed by a usable git. Absence therefore
means "not observed", and every authority asks exactly that.

- Withdrawn where a repository's listing was retained rather than read.
- Withdrawn for EVERY repository while git itself is unusable, including one whose repo-local
  apply landed before git went away — the same reasoning the cache already applies to the
  degradation it shows the user, now applied to the authority it grants.
- Not withdrawn for an unwatched repository, whose listing was read (D11).

**What removal loses and gains.** It no longer refuses on a watcher failure, so worktrees can be
removed on hosts without file watching. It now refuses while git is unusable, which it did only
incidentally before, through a degradation string that a more specific reason could displace.
Both the pre-removal assessment and the post-attempt classification read the same claim, so a
removal cannot be authorized under one reading and classified under another.

## Interfaces

```ts
// src/vault/types.ts
export interface PromptFragment { prompt: true; flag?: string }
// CommandTemplate.args: Array<string | FlagFragment | PromptFragment>

// src/vault/registry.ts
export type LaunchCapability = "continue" | "start";
export function detectLaunchTargets(
  capability: LaunchCapability,
  deps?: AgentDetectDeps,
): Promise<VaultLaunchTarget[]>;

// src/vault/LaunchBuilder.ts — fresh start: no entry, so not `build`
export function buildStart(
  agent: string,
  cwd: string,
  hostEnv: Record<string, string | undefined>,
  opts: { permissionChoiceId?: string; prompt?: string; executable?: string; contextTag?: string },
): LaunchSpec;

// src/vault/VaultLauncher.ts
resolve(entryId, mode, prompt?, target?, cwd?): Promise<CreateSessionOptions>;
startAgent(agent: string, cwd: string, opts: { permissionChoiceId?: string; prompt?: string }):
  Promise<CreateSessionOptions>;
```

Messages (`src/types/messages.ts`):

| Type | Payload |
|---|---|
| `requestVaultLaunchTargets` | `{ capability?: "continue" \| "start" }` |
| `vaultLaunchTargets` | `+ { capability }`; each target `+ { canSeedPrompt }`, minus each posture's `args` |
| `worktreeLaunchAgent` | `{ worktreeId, agent, permissionChoiceId?, prompt? }` |
| `worktreeResumeHere` | `{ worktreeId, rowId, entryId }` |
| `worktreeCreate` | `+ { agent?, permissionChoiceId?, prompt? }`, required iff `openAfter === "agent"` |

`worktreeResumeHere` carries `rowId` as well as `entryId` because every existing agent-row
action resolves through `matchedRow(rowId, "entryId", entryId)` — the request's id is an
expected-version token, not an argument.

## Architecture

```mermaid
sequenceDiagram
  participant W as Worktree panel
  participant H as WorktreeHost
  participant S as Surface (provider)
  participant L as VaultLauncher
  W->>H: requestVaultLaunchTargets {capability:"start"}
  H-->>W: vaultLaunchTargets {targets}
  W->>H: worktreeLaunchAgent {worktreeId, agent, posture?, prompt?}
  H->>H: resolve worktreeId → path (own tree); validate agent/posture/prompt
  H->>L: startAgent(agent, path, …)
  L-->>H: CreateSessionOptions
  H->>S: launchAgent(options)
  S->>S: createSession + tabCreated
```

Create-then-launch is the same tail: `worktreeMutationService` runs the create, then calls the
same `afterCreate` hook it already owns, which routes `openAfter: "agent"` into the launch
above and returns the failure text as `openFailed`.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `expandArgs` | A third fragment kind breaks resume/fork/continue expansion | The fragment is inert unless a prompt is supplied; existing `LaunchBuilder.test.ts` / `LaunchBuilder.command.test.ts` are the regression net, task 2_1 adds the absent-prompt case |
| Prompt payload | Unbounded text crosses the webview→host boundary | Bounded host-side by the existing `MAX_CONTINUATION_INSTRUCTION` (4000), rejected beyond it (worktree-rpc.md § 4) |
| Launch targets | Executable probe per request | List is bounded by `VAULT_AGENT_IDS` (4 agents, fixed); the panel asks once per dialog open, not per rebuild |
| `worktreeLaunchAgent` | A path supplied by the webview reaches a spawn | The message carries no path; the host resolves `worktreeId` against its own tree via the existing `actionPath` helper |
| Create-then-launch | A launch failure rolls back a good worktree | D8 — reported as `openFailed` on a success; no rollback path exists |
| Two entry paths | Menu launch and create launch diverge | D7 (one dialog block) + one assembly test per entry path in `src/extension.worktreeAssembly.test.ts` |
| Posture selection | A dangerous posture becomes the initial value | The box selects the first non-`dangerous` choice; asserted per agent in the box's own test |
| Prompt text | A flag-shaped prompt replaces the chosen posture | D2 — `readsAsFlag` refuses it before any spawn; a `--force` prompt is a named test case in task 2_1 |
| Launch-target reply | A `"start"` answer populates the Continue dialog | D5 — the reply echoes `capability` and `src/webview/main.ts` routes on it |
| Standalone launch | A failure ends in a `console.warn` and nothing on screen | Task 3_2 posts the failure to the asking surface; `WorktreeHost.perform` swallows by design, so the launch does not use it |
