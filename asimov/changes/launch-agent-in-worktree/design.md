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
