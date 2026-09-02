# Design: run-the-setup-the-user-saw

## Architecture

```mermaid
sequenceDiagram
  participant Form
  participant Host
  participant Queue as Repository queue
  participant Apply as Material/ports
  participant Setup as Setup terminal
  participant Agent

  Form->>Host: offerId + selected item ids
  Host->>Host: redeem host-held model
  Host->>Queue: entries + ports + setup steps
  Queue->>Apply: copy → link → ports
  Queue->>Setup: start selected scripts
  alt agent does not wait
    Queue->>Agent: start concurrently
  else agent waits
    Setup-->>Queue: all steps succeeded
    Queue->>Agent: start
  end
  Setup-->>Queue: per-step outcomes
  Queue->>Host: create + provisioning result
  Host-->>Form: row result + output/retry tokens
```

## Decisions

### D1: Redemption produces execution values, never webview authority

`WorktreeHost` resolves all three selectable classes from one current offer: entries, ports, and setup steps. It derives the asimov environment class as `providers.some(p => p.id === "asimov" && p.active)`; the current merge marks both native and its named base active, so native-extending-asimov is included. The create request carries those host-owned values; the webview remains capable of sending only opaque ids.

An unknown or superseded offer keeps the existing fail-closed create refusal. Retry uses the retained setup values from the original redemption and never reads a provider file.

### D2: One output terminal, one shell process per step

A setup run owns one VS Code pseudoterminal for output and input. Its first child starts only after `Pseudoterminal.open()` establishes the write sink; VS Code discards earlier events. For each step, the runner starts a fresh PTY child and streams it through that terminal.

POSIX reuses `detectShell()` and launches the validated user shell with its login arguments followed by `-c` and the exact script as one argv element. Windows uses `powershell.exe -NoProfile -NonInteractive -EncodedCommand <payload>`; the UTF-16LE base64 payload decodes to the exact script, contains no Win32 quoting metacharacters, and stays one argument through node-pty's command-line join. `shell: true`, command-line interpolation, VS Code tasks, and provider-specific dispatch are absent.

The terminal forwards user input only to the current live PTY. It retains the latest 1 MiB as bounded byte chunks, evicting incrementally and decoding only on transcript replay, and coalesces live writes behind a bounded 8 ms / 64 KiB flush. Each settled step detaches its child. Closing during execution cancels one run-level signal; deadline and close race every terminal-open, authorization, and child-exit wait, and the signal is checked again immediately before spawn. PTY termination is best-effort and settlement/cleanup occurs even when `kill()` throws. The first non-zero, signal, spawn failure, cancellation, or timeout marks later steps skipped.

`SetupTerminal.dispose()` is idempotent: it detaches and best-effort kills a live child, clears flush timers/chunks/transcript, disposes emitters/subscriptions, and disposes the VS Code terminal. Retained output may recreate a read-only terminal until that owner disposes it.

### D3: Setup remains inside repository mutation serialization

The mutation service mints destination authority and a normalized result worktree id for every successful fresh create; entry selection additionally mints source authority. Setup starts only after entry application and authoritative port allocation. Provider parsing rejects port names outside `^[A-Za-z_][A-Za-z0-9_]*$` or inside the case-insensitive `ANYWHERE_TERMINAL_` / `ASIMOV_` namespaces before an offer is issued. Every successful offerable port result is added under its configured name, then host-owned Anywhere Terminal and Asimov values are overlaid last as defense in depth.

The setup promise remains inside the repository coordinator, so remove, retry, and another create cannot race commands against the same repository state. The accepted cost is that one repository's mutations and the create result may wait up to the shared two-hour setup bound; closing the terminal cancels earlier.

For an agent create with `waitForSetup: false`, agent launch starts immediately after setup starts and the service awaits both independently. With `waitForSetup: true`, launch is called only after all selected setup steps succeed. No selected setup means the ordinary launch path regardless of the carried boolean.

