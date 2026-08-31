# Design — resolve a selection before the create runs

> Refs: [worktree-create.md](../../../docs/design/worktree-create.md) § 2, § 2.0, § 2.1, § 2.3, § 3, § 6;
> [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.1, § 2.2, § 2.3;
> [worktree-model.md](../../../docs/design/worktree-model.md) § 2

## Decisions

### D1 — The resolution answers a query, and carries the opening that asked

§ 2.2 of worktree-rpc.md already specifies `worktreeCreateProbe { repoId, query, candidatePath? }`
→ `worktreeCreateResolution { repoId, query, mode, occupiedCandidate?, freePath, blockedBy? }`.
Neither exists in `src/`; this change lands them as specified.

**Chosen, and it is the one departure:** both carry the per-opening `token` WT-012.7 introduced on
the refs pair. The resolution is re-asked per settled selection, so a dialog reopened on the same
repository has the same `repoId` and the same `query` on the wire twice — `query` echoes for
staleness WITHIN an opening and cannot separate two openings. The token is minted the same way, and
an answer below the current opening is dropped.

**Amended after cycle 1 round 1 (B5, W3).** The token separates two OPENINGS and `query` separates two
edits within one, but neither separates two probes for the SAME query in one opening — an A → B → A
edit sequence puts two answers on the wire that are identical in both fields, so a delayed first
answer overwrites a newer one. Since the two answers differ only when the world changed between
them, and corroboration reads the world live, the stale one can restore a repair authorization the
newest classification withdrew. Both messages therefore carry `seq`, minted per probe within an
opening, and the form applies an answer only when its `seq` is at or above the highest it has
applied. `candidatePath` is resolved the same way rather than left with no production sender: the
probe carries the destination override currently in the form, so the path whose disposition is
reported is the path the create would use.

This is not the retrofit the proposal excludes: `worktreeCreateDefaults` and the provisioning offer
are pre-existing messages whose lifecycle is its own question. This pair is new, and shipping a new
message with a known gap in order to keep it consistent with two messages that have it would be
choosing the defect.

**This refines the blueprint** — § 2.1 and § 2.2 record the pair without the token — and is carried
to blueprint sync.

Rejected — riding `requestWorktreeCreateDefaults`: it answers "where would this go", which is a
question about a path. This one answers "what would this DO", which is a question about a branch,
and § 4.4 constrains the defaults reply to destination fields only.

### D2 — Classification is a pure function over facts the host already holds

The resolver needs: does the branch exist (WT-012.7's `for-each-ref` already answers this); does a
worktree hold it (the listing already carries `branch` per worktree); is that worktree `prunable`
(the listing already carries git's own flag, per worktree-model.md § 2); is the destination free.

**Chosen:** `src/worktree/createResolution.ts` — a pure `resolveSelection(facts): Resolution` over
those inputs, with the host supplying them. No new git invocation for classification. The one read
it cannot get from the listing is § 2.3's conditions 2 and 3, which are filesystem and ref reads,
and those run ONLY when the listing already said `prunable` — so the common path adds no I/O at all.

Rejected — asking git per keystroke: the probe is sent per settled selection, and a `for-each-ref`
plus a `worktree list` per settle is work the host already did once when the dialog opened.

### D3 — `prunable` is a claim, and reattach is offered only once it is corroborated

§ 2.3's four conditions are not a checklist to be partially satisfied. Conditions 2 and 3 are what
separate reattach from adopt and from a directory that needs a human:

| # | Condition | Failing it means |
|---|---|---|
| 1 | The listing marks it `prunable` and its branch is the selected one | Not this worktree's problem |
| 2 | The directory holds a `.git` FILE whose `gitdir:` names an administrative directory that still exists | **This is adopt (§ 2.4), not reattach** — and never debris |
| 3 | The directory's `HEAD` matches the branch's current OID | A checkout that moved; a human decides, not us |
| 4 | `git worktree repair <path>` succeeds and the listing loses `prunable` | The repair did not take; report it rather than claim it |

**Chosen:** conditions 2 and 3 are read at resolution AND their result is re-established at the
mutation, because the user's decision sits between them. `WorktreeCreateMode.reattach` already
carries `expectedOid` for exactly this — it is the directory's HEAD at resolution, and the mutation
refuses when it has moved.

Failing any condition means the mode is **not offered**. It never degrades to `fresh` at the same
path (which would suffix into a near-duplicate beside a checkout that is already there) — it falls
back to `fresh` at the FREE path, which is what the suffixing already computed.

### D4 — The occupied candidate is reported, and reporting it is not authorizing it

`occupiedCandidate: { path, disposition }` names the path the suffixing skipped and what was found
there. Without it, debris is invisible and WT-012.12 has nothing to act on.

**Chosen:** the resolution reports `disposition` as `free` or `debris` and carries NO authorization.
`DestinationDisposition`'s `debris` variant requires a `DebrisAuthorization` with a host-issued
fingerprint, and issuing one here would mean a probe — which the form sends on every settled edit —
hands out a delete authorization nobody asked for. The report is a statement about the world; the
authorization is a statement about what the user agreed to, and § 2.2 puts the second one behind an
explicit confirmation that is WT-012.12's.

So the resolution's disposition is a **narrower type** than the wire's `DestinationDisposition`:
`{ kind: "free" } | { kind: "debris" }`, no authorization field to leave empty and no way to
mistake one for the other.

### D5 — Base is refused by the mode, in the form, with a reason

§ 2.1: base is refused — not ignored — for `reuse` and `reattach`, and destination disposition does
not affect it.

**Chosen:** the form derives the base control's enabled state from `draft.branchMode` alone, the
same single-source rule D4 of WT-012.7 applied to `openAfter` and to new-versus-existing. A
disabled control carries the one-line reason; it is not hidden, because a field that vanishes when
the mode changes reads as a bug rather than as a rule.

The validation for `fresh` — the base must resolve to a commit — is host-side and rides the
resolution, since the resolver is already asking git about refs.

### D6 — Reattach's execution is a mutation verb, not a create source

`sourceOf` in `worktreeMutationService.ts` throws for `reattach` and `adopt` today, with a comment
naming WT-012.15. That throw is correct and stays: reattach is not a `git worktree add`, so it has
no `CreateSource` to return.

**Chosen:** the create mutation branches BEFORE `sourceOf` — `reattach` takes a repair path that
issues `git worktree repair <path>` and then re-reads the listing to confirm `prunable` is gone
(§ 2.3 condition 4), and every other kind takes the existing `add` path unchanged. `adopt` keeps
its throw, because WT-012.15 owns it.

`git worktree repair` exists from git 2.29.0, below the subsystem's 2.31 floor, so no capability
probe is needed (§ 2.3).

### D7 — The base ref is validated where the refs already are, and submit waits for the answer

§ 2.1's requirement has two halves and this change landed only one. Base is REFUSED where the mode
cannot apply it (D5), and where the mode creates a new branch it is **validated before submission and
reported as unresolvable before the create is attempted**. D5 already says that validation is
host-side and "rides the resolution, since the resolver is already asking git about refs" — but D1's
interfaces gave the probe no base field and the resolution no verdict field, so the wire could not
carry the answer D5 promised, and an unresolvable base stayed a post-submit git failure.

**Chosen:** the probe carries the base intent, and the resolution answers it. `baseValid` is absent
for the modes that refuse a base at all — `reuse` and `reattach` take their starting point from
something that already exists, so there is nothing to validate and an answer would imply the field
was live.

The submit gate then covers both channels rather than one. `outstanding` today is the destination's
gate alone, and the classification deliberately stays out of it; that is what lets a selection be
submitted as `fresh` while its own classification is still in flight, which is the exact
failure-after-submit the ADDED requirement exists to remove. A create waits for a destination AND a
matching resolution.

Rejected — validating the base in the webview: it has no ref database. Rejected — a third message
pair: the resolver is already holding the enumeration this answer needs, and a separate round trip
would let two reads disagree about one instant, which is what D2 exists to prevent.

### D8 — One effective resolution drives the form

The applier changes `draft.branchMode` only for `reattach` and drops the rest, so `fresh`, `reuse`
and `adopt` leave whatever mode the local text derivation last guessed; and `freePath`,
`occupiedCandidate` and `blockedBy` arrive and are never rendered. The spec requirement that the
resolution "names both the path the create will take and the one it skipped" is therefore satisfied
on the wire and nowhere the user can see, and the controller separately re-reads the same resolution
at submit — two interpretations of one answer, which is how a repair can act on a different path
from the destination on screen.

**Chosen:** the dialog holds ONE effective resolution for the current selection, and mode, the
displayed destination, the stated action, the guards and the submitted request are all derived from
it. Superseded on every new probe, so a held answer never outlives the selection it describes.

This is the same single-source rule D5 applies to the base control, extended to the whole
classification; it is not a new mechanism.

## Failure-surface inventory

| Resource | Owns writes | Serialization | Crash mid-write | Failed / malformed read | Two racing hosts |
|---|---|---|---|---|---|
| The administrative entry `.git/worktrees/<id>` | git, via `worktree repair` — this change issues no direct write | The subsystem's existing per-repo mutation queue, unchanged: repair goes through the same serialized path as every other create | `repair` rewrites the two-way link; a crash between its two halves leaves the state it started in — still `prunable` — which is the state this action is FOR. Re-running it is safe and is the recovery | A `.git` file that cannot be read, or whose `gitdir:` names a directory that is gone, fails **closed**: reattach is not offered, and the mode falls back to `fresh` at the free path. That is deliberate — the alternative is offering a repair against a link we could not read | Two hosts repairing one worktree: git serializes on its own index lock, and the second sees a listing without `prunable` and reports the mode no longer applies rather than repairing again |
| The destination directory | Nothing here — this change never creates or deletes it | n/a — read-only | n/a | An unreadable candidate reports the disposition as unknown and the mode is not offered against it. It is never reported as `free`, which would suffix into a directory we could not see | A directory that appears between resolution and submit is caught by the create path's own `mustBeFreeOrEmpty` check, which already runs at the mutation |
| Local refs (`refs/heads/`) | The user's own git | n/a — read-only | n/a | Fails **open** to `fresh`: a branch we could not confirm exists is treated as one to create, and git's own refusal at `add` is the backstop, surfaced verbatim per § 6 | A branch created or deleted between resolution and submit yields a resolution about a moment that has passed; git refuses and says so |

Nothing in this change writes to a resource it owns; the one mutation is issued through git.

**Not covered, and deliberately:** WT-013.1's round-5 finding that a read outliving its deadline is
abandoned rather than cancelled. This change's resolution reads are bounded git invocations through
the existing runner plus at most two small filesystem reads, and they run on the CREATE path rather
than inside the removal assessment — so it does not touch that finding's mechanism and does not make
it worse. It stays open and unwaived.

## Interfaces

```ts
/** What the resolution says a destination already holds — a REPORT, never an authorization (D4). */
export type ResolvedDisposition = { kind: "free" } | { kind: "debris" };

export interface WorktreeCreateProbeMessage {
  type: "worktreeCreateProbe";
  repoId: string;
  /** The opening that is asking. `query` echoes for staleness WITHIN one opening (D1). */
  token: number;
  /** Monotonic per probe within an opening; separates two probes for one query (D1). */
  seq: number;
  query: string;
  /** An override, so its disposition is assessed too. Omitted → the derived candidate. */
  candidatePath?: string;
  /** What the form would start a NEW branch from, so the host can resolve it (D7). */
  base?: { kind: "ref"; ref: string } | { kind: "detached" };
}

export interface WorktreeCreateResolutionMessage {
  type: "worktreeCreateResolution";
  repoId: string;
  token: number;
  /** Echoed, so a later answer can be told from an earlier one for the same query (D1). */
  seq: number;
  /** Echoed, so a form can tell a current answer from one it has typed past. */
  query: string;
  mode: ResolvedMode;
  /** The path the create would take. Always present — every mode has one. */
  freePath: string;
  /** The path the suffixing SKIPPED, and what was found there (D4). */
  occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
  /** A branch checked out elsewhere: offered disabled, never submittable. */
  blockedBy?: { ownerPath: string };
  /**
   * Whether the base the probe carried resolves to a commit (D7).
   *
   * Absent where the mode refuses a base at all — `reuse` and `reattach` start
   * from something that already exists, and a verdict there would imply a
   * field the form has disabled is still live.
   */
  baseValid?: { ok: true; oid: string } | { ok: false; reason: string };
}

/**
 * The classification, carrying only what the form needs to build a
 * `WorktreeCreateMode` — never the mode itself, because the form owns the base
 * ref and the detached choice and the resolver does not see them.
 */
export type ResolvedMode =
  | { kind: "fresh" }
  | { kind: "reuse" }
  | { kind: "reattach"; repairPath: string; expectedOid: string }
  | { kind: "adopt"; adoptPath: string };
```

`ResolvedMode` names `adopt` so the resolver can REPORT the state it detects — condition 2 of D3's
table distinguishes it, and a resolver that could not name it would have to call it reattach or
nothing. The form does not offer it; WT-012.15 does.
