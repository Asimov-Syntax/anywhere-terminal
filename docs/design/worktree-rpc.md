# Worktree Message Protocol Design

> **Ref**: docs/DESIGN.md § 8.2 — the "Message contract and validation" row
> **Consumer**: `asimov-plan` reads this to turn a PLAN.md task into spec deltas and builder tasks.

The messages the Worktree view exchanges with the extension host. Extends the existing
discriminated-union protocol in `src/types/messages.ts` (see
[message-protocol.md](message-protocol.md) for the protocol's shared rules) and follows its
established naming: `request<Thing>` from the webview, `<thing>Response` from the host,
imperative verbs for actions.

## 1. Overview

```mermaid
sequenceDiagram
    participant WV as WebView (Worktree view)
    participant EH as Extension Host
    participant GIT as git / SessionManager / vault

    WV->>EH: requestWorktreeTree
    EH->>GIT: resolve roots, list worktrees, project presence
    GIT-->>EH: tree + presence
    EH-->>WV: worktreeTreeResponse

    Note over EH: watcher fires (worktree added)
    EH->>GIT: rebuild affected repo
    EH-->>WV: worktreeTreeResponse (unsolicited push)

    WV->>EH: worktreeCreate { repoId, branch, path, ... }
    EH-->>WV: worktreeActionResult { ok | error }
    EH-->>WV: worktreeTreeResponse (post-action rebuild)
```

Two invariants carried over from the vault protocol:

- **The host owns freshness.** `worktreeTreeResponse` is sent both as a reply and unsolicited;
  the webview treats every arrival identically and never polls.
- **There is no single "the webview".** The vault panel is mounted in the same webview
  document as the terminals, and three surfaces load it — sidebar, panel, and editor — each
  with its own panel instance (`docs/DESIGN.md` § 8.6). Every push is a **broadcast** to all
  live surfaces, including the reply to a request that came from one of them, because they
  all render the same window-scoped truth. A surface whose Worktree view is not the active
  segment is skipped: all three retain their DOM while hidden, so an unfiltered broadcast
  pays render cost in panels nobody is looking at.

  Being skipped takes **two independent facts**, and neither stands for the other. The
  webview declares which body it is showing, via `worktreeViewVisibility` (§ 2.1). The window
  reports whether it is displaying that surface at all, which the webview cannot know:
  `retainContextWhenHidden` means a hidden surface keeps its DOM *and* its last declaration,
  so the declaration alone would stay true forever. The worktree body can be the shown body
  inside a panel the user has hidden, and a fully visible panel can be showing the sessions
  body — so a push goes only to a surface where both hold.

  Because a surface stops receiving while it is away, the moment it is displayed again is the
  moment it has to be current: that transition serves it **from the cache**, alone, without a
  rebuild. The watches keep running while it is away, so the cache already holds the answer
  a rebuild would go and re-read.
- **Actions on existing objects name ids, never paths.** Every action against a worktree that
  already exists names a `worktreeId` / `repoId` the host previously issued; the host
  re-resolves the path server-side from its own cache before touching git. A path in such a
  message is a UI hint at most — the same rule `VaultSessionEntry.sessionPath` already follows
  (`src/vault/types.ts:203`).
- **`worktreeCreate` is the one exception, necessarily.** It names a path for an object that
  does not exist yet, so there is no host-issued id to re-resolve it from. That path is
  **untrusted input**: canonicalized and validated host-side (§ 4), revalidated after any
  queue wait, and subject to the residual race documented in
  [worktree-create.md](worktree-create.md) § 6. An earlier draft of this document claimed
  webview paths are *never* action inputs; that claim was false for this message, and stating
  it absolutely would have hidden the only path-trust boundary in the feature.

> **Not in this protocol**: the worktree a surface has *selected*, and the tab-bar scope that
> selection drives, are webview-local per-surface state. Nothing about scope is sent to the host,
> and no handler here reads it — see [worktree-scope.md](worktree-scope.md) § 2.1.

## 2. Messages

### 2.1 WebView → Extension

| Type | Payload | Purpose |
|------|---------|---------|
| `requestWorktreeTree` | `{ force?: boolean }` | Ask for the tree. `force` bypasses the per-repo cache |
| `worktreeViewVisibility` | `{ visible: boolean }` | Declare whether this surface is showing the Worktree view. Gates every push to it (§ 1) |
| `requestWorktreeSubagents` | `{ rowId, entryId }` | Lazy subagent rows for one expanded agent row |
| `worktreeFocusPane` | `{ paneId }` | Reveal a window-scope pane. Rejected for external rows |
| `worktreeOpenFolder` | `{ worktreeId, mode: "newWindow" \| "addToWorkspace" }` | Open the worktree as a folder |
| `worktreeRevealInOS` | `{ worktreeId }` | OS file manager |
| `worktreeCopyPath` | `{ worktreeId }` | Copy the worktree path |
| `worktreeOpenTerminal` | `{ worktreeId }` | New terminal tab with cwd = worktree |
| `worktreeOpenPreview` | `{ rowId, entryId }` | Open the session preview overlay for an agent row |
| `worktreeResumeHere` | `{ worktreeId, entryId }` | Resume an existing session with cwd overridden to this worktree |
| `worktreeCopyResumeCommand` | `{ entryId, worktreeId? }` | Copy the resume command; the worktree scopes the cwd override when present |
| `worktreeLaunchAgent` | `{ worktreeId, agent, permissionChoiceId?, prompt? }` | Launch an agent in the worktree |
| `worktreeCreate` | `{ repoId, path, mode: WorktreeCreateMode, destination: DestinationDisposition, after: WorktreeAfterCreate, provision?: ProvisionSelection, migrateChanges?: boolean }` | Create a worktree. `mode` and `after` are **discriminated unions**, not flag sets — § 2.3 and § 2.6. `provision` names selections against a host-held offer and never carries command text (§ 2.4) |
| `worktreeCreateProbe` | `{ repoId, query: string, candidatePath?: string }` | Ask what a typed selection would resolve to. `candidatePath` carries an override so its disposition can be assessed too; omitted, the host assesses the derived candidate. Answered by `worktreeCreateResolution` |
| `worktreeRemove` | `{ worktreeId, force: boolean, fingerprint?: string, deleteBranch?: BranchDeleteRequest }` | Remove a worktree. `force` and `fingerprint` travel together or not at all — a force carrying no fingerprint authorizes nothing, and an unforced call carrying one is a payload the host never issued. `deleteBranch` is absent unless the user opted in against a proof (§ 2.5) |
| `worktreeRemoveAssess` | `{ worktreeId }` | Ask for the removal report without acting. Answered by `worktreeRemoveAssessment` |
| `worktreeLock` | `{ worktreeId, reason?: string }` | Lock a worktree |
| `worktreeUnlock` | `{ worktreeId }` | Unlock a worktree. Two messages rather than one `locked` flag: the verbs take different arguments and a boolean made the payload lie about which |
| `worktreePrune` | `{ repoId, confirmedCount: number }` | Prune stale registrations. `confirmedCount` is the number the user actually confirmed; the host re-counts before running and abandons the prune when the answer has moved |
| `requestWorktreeCreateDefaults` | `{ repoId, branch? }` | The destination this repo would use. Sent again whenever the branch settles, because the path is derived from it |

### 2.2 Extension → WebView

| Type | Payload | Purpose |
|------|---------|---------|
| `worktreeTreeResponse` | `{ tree: WorktreeTree, presence: WorktreePresence }` | The whole view state, always both halves together |
| `worktreeMutationResult` | `{ verb, repoId, worktreeId?, result }` where `result` is `{ kind: "ok", openFailed? }`, `{ kind: "error", message }`, `{ kind: "indeterminate", observed }`, `{ kind: "unavailable", unreadable }` or `{ kind: "blocked", worktreeId, fingerprint, blocker }` | Outcome of any mutating action, delivered to the SURFACE that started it. `unavailable` is not a failure — nothing was attempted, because what the action would affect could not be read. `openFailed` rides on a success: the worktree exists and the window did not open |
| `worktreeCreateDefaults` | `{ repoId, root, prefix, path, branch?, collidedWith? }` | The destination the create will actually use. `path` is free against BOTH the registry and the filesystem; `collidedWith` names the **last segment** of the unsuffixed candidate when it was taken — never a full path (§ 4.1). `branch` echoes the question, so a form can tell a current answer from one it has typed past |
| `worktreeCreateResolution` | `{ repoId, query, mode, occupiedCandidate?: { path, disposition }, freePath, blockedBy?: { ownerPath } }` | What the typed selection resolves to, echoing `query` for staleness. `occupiedCandidate` is the path the suffixing skipped and what was found there — without it, debris is invisible and recover is unreachable. `blockedBy` marks a branch checked out elsewhere: offered disabled, never submittable |
| `worktreeProvisionOffer` | `{ repoId, offerId, model: ProvisionModel, expiresAt }` | The provision model the dialog displays, and the id a create must cite (§ 2.4) |
| `worktreeRemoveAssessment` | `{ worktreeId, checks: RemovalCheck[], fingerprint, branchDelete?: BranchDeleteOffer }` | The removal report (§ 2.5) |
| `worktreeProvisionResult` | `{ worktreeId, steps: ProvisionStepResult[] }` | Per-step outcome after a create. Arrives after the create's own result — provisioning never changes whether the create succeeded |

```
WorktreeOpenAfter = "none" | "terminal" | "agent" | "newWindow" | "addToWorkspace"
```

`agent` / `permissionChoiceId` / `prompt` are required exactly when `openAfter === "agent"`,
and rejected otherwise — a launch payload attached to a non-launch mode is a caller bug, not
a field to ignore. The launch runs **after** the create succeeds and reuses the same path as
`worktreeLaunchAgent`; a launch failure is reported without rolling back the create
(see [worktree-create.md](worktree-create.md) § 6).

`WorktreeTree`, `WorktreePresence`, `WorktreeAgentRow`, `DelegationRoster`, `WorktreeSubagentRow` are defined in
[worktree-model.md](worktree-model.md) § 2 and
[worktree-agent-presence.md](worktree-agent-presence.md) § 2. This document does not restate
their fields.

**A delegation roster has no message of its own.** `requestWorktreeSubagents` is answered by
the next `worktreeTreeResponse`, whose presence half carries the roster on the row it belongs
to (`WorktreeAgentRow.delegations`). A separate reply would reintroduce exactly the split this
section's next paragraph forbids — a roster arriving for a row the webview's current presence
no longer holds, or holds under a different session. It also gives the host one publish path
instead of two, so a roster and the row it decorates cannot disagree.

**Tree and presence always ship together.** Two separate messages would let the webview
render an agent row whose `worktreeId` is not in the tree it currently holds. One message
makes that unrepresentable.

### 2.3 `WorktreeCreateMode` — a union, not flags

The five modes differ in what they *require*, so they are separate shapes. A flag set would admit
combinations that mean nothing, such as a base ref on a reuse.

```ts
export type WorktreeCreateMode =
  | { kind: "fresh"; branch: string; baseRef?: string }
  | { kind: "fresh-detached"; baseRef: string }
  | { kind: "reuse"; branch: string }
  | { kind: "reattach"; branch: string; repairPath: string; expectedOid: string }
  | { kind: "adopt"; branch: string; adoptPath: string; expectedBranchOid: string };

/**
 * What the destination already holds. Independent of the branch mode — an existing branch and a
 * debris-occupied destination can hold at once, which a fourth mode could not express.
 */
export type DestinationDisposition =
  | { kind: "free" }
  | { kind: "debris"; authorization: DebrisAuthorization };

/** Authorizes deleting exactly what the user was shown, at exactly the place they were shown it. */
export interface DebrisAuthorization {
  readonly path: string;
  /** Host-issued over the path and what was found there. Absent → the delete is refused. */
  readonly fingerprint: string;
}
```

`baseRef` is **structurally absent** from `reuse`, `reattach`, and `adopt`. The contractual-base rule
([worktree-create.md](worktree-create.md) § 2.1) is enforced by the type, not by a validator that
could be forgotten.

`reattach` and `adopt` are separate variants because git treats their starting states differently
and only one of them has a git command ([worktree-create.md](worktree-create.md) § 2.3, § 2.4).
Neither names a path to create:

| Variant | Path field | Guard | What the guard prevents |
|---|---|---|---|
| `reattach` | `repairPath` — the surviving directory whose administrative entry is stale | `expectedOid` — the **directory's** `HEAD` at resolution | Repairing a checkout that moved between resolution and submit |
| `adopt` | `adoptPath` — the surviving directory with no administrative entry at all | `expectedBranchOid` — the **branch tip** at resolution | Reconstructing `HEAD` at a commit other than the one the user was shown |

The two guards read different things and are named apart on purpose: reattach has a `HEAD` to
compare against, and adopt does not — that file is exactly what was lost, so the only OID it can
promise is the branch tip it is about to write into a new one.

`adopt` also carries a precondition no field can express: **no live worktree may hold the branch**.
Reconstructing an administrative entry bypasses the check `git worktree add` performs, and git
reports nothing when two entries claim one branch. The host verifies it against
`git worktree list --porcelain` before writing anything and refuses outright; there is no
confirmation path and therefore no authorization field to carry
([worktree-create.md](worktree-create.md) § 2.4).

### 2.4 The provisioning offer

```ts
export interface ProvisionSelection {
  /** From `worktreeProvisionOffer`. */
  readonly offerId: string;
  /**
   * Host-issued ids of the items the user left checked — entries, ports and setup steps in one
   * list, because every offered row is a checkbox and a caller should not have to know which
   * kind a row was. Never command text.
   */
  readonly itemIds: readonly string[];
}
```

Every selectable thing in a `ProvisionModel` carries an opaque host-issued `id`
([worktree-provisioning.md](worktree-provisioning.md) § 2) — entries, ports, and setup steps
alike. Ids are opaque and per-offer: they are not paths, and they are not stable across offers.

**The webview never sends what to run.** It sends which of the host's own offered items were
selected. A message carrying command text would make the webview the authority on what executes,
which is exactly the property the untrusted-provider-file model exists to deny
([worktree-provisioning.md](worktree-provisioning.md) § 4.0).

**Refresh, stated precisely.** The safety property is *never execute a model the user has not
seen* — not *never resolve again*, which would be impossible to implement. An `offerId` the host
no longer holds, or one whose provider files changed underneath it, causes the host to perform
**no create and no provisioning**, resolve a fresh model, present it, and require a **second
submission** against the new offer id.

### 2.5 Removal assessment and branch deletion

```ts
export type RemovalCheckOutcome = "passed" | "failed" | "unproven" | "notApplicable";
export type RemovalCheckClass = "refusal" | "confirmable" | "proof";

export interface RemovalCheck {
  readonly id: string;
  readonly cls: RemovalCheckClass;
  readonly outcome: RemovalCheckOutcome;
  /** How many, where the check counts something. Separate from `detail` — see below. */
  readonly count?: number;
  /** Bounded, already safe to render. */
  readonly detail?: string;
}

/** Present only when the merge proof passed. Absence is how "not offered" is expressed. */
export interface BranchDeleteOffer {
  readonly branch: string;
  readonly branchOid: string;
  readonly defaultBranch: string;
  readonly defaultOid: string;
}

/**
 * Echoes the offer the user acted on, in full. Both ref NAMES travel as well as both OIDs: an
 * OID pair alone does not prove the default branch the proof used is the one being verified now.
 */
export interface BranchDeleteRequest {
  readonly branch: string;
  readonly expectedBranchOid: string;
  readonly defaultBranch: string;
  readonly expectedDefaultOid: string;
  /** The assessment whose BranchDeleteOffer carried these values. */
  readonly fingerprint: string;
}
```

`count` is a field of its own rather than a number embedded in `detail`. The report renders a
magnitude inside its own element — "**7 untracked files** in the folder." — so a count that arrived
only as prose could be re-rendered only by parsing a number back out of a display string, which is
not a contract. `detail` stays what its name says: bounded text, already safe to render.

`notApplicable` is on the wire because the UI must not render it as `passed`
([worktree-removal.md](worktree-removal.md) § 2.2). `cls` travels with each check because the UI's
decision to show a typed confirmation depends on the class, and re-deriving that mapping in the
webview would put the safety rule in two places.

A `BranchDeleteRequest` whose OIDs do not match the current refs is refused. The removal still
stands: the two outcomes are reported separately.

### 2.6 What happens after the create

```ts
export type WorktreeAfterCreate =
  | { kind: "none" }
  | { kind: "terminal" }
  | { kind: "newWindow" }
  | { kind: "addToWorkspace" }
  | ({
      kind: "agent";
      /** Sequence the agent's start after the setup runner exits (create § 6). */
      waitForSetup: boolean;
    } & WorktreeAgentLaunchFields);
```

The agent fields live **only** on the `agent` variant, so a draft that chose "Nothing" is
structurally incapable of carrying an agent, a posture, or a setup gate. That is the wire
expression of the form rule that the agent block is absent unless the user asked for it
([worktree-create.md](worktree-create.md) § 4).

The variant **embeds `WorktreeAgentLaunchFields`** rather than redeclaring the agent, posture and
prompt. That interface already carries two staleness guards — `offerId`, quoting the agent list the
choice was made from, and `generation`, quoting the registration the worktree held when the row
rendered — and both are refused when absent rather than assumed current (§ 2.2). A variant that
listed only `agentId`, `permissionChoiceId` and `prompt` would refuse nothing the shipped shape
refuses, so the embedding is the contract and this paragraph is the reason.

## 3. Action semantics

### 3.1 Confirmation is a round trip against a host-issued assessment

A destructive mutation is never authorized by a client-side guess. The host produces the
assessment (§ 2.5), the user acts on **that**, and the request echoes its fingerprint.

- A removal with no fingerprint is evaluated fresh. Where it finds any confirmable-risk check
  failed or unproven, it returns the assessment with `blocked` and runs nothing.
- A removal carrying a fingerprint is re-assessed immediately before git. **Any change to the
  assessment re-prompts** — not merely a larger blocker set. The old "same or fewer blockers →
  proceed" rule cannot survive a model with four outcomes and three classes: a check moving from
  `failed` to `unproven` is neither larger nor smaller, and a proof moving from passed to unproven
  must withdraw the option it gated even though nothing about the removal got riskier.
- A fingerprint the host did not issue, or issued for a different worktree, authorizes nothing.

The legacy `WorktreeRemoveBlocker` boolean record is **retired** by § 2.5. It could not express
ignored content, proof-gated options, `notApplicable`, or a per-check class, and keeping both would
put the safety rule in two places that would disagree.

### 3.2 Every mutating action re-resolves before it runs

`worktreeId` → the host's cached `WorktreeInfo` → its `displayPath`. If the id is not in the
current tree (stale webview state after a rebuild), the action fails with a
"no longer exists — refreshing" error and the host pushes a fresh tree. No git command ever
runs against a path the webview supplied.

### 3.3 Actions rebuild afterwards — including when they fail

Every mutating action triggers an immediate forced rebuild of its repo and a push: on success,
on non-zero exit, **and on timeout**. Git mutations are not atomic, so a failure can still have
changed the repository ([worktree-actions.md](worktree-actions.md) § 3.6). When the rebuild
finds git's registration and the filesystem disagreeing, the result carries
`outcome: "indeterminate"` and an `observed` description rather than a clean error.

The watcher event still arrives and is debounced into the same rebuild window, so the user
sees one update, not two.

## 4. Validation

Applied host-side on every inbound message, before any git or shell work:

| Field | Rule |
|-------|------|
| `worktreeId` / `repoId` | Must be present in the current tree. Never used as a path directly |
| `fingerprint` | Must match a blocker set this host issued for this worktree; an unknown or expired one re-prompts rather than authorizing |
| `paneId` | Must name a live session in this window |
| `entryId` | Must resolve in the vault store; never used to open a path the webview supplied |
| `branchName` | Non-empty; passes `git check-ref-format --branch`; rejected if it starts with `-` |
| `baseRef` | Rejected if it starts with `-`; passed as a single argv token |
| `path` | Must be absolute after normalization; must not be inside any **linked** worktree of the same repo. A path inside the **main** worktree is allowed — that is where the default root lives ([worktree-create.md](worktree-create.md) § 3) — and must not be the main worktree itself. **Existence is mode-dependent**: it must not exist or be empty for `fresh` / `fresh-detached` / `reuse`; it must be the surviving worktree directory for `reattach` and for `adopt`; and it must hold non-git debris matching the `DebrisAuthorization` fingerprint when the disposition is `debris`. A blanket "must not exist" would make recovery unexpressible |
| `openAfter` | One of the documented modes. `agent` requires the launch fields; every other mode rejects them |
| `agent` | Must be a known `VaultAgentId` |
| `permissionChoiceId` | Must be one the registry declares for that agent |
| `prompt` | Bounded; delivered per the launch design, never concatenated into a shell string |
| `reason` (lock) | Bounded length; single argv token |

Every git invocation uses an **argv array**, never a shell string. The leading-`-` checks are
the argv-injection guard the research calls out for session ids
(`docs/research/20260822-orca-deep-dive/04-launch-resume-permissions.md` § 2) applied to the
same class of user-supplied tokens here.

## 5. Error Handling & Limits

| Condition | Behavior | Webview Result |
|-----------|----------|----------------|
| Unknown / stale `worktreeId` | Reject, force a rebuild + push | Inline error, tree refreshes under it |
| Validation failure | Reject before running git | Field-level error in the create form; inline error elsewhere |
| Git command non-zero exit | `outcome: "error"` with git's stderr, bounded and trimmed, plus a forced rebuild | Inline error showing what git said, tree refreshed under it |
| Git command timeout | Kill, forced rebuild, `outcome: "error"` or `"indeterminate"` per what the rebuild found | Inline error naming the observed state |
| Mutation partly applied | `outcome: "indeterminate"` with `observed` | Distinct from an error: says the repository changed |
| Blocked destructive action | `outcome: "error"` + `needsConfirm` | Confirmation dialog |
| Focus requested on an external row | Reject | Never reachable from a correct UI; treated as a bug, logged |
| Message arrives while the view is hidden | Processed normally | — |
| Push while the webview is disposed | Swallowed by the existing postMessage guard | — |

Git stderr is surfaced to the user rather than replaced with a generic message — git's own
errors ("is already checked out", "contains modified or untracked files") are the most useful
thing we can show, and hiding them would make the failure unactionable.

## 6. Edge Cases

| Condition | Behavior |
|-----------|----------|
| Two `requestWorktreeTree` in flight | Coalesced; one rebuild, one push |
| Window hides a surface that is showing the view | Pushes stop; the cache is served to it alone when the window displays it again |
| That re-show delivery is skipped or throws | The transition is not consumed, so the next report serves it |
| Action arrives during a rebuild | Queued behind it, then re-resolves against the new tree |
| `worktreeCreate` with a path that exists and is non-empty | Rejected in validation for every mode except `reattach` and `adopt`, and for any mode whose disposition is `debris` — those require it |
| `worktreeCreate` with `adopt` for a branch a live worktree already holds | Refused before any file is written. Git performs this check for `worktree add` and cannot perform it for a reconstructed entry (§ 2.3) |
| `worktreeCreate` citing an unknown or expired `offerId` | Refused with a fresh offer; never re-resolved and run |
| `worktreeRemove` with `deleteBranch` whose OIDs are stale | Branch delete refused; the removal itself is unaffected |
| `worktreeCreate` for a branch already checked out elsewhere | `worktreeCreateResolution` marks it `blockedBy` and the form cannot submit it; reaching git is a race, and git's message is surfaced verbatim |
| `worktreeRemove` on a `missing` worktree | Runs `git worktree remove`; git prunes the registration |
| `worktreePrune` with nothing to prune | Succeeds, no-op |
| `worktreeLaunchAgent` for an agent not installed | Fails with the launcher's existing not-found error |
| `requestWorktreeSubagents` for a row with no `entryId` | Ignored. An empty list would say the session delegated nothing, which is not what a row with no session to read means |
| `requestWorktreeSubagents` naming a session the row no longer has | Ignored — the host matches the request against the published row's own `entryId` |
| Duplicate `requestWorktreeSubagents` for one `(rowId, entryId)` | Ignored while a read is in flight and after one has landed; the roster is held under that pair, not under `rowId` |

## 7. Testing

### Test Cases

- [ ] `requestWorktreeTree` → exactly one `worktreeTreeResponse` carrying both halves
- [ ] Watcher-driven push arrives unsolicited and is handled identically to a reply
- [ ] Two concurrent tree requests → one rebuild
- [ ] Action with a stale `worktreeId` → rejected, followed by a fresh tree push
- [ ] `worktreeRemove` on a dirty worktree → `needsConfirm` with `dirty: true`, no git run
- [ ] Re-sent with `force: true` and a matching fingerprint while still dirty → runs; while now clean → runs
- [ ] Re-sent after a live agent appeared → `needsConfirm` again with a new fingerprint, git never runs
- [ ] Re-sent with a stale or unknown fingerprint → re-prompts rather than authorizing
- [ ] `busyAgents > 0` → refused with no confirm path at all
- [ ] Mutation that fails or times out → a rebuild is still pushed; a disagreeing state reports `indeterminate` with `observed`
- [ ] `worktreeRemove` on the main worktree with `force: true` → refused, `isMain: true`
- [ ] `branchName` of `-x` → rejected in validation
- [ ] `path` inside a linked worktree of the same repo → rejected; a path under the default root inside the main worktree → accepted
- [ ] `worktreeFocusPane` for an external row's identity → rejected
- [ ] Git exits non-zero → stderr reaches the webview, bounded
- [ ] `openAfter: "agent"` without the launch fields → rejected; launch fields with any other mode → rejected
- [ ] Create succeeds and the launch fails → result reports the worktree as created and the agent as not started; the worktree still exists afterwards
- [ ] Successful create → forced rebuild push, and the later watcher event does not cause a second visible update
- [ ] Every git invocation is an argv array (asserted by the command-runner spy)

---

> **Sync rule**: the § 1 diagram illustrates the representative flows, not every message.
> Every message name it does show must appear in § 2 with the same direction, and every
> *class* of flow in § 2 — request/reply, unsolicited push, action plus result — must appear
> in the diagram at least once.
> **Registry**: values this doc shares with others belong in [DESIGN.md](../DESIGN.md) § 10 — do not keep a second copy here.
