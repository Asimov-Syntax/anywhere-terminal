# Design: report-what-was-checked-before-confirming

## Decisions

### D1: Asking what a removal would cost is its own message, and it acts on nothing

`worktreeRemoveAssess { worktreeId }` is answered by `worktreeRemoveAssessment { worktreeId, checks,
contained, fingerprint }`. It resolves the target, evaluates, and posts. It removes nothing.

The contract is not new — [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.5 already
documents both messages. They were never implemented, so the assessment reaches the panel only as
`worktreeMutationResult.result.kind === "blocked"`, which the host produces **by attempting the
removal**. That is why a clean worktree is deleted with no dialog: there is no way to ask.

Reuse, not new machinery: `WorktreeMutationBindings.assessRemoval` already exists and is what
`removeWorktree` itself calls.

### D2: The report renders the check list, not a hand-picked blocker set

`WorktreeRemoveDialog` names five conditions individually — tracked files, untracked files, idle
panes, external agents, lock. The host sends twelve checks, each with `id`, `cls` and `outcome`.

The dialog iterates the list it was given. A check the panel has no copy for renders from its `id`
and `outcome` rather than being dropped, so adding a check to the catalogue can never silently
remove a row from the report.

This is what § 2.1 asks for and it is the whole point: a warning is legible against what else was
verified. It also removes the panel's private list of what matters.

### D3: Whether a confirmation is earned is computed from the wire, never re-derived

```
typed   ⟺  ∃ check.  cls === "confirmable"  ∧  (outcome === "failed" ∨ outcome === "unproven")
refused ⟺  ∃ check.  cls === "refusal"      ∧  (outcome === "failed" ∨ outcome === "unproven")
```

`refused` outranks `typed`: a refusal renders with no confirmation control at all, not a disabled
one. `cls === "proof"` appears in neither predicate — a withheld proof never costs the user a
keystroke, and typing never unlocks what a proof gates (§ 2.2, § 2.4).

`RemovalCheckClass` is already on the wire. The panel classifies nothing.

### D4: Confirming mints no authority that did not already exist

| Assessment | Control | What the confirm posts |
|---|---|---|
| A refusal check failed or is unproven | none | — |
| A confirmable check failed or is unproven | retype the name | `worktreeRemove { force: true, fingerprint }` |
| Every confirmable check passed | ordinary confirm | `worktreeRemove { force: false }` |

The third row is the load-bearing one. A clean confirmation goes down the **existing unforced path
and carries no fingerprint**, so assessing a healthy worktree mints no force authority — the assess
issues a fingerprint under exactly the conditions the `blocked` path already issues one under, and
under no others.

The alternative — issue on every assess — was rejected. It would have made "ask what this would
cost" a deletion-authority door on a worktree where nothing was wrong, and this project has twice
shipped a door like that (round-1 B2 and round-3 B2 of WT-012.16, both on replayed authority).

If the worktree stops being clean between the report and the confirm, the unforced removal is
blocked by the host, which answers with a fresh assessment — the path that already exists.

### D5: The retyped name is compared to what the report displayed

The comparison subject is the worktree's own display name, exactly as the dialog rendered it. Not
the path, not a normalized form: the user can only retype what they were shown, and a subject
derived by one rule and displayed by another is a control that rejects correct input.

Whitespace at either end is trimmed; nothing else is normalized. The confirm control is inert until
it matches.

## Interfaces

```ts
/** WebView → Extension. Answers with an assessment; removes nothing. */
export interface WorktreeRemoveAssessRequestMessage {
  type: "worktreeRemoveAssess";
  worktreeId: string;
}

/** Extension → WebView. */
export interface WorktreeRemoveAssessmentMessage {
  type: "worktreeRemoveAssessment";
  worktreeId: string;
  checks: readonly RemovalCheck[];
  contained: readonly ContainedWorktreeWire[];
  /**
   * Present ONLY where a forced removal could be authorized — that is, where the
   * blocked path would already have issued one (D4). Absent for an assessment
   * whose every confirmable check passed, and for a refusal.
   */
  fingerprint?: string;
}
```

`RemovalCheck`, `RemovalCheckClass` and `RemovalCheckOutcome` are defined in `src/types/messages.ts`
and are not restated or changed here.

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| Assessing removes, modifies or deletes nothing | For every `worktreeRemoveAssess`, no destructive call is reached | A handler that shares a code path with `removeWorktree` and falls through to it | `pnpm run gate:fs-deletion` finds no destructive `node:fs` reference in the scoped modules; a test asserts the removal capability is never invoked for an assess | supported |
| Assessing a clean worktree mints no force authority | Where every `confirmable` check passed, no fingerprint is issued and none is required | Issuing unconditionally "for symmetry"; or a clean confirm posting `force: true` | A test asserts the assessment carries no fingerprint and the confirm posts `force: false` for an all-passed assessment, and that a failed-check assessment still carries one | supported |
| A fingerprint issued at assess time cannot authorize a removal the user did not see | Redemption fails once evidence has grown | Evidence changing between report and confirm | `worktreeFingerprint.ts:95` `redeem` is spent-on-sight including refusals, TTL-evicted, one record per worktree (replaced not appended), and returns `proceed` only when `isIdentityPreservingSubset(current, record.evidence)`; `forget(worktreeId)` drops it when the worktree is observed absent, so a later worktree at the same path cannot inherit one | supported |
| A refusal offers no way through | No confirmation control exists when a `refusal` check failed or is unproven | Rendering a disabled control, which is a control; or `typed` being computed before `refused` | `refused` is evaluated first in D3 and a test asserts no confirm element exists in the DOM at all, rather than asserting it is disabled | supported |
| Typing never unlocks a proof-gated option | The typed predicate excludes `cls === "proof"` | A future proof check classified `confirmable` by mistake | A test asserts an assessment whose only non-passing check is a `proof` requires no typing; the class comes from the host, so the panel cannot misclassify | supported |
| The panel's report cannot silently omit a check | Every element of `checks` produces a row | A `switch` on `id` with no default arm | A test sends an unrecognized check id and asserts a row still renders with its outcome | supported |
| The assessment store does not grow without bound | One fingerprint record per worktree, swept on access | Repeated assessing accumulating records | `worktreeFingerprint.ts` `issue` replaces by `worktreeId` and `evictExpired` runs on every access; growth axis is live worktrees, not history | supported |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `worktreeRemoveAssess` handler | A read-only door that shares code with the destructive one drifts into it | The handler calls `assessRemoval` and posts; it never reaches `removeWorktree`. `gate:fs-deletion` runs in this change's Verify Gate, not only the build's |
| Fingerprint issued earlier than before | Force authority minted where the blocked path would not have | D4 — issued only where `blocked` already issues one; ledger row 2 |
| Report rendering | A check the panel has no copy for disappears from the report | D2 — the unrecognized arm renders from `id` and `outcome`; ledger row 6 |
| Typed confirmation | The panel re-deriving refusal or confirmability and disagreeing with the host | D3 — both predicates read `cls` off the wire; the panel classifies nothing |
| `checks` list | Growth | Bounded by the check catalogue (`removalChecks.ts`, 12 ids) plus three proofs; not user-scaled |
| `contained` list | Growth axis: worktrees inside the target | Already bounded and produced by WT-013.1; rendered, not recomputed |
| Existing dialog tests | A rewritten renderer leaves old assertions passing for a new reason | Each existing assertion in `WorktreeRemoveDialog.test.ts` is re-checked by mutating the ORIGINAL condition it names, with the new render in place |

## Design Constraints

- `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are owned by an external
  design pass and are not touched. Panel styles live in `src/webview/worktree/worktreePanel.css`,
  whose idiom is `.vault-*` shell classes plus `.wt-*` specifics.
- Webview tests need `--runner 'pnpm exec vitest run'` (jsdom).
- Branch deletion (§ 5) and `BranchDeleteOffer` are WT-013.3. The assessment message defined here
  does not carry a branch-delete offer; adding one is that task's change, not this one's.
