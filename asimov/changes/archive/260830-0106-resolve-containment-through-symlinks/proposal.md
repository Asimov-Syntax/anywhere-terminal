# Proposal: resolve-containment-through-symlinks

## Why

Four vault transcript resolvers decide "is this candidate inside the store root I control" with a
**string** comparison — `path.relative` plus a `..` / absolute test, or a `startsWith` boundary.
A symlink inside the root that points outside it satisfies every one of those checks, so a path
that lexically looks contained can resolve to a file that is not, and the resolver then reads it.

No privilege is gained today: the caller already reads vault transcripts, and the ids reaching
these resolvers are pattern-validated first. What is wrong is that the subsystem states a stricter
rule elsewhere and does not keep it here — DESIGN.md § 8.5 records that webview-supplied paths
refuse symlinked components outright, and one of these four sites gates a path the vault **index**
supplied rather than one the host constructed.

Three separate local predicates exist for the same question — `path.relative` inline in three
Claude resolvers, `isUnder` in the Codex reader, `isInside` in the preview service. That is the
actual defect: with no owner, the rule drifted into three shapes and can drift again.

## Scope

- One resolved containment predicate, in the module that already owns path boundaries
  (`src/utils/pathBoundary.ts`), resolving **both** sides through symlinks before comparing.
- Seven call sites across four files adopt it; the three local predicates are deleted. The seventh
  is `claudeReader`'s directory listing, which today reads every file it enumerates with no
  containment check at all.

## Non-goals and must-nots

- **Must not** widen `isPathInside` or reuse `realpathTolerant`. The lexical predicate keeps its
  twelve callers — four of which are genuinely pre-resolved, and five of which carry the same
  lexical hole in a different consequence and go back to the blueprint as their own task (design.md
  D2). The tolerant walker stays where it is: it swallows every `realpath` error, which is right for
  naming a worktree and wrong for authorizing a read (design.md D3).
- **Must not** make a missing file an error. A transcript that has not been written yet is the
  normal early state of a session; the resolver must still answer "contained" for a path whose own
  tail does not exist beneath a parent that resolved inside the root. **Absence only** — every other
  resolution failure is refused.
- **Must not** silently change what a healthy install shows. A user whose store root is *itself*
  reached through a symlink — `~/.claude` on another volume, or macOS's `/var` → `/private/var` —
  must keep working, which is why both sides resolve rather than only the candidate.
- Not in scope: `FileTreePanel`'s local copy of `isPathInside` (a webview-side comparison that
  reads no files), and the worktree-id comparisons listed above.

## Appetite

Small. One predicate, seven adoptions, and the tests that discriminate them. The work is in getting
the failure directions right, not in volume.

## Risk

**The behaviour change is real and it is a refusal.** A user who symlinked one project directory
out of their Claude store to another disk gets that session's transcript refused where it is read
today. That is the point of the change, but it is a regression from that user's side, and it is
invisible until they notice a blank preview. The mitigation is the asymmetry in design.md D3: only
a symlink that *escapes* the root is refused, and a root reached through a symlink still resolves
normally — so the common legitimate arrangement keeps working and only the escaping one stops.

The second risk is the tolerance itself. A predicate that treats *any* `realpath` failure as
"absent, judge it lexically" would leave the hole open through a dangling symlink — the link fails
to resolve, the walker rebuilds the path literally, and containment answers yes. So only a
demonstrably absent tail is tolerated, and the dangling, `ELOOP` and `EACCES` cases are asserted at
the predicate rather than inferred from a resolver's answer.

The third is Codex's equality case: the predicates being replaced reject `candidate === root` and
`isPathInside` accepts it. Adopting the loose form would silently skip the filename fallback that
finds the real rollout, so the new predicate is strict and carries that regression test
(design.md D5).