### D4: Retry is capability-bound to one surviving worktree

A failed run mints an opaque retry id and retains one immutable record per normalized worktree id: repository id/path, worktree path, original directory authorization, branch, setup steps, environment class, material/port results, and contest membership.

`worktreeSetupRetry` carries only worktree id plus retry id. The host resolves the current row; the service then requires the token, path, and original directory authority to agree before entering the repository queue. A retry rotates the token and retires the prior output immediately before queueing, runs setup only, rewrites the manifest from retained results, and emits a provisioning-only report — never a second mutation/create notice. Success removes retry state. An unexpected coordinator rejection emits a setup-only failure update without a retry id, so the spent capability cannot remain as a silent stale action. Authoritative rebuild reconciliation drops records for worktrees no longer present, bounding the store to live rows and preventing remove/recreate reuse.

A retry report omits entries, ports, and contests rather than re-sending steps whose contest indices could outlive the original membership array. The controller preserves those fields and replaces setup fields only.

The setup output id is separately opaque and bound to the originating surface plus the original `AuthorizedDirectory`. `worktreeSetupViewOutput` rechecks that directory identity before revealing the live terminal or recreating one from its bounded transcript; mismatch retires and disposes it. Starting a retry, replacement by a completed run, and rebuild disappearance also retire the handle and dispose its terminal immediately.

### D5: The manifest is an atomic record, not an execution input

After initial setup settles — including an empty selection or a failure — the service writes version 1 to `anywhere-terminal-provision.json` under the directory returned by `readWorktreeGitDir`.

The writer authorizes that administrative directory, rechecks it around a `LockedFile.atomicReplace`, and serializes only successful materialization, authoritative allocated/reused ports, and every selected setup source with `ok | failed | skipped`. Retry replaces the same manifest with the latest setup outcomes while preserving the retained material and port records.

Manifest failure is a warning on the provisioning result. It does not change create, setup, port, launch, or retry outcomes, and the manifest is never read to authorize execution.

### D6: Setup state rides the existing provisioning result

`WorktreeProvisionResultMessage` gains setup outcomes, optional output/retry ids, and an optional manifest warning. Its entry/port/contest fields become an all-present initial-result arm or an all-absent setup-only update arm. Initial create uses the existing ordered delivery; retry uses a new provisioning-only host delivery so no second mutation notice competes with the create row.

The create form adds one wait checkbox beside the agent controls. It defaults off, stays visible while agent launch is selected, and is disabled whenever the current selection contains no setup step. A failed setup notice exposes `View output` and `Retry setup`; retry refreshes that same notice.

## Interfaces

```ts
interface ProvisionSetupResult {
  readonly id: string;
  readonly source: string;
  readonly script: string;
  readonly outcome:
    | { readonly kind: "ok" }
    | { readonly kind: "failed"; readonly reason: string }
    | { readonly kind: "skipped"; readonly reason: string };
}

interface SetupRunInput {
  readonly repoId: string;
  readonly mainPath: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly steps: readonly ProvisionSetupStep[];
  readonly asimovEnvironment: boolean;
  /** Authoritative allocated/reused values under their configured names. */
  readonly ports: Readonly<Record<string, number>>;
  readonly authorization: AuthorizedDirectory;
}

interface SetupRunResult {
  readonly steps: readonly ProvisionSetupResult[];
  readonly outputId?: string;
  readonly succeeded: boolean;
}
```

