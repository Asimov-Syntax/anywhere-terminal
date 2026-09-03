# Design: allocate-and-name-ports-before-they-collide

> External behavior → specs/worktree-panel/spec.md. Authority for apply ordering and the lock boundary: [worktree-apply.md](../../../docs/design/worktree-apply.md) § 1, § 2.3.

## Architecture

```mermaid
sequenceDiagram
    participant Form as Create form
    participant Host as WorktreeHost
    participant Create as Mutation service
    participant Lock as Common-git-dir lock
    participant Claims as Sibling claim files
    participant New as New .env.worktree

    Form->>Host: open repository
    Host->>Claims: best-effort preview scan
    Host->>Host: probe 127.0.0.1:0
    Host-->>Form: host-held offer with NAME=preview
    Form->>Host: selected opaque ids
    Host->>Create: resolved entries + ports
    Create->>Create: copy, then link
    Create->>Lock: acquire exclusive bounded lock
    Lock->>Claims: fresh git listing + strict reads
    Lock->>New: read and authorize existing file
    Lock->>Lock: reuse or probe distinct values
    Lock->>New: staged create/replace
    Lock-->>Create: per-name results + release warning
    Create-->>Form: create success, then provisioning result
```

## Decisions

### D1: The preview is a best-effort reading; the locked pass is authoritative

Every model the host issues — the initial provider and a provider selected later in the same opening — gets its own preview pass before `offers.issue`, at most once for that offer. The pass scans the worktrees the host currently knows, reads valid claims within the preview budget, and probes literal `127.0.0.1:0`. It sets `ProvisionPort.port` only when it obtains a number; a failed or incomplete preview leaves the number absent and keeps Create enabled.

The create does not redeem that number as a reservation. It carries the host-held `ProvisionPort` values to the mutation service so the authoritative result can compare the written value with the preview without another store. Sibling claim churn does not invalidate the offer; a changed value is an expected result and is reported.

### D2: One extracted lock implementation serves file locks; the port transaction uses it in the common git directory

`LockedFile` moves from `src/agentHooks/install/lockedJsonFile.ts` to `src/utils/lockedFile.ts`; the old module re-exports it so the hook installer and its regression suite keep the same API. The class is not JSON-specific and already provides:

- bounded exclusive acquisition with `open("wx")`;
- fail-closed contention with no age-based lock stealing;
- inode-checked release that cannot unlink a substituted successor;
- exclusive staged creation and same-directory atomic replacement.

The port transaction constructs a sentinel under the normalized common git directory already carried as `repoId`, then runs the fresh sibling read, choice, and `.env.worktree` publication inside `withLock`. A lock timeout fails every selected port and leaves the successful create standing.

A crashed process may leave the lock pathname. It is not reclaimed by age because Node cannot distinguish a dead owner from a live process paused past a TTL on every platform. Later attempts fail within the lock's existing bound until that administrative lock is deliberately removed. A release failure after values were committed does not relabel them failed; it adds a batch warning that future allocation may be blocked and logs the exact lock path host-side.

Orca, cmux and t3code were checked for the contested mechanism. Orca independently resolves the common git directory and uses an OS lock for cross-process installation; none contains a reusable Node port-claim allocator. This repository's `LockedFile` is therefore the reusable implementation.

### D3: One strict grammar defines both claims and configured names

A claim file accepts blank lines, comments, and assignments matching:

```text
[A-Za-z_][A-Za-z0-9_]*=[1-65535]
```

Any other non-blank line, any repeated assignment name, any repeated numeric value, a symlink, or a non-regular file makes that file untrusted, matching the owning specification. An untrusted sibling file makes every fresh allocation fail closed because the claimed set is incomplete. An untrusted file in the new checkout is not replaced; every selected name is reported failed.

Selected rows are grouped by exact configured name. One unique name gets one allocation/reuse decision and at most one assignment; every selected opaque id carrying that name receives the same result. An invalid configured name fails only its group.

### D4: Existing assignments win only when they do not collide

A valid assignment already in the new checkout is reused when no sibling claims its value. A file that already assigns one numeric value to two names is invalid under D3 and is left untouched; for a valid file, each retained value enters the local claimed set before missing names are allocated.

If a sibling already claims that existing value, retention wins: the assignment is left byte-for-byte unchanged and the selected name is reported failed. The allocator neither adopts the collision as success nor replaces a value the checkout already carried. This satisfies both accepted rules: existing values are never overwritten, and the allocator never hands out or successfully adopts a sibling's claim.

