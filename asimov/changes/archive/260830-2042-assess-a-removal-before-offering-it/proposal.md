# Assess a removal before offering it

## Why

Removal is the one action in this extension that cannot be undone, and the assessment behind it
currently tells the user less than the code knows.

Three gaps, in order of what they cost:

1. **A worktree can be deleted out from under an agent we could not ask about.** `ExternalSessionFact`
   carries a session id and a cwd and no activity at all, so every registry session is treated as
   confirmable. `worktree-removal.md` § 2.2 says the opposite: an external session whose activity is
   `running`, `waiting`, **or cannot be determined** is a hard refusal, and only a provably idle one
   is confirmable. Today a typed confirmation can force a removal past a session nobody asked.
2. **The report does not mention what it will actually delete.** `git status --porcelain` says nothing
   about ignored material, and this subsystem deliberately creates ignored material in every worktree
   it provisions — `.env.worktree`, copied local configuration, installed dependencies, build output.
   A report where every check passed, followed by deleting a `node_modules` and a copied `.env`,
   omitted the thing that mattered (§ 2.3).
3. **`notApplicable` is unreachable.** `removalChecks.ts` says so in its own header: the fourth outcome
   is never produced because the sources that can answer "the question does not arise" are the ones
   this task adds. A check that never applied currently renders as one that passed.

## Scope

- The `ignored` check: a bounded walk producing a count and a total size, degrading to unproven
  rather than walking an unbounded tree, with provisioned material named separately when the manifest
  is readable.
- `externalAgents` reclassified per-instance: refusal when the session's activity is running, waiting,
  or undeterminable; confirmable only when provably idle. This requires the registry read to preserve
  live, dead and unreadable records instead of the presence reader's live-only filter.
- `notApplicable` produced where a check does not apply.
- Re-evaluation immediately before execution, with a **newly appeared** failure returning
  `needsConfirm` rather than riding a confirmation the user never granted for it.

## Non-goals and must-nots

- **The orphan proofs are WT-013.2.** Lock age, owning process, and merged branch are named in
  `worktree-removal.md` § 4 and are explicitly out of this task, including `branchMerged`.
- **No UI.** Rendering the report is WT-013.4. This task adds nothing to the webview.
- **Nothing is removed automatically.** No heuristic, and no combination of them, causes a deletion
  without an explicit press.
- **Must not** make a slow disk make a worktree unremovable. Ignored-material unproven is confirmable,
  never refusing.
- **Must not** guess which files were ours. Where the manifest is missing or unreadable the report
  falls back to the undifferentiated count and says so.
- **Must not** re-derive the class taxonomy anywhere but the host. `cls` travels on the wire precisely
  so the typed-confirmation rule exists once.

## Appetite

Large. Four of the five pieces are new evidence rather than new presentation, and one of them
(`externalAgents`) breaks a structural assumption the current code documents as deliberate — the
one-class-per-check-id catalogue.

## Risk

- **The class of a check becomes per-instance, not per-id.** `CATALOGUE` in `removalChecks.ts` is one
  table keyed by id, and its comment explains that as a defence against a UI rendering a shorter list
  for a worse outcome. `externalAgents` now needs a class that depends on what was read. The fix must
  keep "which checks exist" a single answer while letting one check's class vary — the shape of that
  is design.md D2.
- **The manifest does not exist yet.** `worktree-apply.md` § 2.6 designs it; nothing in `src/` writes
  or reads one, and the apply path that would write it is unbuilt Phase 12 work. The differentiated
  branch is therefore unit-verifiable against a written fixture but not integration-verifiable
  end-to-end in this change. The undifferentiated fallback is the path that will actually run until
  Phase 12 lands, and it is the one that must be right.
- **A bounded walk is a budget, and budgets get applied to the success path.** The count, the size,
  the entry cap and the time cap all have to bound the same walk, including the paths that produce
  only errors.