`WorktreeProvisionResultMessage` adds `setup`, `setupOutputId`, `setupRetryId`, and `manifestWarning`. Initial results require `steps` and `ports` and may carry `contests`; setup-only retry updates structurally forbid all three. The two new inbound actions carry opaque tokens only.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Offer redemption | A forged or stale selection chooses unseen command text | Filter ids against the current host-held offer; contract and host-action tests cover foreign, stale, and omitted ids |
| Shell invocation | Win32 quoting or line breaks change the script before execution | POSIX uses one `-c` argv value; Windows uses one metacharacter-free `EncodedCommand` payload and verifies the decoded bytes in an executable test |
| Working directory | A replaced worktree redirects setup or stale output crosses identity | Authorize every fresh create; race and recheck authority before spawn; bind output/retry to the original authority |
| Process lifetime | Hung checks, failed kills, or abandoned scripts hold the mutation queue | One run-level deadline/cancel signal covers every await; kill is best-effort; settlement and cleanup are unconditional |
| Agent sequencing | A gated agent starts after failed setup, or an ungated agent waits | Explicit two-branch orchestration tests with controlled promises and launch spies |
| Retry state | Tokens survive removal/recreation, remain stale after rejection, or grow per attempt | One rotating record per live worktree; retry-start retirement; visible rejection update; success/disappearance eviction |
| Output state | Output before open is lost, event work grows, or stale output crosses surface/worktree identity | Start after `open`; bounded incremental chunks and batched writes; authority-scoped handle; idempotent disposal |
| Manifest | Partial JSON, wrong administrative directory, or empty selection loses the record | Git resolves and authorizes the directory; every fresh create stages one complete version atomically |
| Shared files | WT-012.5 is concurrently changing native-config seams | Setup work avoids `writeNativeConfig.ts`; host edits are localized to offer redemption and action routing |

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| Only consented command text executes | Every launched script equals one selected step in the redeemed current offer | Webview text, stale id, provider re-read, or unselected id reaches spawn | Host-action integration tests inspect setup values and stale-offer refusal | supported |
| Script text is one shell argument | POSIX carries exact text in one argv value; Windows carries one payload whose decoded text is exact | Win32 joining, interpolation, `shell: true`, or task dispatch changes it | POSIX argv tests plus a real PowerShell decode/execute witness with quotes, CRLF, and newlines | supported |
| Setup runs in the created checkout | Every fresh create mints destination authority; every child uses that cwd; provider ports cannot replace host identity variables | Authority hangs/outlives cancel, ancestry changes, or a reserved/case-folded port name reaches the environment | Empty/setup create, reserved-name, hanging-authority, cancellation, substitution, and retry recreation tests | supported |
| Copy, link, and ports precede setup | No setup child starts before both apply phases settle | A rejected or slow apply is bypassed | Mutation-service controlled-promise order tests | supported |
| Agent wait choice is exact | Off overlaps setup; on starts only after all steps succeed; gated failure starts none | One unconditional await or unconditional launch | Three scheduling tests: off, on-success, on-failure | supported |
| A failed setup cannot erase successful state | Worktree, earlier provisioning, and successful steps remain; later steps skip | Rollback, repeated materialization, or create-error relabelling | Service result and retry tests assert no remove/copy/port replay | supported |
| Retry cannot cross identity | A retry token is valid only for the originally authorized surviving directory | Remove/recreate at same path accepts old steps | Directory identity replacement and token-rotation tests | supported |
| Spawned work is bounded | One active child per run; every blocking boundary settles or is abandoned by the shared deadline/cancel signal | Authorization hangs, cancellation races spawn, or throwing kill prevents settlement | Controlled hanging-authority, close-before-spawn, throwing-kill, fake-clock, and queue-release tests | supported |
| Manifest publication is atomic and descriptive | Every successful fresh create, including empty selection, publishes one complete version; it never authorizes execution | Empty selection skips write, partial write, basename-derived git dir, or read-before-run drives spawn | Empty-create, rename-failure, git-dir, retry-replace, and reader-degradation tests | supported |
| Retained setup state is bounded | At most one retry/output record and terminal per live original worktree; per-event work is bounded | Retry leaves old terminal, same-id recreation reveals stale output, or output recomputes/dispatches per event without a bound | Retry-start disposal, authority replacement, chunk eviction, batching, detach, and reconciliation tests | supported |