### D5: Fresh allocation is bounded and probes IPv4 exactly

Inside the lock, the allocator re-lists worktrees from git rather than using the host cache. Fresh allocation proceeds only when that listing is complete: no degraded result, skipped record, parser reason, or path-normalization omission. It excludes the new worktree from the sibling scan, collects every valid numeric claim regardless of variable name, and fails fresh allocations if the listing or any registered existing sibling cannot be read safely.

Each missing unique name binds `127.0.0.1:0`, reads the assigned port, closes the server, and rejects values in the claimed set. A successful value is inserted into that set before the next name. Attempts are bounded per name and by one transaction deadline; one exhausted name returns `failed` and the remaining names continue.

The normalized model caps all offered rows at 200. Claim scanning additionally caps the number of sibling files and bytes per file; exceeding either cap fails fresh allocation rather than ignoring claims.

### D6: The claim file is preserved, re-authorized, and published through the existing staged writer

The new checkout's `.env.worktree` is opened no-follow as a regular file. Its final identity, mode, and bytes are retained. Missing successful assignments are appended to those exact bytes; existing lines are never rewritten or reordered.

Immediately before commit, the writer rechecks the final path's type, identity, mode, and contents. A mismatch aborts the write and turns only the not-yet-persisted names into failures. An absent file uses `StagedReplacement.commit("create")`, whose hard-link publication cannot overwrite a file that appeared. An existing authorized file uses `commit("replace")`, whose same-directory rename publishes the complete old-plus-new contents atomically. A failed commit leaves the prior path standing.

The common lock completely serializes extension processes. No stronger claim is made against an unrelated editor changing the path in the final syscall window; the immediate recheck narrows that window and a detected change fails closed.

### D7: The local exclude file gets its own lock and the literal file pattern

`gitExclude.ts` keeps its public idempotent API but moves its read-modify-write behind the extracted `LockedFile`, distinguishes `ENOENT` from other read failures, and commits atomically. This serializes the existing create-root pattern and the new port-file pattern across windows without holding the longer port transaction lock.

The port path is added as the literal file pattern `/.env.worktree`; `excludePatternFor` remains directory-only and is not reused for it. The lock order is one-way: the port transaction may finish and then acquire the exclude-file lock; exclude updates never acquire the port lock.

### D8: Port results are a sibling contract, not paths disguised as ports

`ProvisionStepResult` remains materialization-only and keeps its required repo-relative `path`. Ports add:

```ts
export interface ProvisionPortResult {
  readonly id: string;
  readonly name: string;
  readonly preview?: number;
  readonly outcome:
    | { readonly kind: "allocated"; readonly port: number }
    | { readonly kind: "reused"; readonly port: number }
    | { readonly kind: "failed"; readonly reason: string };
}

export interface WorktreeProvisionResultMessage {
  type: "worktreeProvisionResult";
  worktreeId: string;
  steps: readonly ProvisionStepResult[];
  ports: readonly ProvisionPortResult[];
  portWarnings?: readonly ("lockReleaseFailed" | "excludeFailed")[];
}
```

The host resolves selected ids into `{ entries, ports }`; the webview never supplies a name, preview, path, or command. WT-012.11 can add setup outcomes when it owns their stopping, retry, and output semantics rather than being pre-designed here.

The created-worktree notice coalesces per-id results by configured name, counts ordinary allocated/reused names, and names only failed variables or variables whose authoritative value differs from their preview. Unchanged successes remain silent by name. Lock-release and exclude failures render as batch warnings without exposing the common git directory.

### D9: Ports run after materialization and never decide create success

The mutation service keeps the accepted order: copy → link → ports → after-create. It invokes the port allocator even when no file entries were selected, adds `/.env.worktree` to the repository-local exclude when a port selection exists, and carries material and port results on the create's own provisioning outcome.

