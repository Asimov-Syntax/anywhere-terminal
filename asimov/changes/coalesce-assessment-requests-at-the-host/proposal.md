# Proposal: coalesce-assessment-requests-at-the-host

## Why

`render-the-removal-assessment-as-a-report` moved the removal assessment inside
`mutationCoordinator.run` so an authority-bearing read resolves behind the same forced-rebuild
barrier a mutation takes (its D10). Round-6 B5 then showed the bound that made that affordable does
not exist: `createKeyedSerialQueue` appends every call, and the only backlog control is a webview
guard keyed on the one live worktree id, so alternating two rows — or two panels — enqueues an
assessment per click ahead of every destructive mutation on that repository. The same guard is what
strands the row when a reply is dropped in transit (round-6 W6): it blocks the re-ask that would
recover.

One question, asked twice: nothing owns how much read work may be pending, and nothing owns how long
a request stays live. Both belong to the host, which is the only place that can see every surface.

## Appetite

M (≤3d)

## Scope

### In scope

- Assessment admission at the host: how many assessment runs one surface may have outstanding, and
  which request a run serves when it starts.
- The lifetime of an assessment request on both sides of the wire — what supersedes it, and what a
  repeat does.
- Delivery of the assessment reply itself, which is the one reply whose loss is not recoverable by
  waiting.
- The assembly witness for `render-the-removal-assessment-as-a-report` task 3_4, which claims a
  remove-and-recreate walk it does not perform (round-6 S2).

### Out of scope

- `createKeyedSerialQueue` and `MutationQueue`. Every destructive worktree mutation runs through
  them; a priority or coalescing rule inside either would change lock, unlock, remove, prune and
  create at once, for a defect whose whole population is one read verb.
- The freshness window D10 named and left open: a registration replaced *during* the assessment's own
  reads. It is shared with the shipped `blocked` → force path, it is pre-existing, and it needs its
  own PLAN task.
- Which removals are assessed at all. That is host policy and the parent change's follow-up.
- The removal, lock, unlock, prune and create verbs. This change may reorder nothing they do.

### Must not

- Mint force authority anywhere. The fingerprint stays D7's, issued by the assessment body and by
  nothing this change adds.
- Answer a request with a report the host did not actually produce for it. Coalescing may drop a
  question; it may never reuse another question's answer.
- Make the webview the thing that bounds host work. A guard the panel owns is a guard the panel can
  lose, which is exactly how B5 and W6 both arrived.
- Widen `WorktreeSurface.post` into a retrying sender. Broadcast traffic must stay fire-and-forget.

## Risk Level

MEDIUM. No new deletion authority and no change to any destructive verb, but it edits the admission
path of the one read that mints force authority, and a coalescing rule that dropped the wrong request
would leave an explicit destructive request unanswered — the failure the parent change's accepted
spec already forbids.
