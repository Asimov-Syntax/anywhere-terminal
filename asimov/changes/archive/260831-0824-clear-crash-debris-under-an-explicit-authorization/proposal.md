# Clear crash debris under an explicit authorization

## Why

A create whose destination already holds a directory silently moves to a suffixed path. When that
directory is crash debris — a half-made worktree whose registration never landed, or one whose
directory survived a `prune` — the user gets `repo-branch-2` and no explanation, and the original
mess stays on disk forever. `docs/design/worktree-create.md` § 2.2 makes recover a first-class
destination disposition instead.

The wire already carries it. WT-012.0 landed `DestinationDisposition`, `DebrisAuthorization` and the
`mustMatchDebrisAuthorization` path intent, and `WorktreeController.ts:538` names this task as the
one that "adds the authorization that makes the other member reachable". This change fills that seam.

## Scope

- Classify a destination as debris by reading for `.git`, replacing the registration-only proxy in
  `dispositionOf`, which today calls every unregistered directory debris.
- Issue and redeem an authorization over the path and what was found there.
- Perform the bounded delete, and report a partial one as a failure.
- Offer recover in the create dialog, stating the path and what will be removed.
- Name the delete site in the I10 gate's allowlist, so the carve-out is declared rather than hidden.

## Non-goals and must-nots

- **Adopt is not in scope.** A directory holding a `.git` is WT-012.15's, and this change's only duty
  toward it is to never classify it as debris.
- **No new containment logic.** `isPathInside` / `isResolvedPathInside` from `src/utils/pathBoundary.ts`
  are the only definitions in `src/`; this code does not spell its own.
- **No widening of the delete.** The carve-out covers a debris directory at a validated destination
  and nothing else. `git worktree remove` keeps every other directory deletion.
- **No change to removal's fingerprint store.** Its subset semantics are written in `RemovalEvidence`
  and generalizing them for one other caller would obscure the module that guards the most dangerous
  action in the extension.

## Appetite

L. The delete is small; the bounds around it are the work, and each is separately testable.

## Risk

HIGH, and the highest in the create path — this is the only create route that removes anything, and
the invariant it carves out ("never delete files directly") exists because a wrong-but-valid path is
data loss rather than a safe failure. The mitigations are in design.md: every bound is a separate
test, the delete site is declared to the I10 gate, and the identity recheck is re-taken immediately
before the delete rather than inherited across an `await`.