A missing binding, lock timeout, claim read failure, probe failure, file mismatch, publication failure, or exclude failure is reported after git's successful create. None escapes into the create error arm, rolls the worktree back, or prevents another selected name from succeeding where the failure is name-local.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Preview scan | A stale snapshot is presented as a reservation | D1 — number is optional and provisional; locked apply compares and reports movement |
| Common-dir lock | Two processes choose from one stale claimed set, or release deletes a successor | D2 — extracted exclusive lock; all claim reads/choices/write inside it; inode-checked release; concurrent test |
| Stale lock | A crashed holder blocks future allocations | D2 — bounded fail-closed timeout, explicit batch result, no unsafe age reclaim |
| Port names and claim parsing | A provider name injects another line, duplicate names/values collide locally, or malformed sibling content hides a claim | D3 — spec-owned grammar, strict bounded parser, duplicate rejection, incomplete sibling evidence closes fresh allocation |
| Existing `.env.worktree` | The allocator replaces a checkout's value or adopts a pre-existing collision | D4 + D6 — retain values, fail conflicts, preserve bytes, identity/content recheck, staged create/replace |
| Probe loop | Claimed ports or a large model hold the repository lock without bound | D5 — 200-row upstream cap, sibling/file-size caps, per-name attempts and transaction deadline |
| `info/exclude` | Concurrent read-modify-write loses either the root pattern or `/.env.worktree` | D7 — its own extracted lock and atomic replacement; concurrent update test |
| Wire/report | A port is smuggled into a path contract, or unchanged values create noisy notices | D8 — separate result type; counts for ordinary success, names only for changes/failures |
| Create integration | A provisioning rejection is reported as a failed create | D9 — per-stage catches and a create-success witness where all ports fail |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| Two extension processes cannot successfully claim one value | For one `repoId`, fresh sibling read, choice and claim publication execute in one exclusive critical section | Two windows read the same claims before either writes | Two allocator instances against one common-dir lock run concurrently; both successes contain distinct values | supported |
| A sibling claim is never handed out | A complete fresh git listing is required; every valid sibling value enters the claimed set, and any omission or unreadable/invalid file fails fresh allocation | Proceeding after `degraded`, `skipped`, parser reasons, normalization omissions, or an unreadable file | Each incomplete-list shape and each unreadable/invalid sibling yields failures and no target write; a complete sibling claim is excluded | supported |
| Existing assignments are not overwritten | Existing bytes and values are retained; sibling conflicts fail without replacement; duplicate names or numeric values invalidate the file; missing names append only after re-authorization | Rebuilding the file, replacing a conflicting value, or adopting two names with one value | Existing comments/order/assignments survive; conflicting and duplicate-value files remain byte-identical and report failures | supported |
| `.env.worktree` publication is all-or-old | The complete result is staged beside the target and committed by exclusive create or atomic replace | Direct append stops midway, or a file appears after the absent read | Failed staged create/replace leaves the previous path; successful write parses as the complete set | supported |
| A changed target is not knowingly replaced | Final type, identity, mode and bytes match the authorized read immediately before commit | Symlink substitution or edit between read and commit | Symlink/non-regular refusal; identity/content mismatch aborts the missing-name results | supported |
| The lock release cannot delete a successor | Release unlinks only the inode represented by the acquired handle | Another process replaces the lock pathname before release | Extracted `LockedFile` regression test substitutes the pathname and proves it survives | supported |
| A crashed lock is reclaimed automatically | — | Node cannot prove a cross-platform lock owner dead without introducing a false-steal case | D2 explicitly offers bounded failure, not automatic reclaim; pre-existing lock test returns failures and no writes | n/a — fail-closed availability is the established lock policy |
| Duplicate selected names create one assignment | Exact-name groups share one decision and one persisted line while retaining per-id results | Allocating once per opaque id | Two ids with one name receive equal outcomes and the file contains one assignment | supported |
| One name's local failure does not stop another | Invalid name or exhausted probe affects one name group; global proof/write failures affect only what cannot be proven/persisted | Throwing from the first failed probe | Invalid/exhausted first name plus successful second name; create remains `ok` | supported |
| Concurrent exclude updates lose no rule | Every `info/exclude` RMW holds its own lock and publishes atomically | Two windows read the same bytes then last-writer-wins | Concurrent additions preserve both exact lines; non-ENOENT read failure writes nothing | supported |
| The notice tells preview movement without naming unchanged values | Every port result travels; rendering filters names to changed/failed only | Enumerating all successful names, or silently swapping one | One moved and one unchanged result names only the moved variable and both values | supported |
| An unrelated process cannot bind the chosen port before setup | — | The probe closes before setup and no reservation is held | Spec and notice make no reservation claim; a bind after allocation is an accepted external race | n/a — explicitly outside the guarantee |
| An unrelated editor cannot change the target in the final syscall window | — | Node exposes no cross-platform compare-and-swap rename for a path | D6 rechecks immediately and scopes the serialization guarantee to extension processes | n/a — no such guarantee is offered |
