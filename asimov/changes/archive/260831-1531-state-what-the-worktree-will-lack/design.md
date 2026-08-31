# Design: state-what-the-worktree-will-lack

The model, the adapter's key mapping, the provenance rule and the offer's refresh semantics are
owned by [worktree-provisioning.md](../../../docs/design/worktree-provisioning.md) §§ 2, 3.1, 4.0,
4.3 and [worktree-rpc.md](../../../docs/design/worktree-rpc.md) § 2.4. This file decides only how
they land on a tree that has a working create dialog and no provider layer at all.

## Decisions

### D1: `yaml` parses the file; this repo does not grow a YAML subset reader

`yaml` (eemeli/yaml, 2.9.0) becomes the second entry in `dependencies`, beside `strip-ansi`, and
esbuild bundles it — the extension declares no externals.

The alternative was a reader for the documented subset: three top-level list-of-string keys and one
map. It looks small until the real file is considered — `asimov/worktree.yaml` is more comment than
content, and a subset reader has to handle comments, inline `#`, quoting and indentation before it
has read a single path. A mis-parse there is silent and produces a *different* list of files than
the one the user was shown, which is the one failure this whole section exists to prevent.

`yaml`'s default `parse` is data-only: it constructs no objects and calls nothing, unlike
`js-yaml`'s unsafe load. The design already assumes a parser — § 7 speaks of bounding "a YAML
parser's error message" — so the untrusted-input handling is written for this, not against it.

Consequence: a `parse` throw becomes a `malformed` problem carrying the parser's message,
truncated and rendered as text. It is never interpreted as markup, and the create stays enabled.

### D2: One adapter is one function, not a registry

`readAsimovProvisioning(deps, repoRoot)` returns a `ProvisionModel`. There is no provider
interface, no registry and no dispatch table, because there is one provider.

WT-012.3 adds three more and WT-012.4 adds detection order and the merge rule; that is the task
that learns what the seam between adapters actually needs. Declaring it now means guessing it from
one example, and a registry built for one entry is a shape the second entry has to be bent into.

What this change does provide is the model itself, which is the real contract: WT-012.3's adapters
produce the same `ProvisionModel` and the merge in WT-012.4 operates on it.

### D3: Globs expand against the main worktree at read time, on the final segment only

§ 3.1 permits a `*` in the final segment. Expansion reads the parent directory and keeps the names
matching the pattern, so `.opencode/command/*.md` becomes one entry per file that is actually
there.

`minimatch` is a devDependency and stays one — promoting a glob library to runtime for a
single-segment `*` is more dependency than the problem has. The match is a literal prefix/suffix
comparison around the one `*`, and a pattern with more than one `*` or a `*` outside the final
segment is a `malformed` problem rather than a best-effort interpretation.

Every expanded entry carries the **glob's** source file, per § 4.3. An unmatched glob contributes
nothing and is not a problem — a repo legitimately carries optional material.

### D4: Containment is checked on the resolved path, before the entry enters the model

Expansion reads the filesystem, so the answer authorizes a read and the resolved form is required
(DESIGN.md § 9 D31). Each entry's path is resolved against the repo root and checked with
`isResolvedPathInside` from `src/utils/pathBoundary.ts`; this change writes no containment test of
its own.

An entry that escapes — `../`, absolute, or a symlinked component landing outside — is refused and
recorded as a problem naming the file that declared it. It is never clamped back into range.

The check runs **before** expansion for a glob's parent directory, so a `../*` pattern cannot cause
a read outside the repository in the course of being rejected.

### D5: The host holds the model and issues an opaque offer id

```ts
export interface ProvisionOffer {
  readonly offerId: string;
  readonly model: ProvisionModel;
}
```

The store is a per-surface map from `offerId` to the resolved model, held in the extension host.
The webview receives the model for display and the id to quote back; it never receives a handle it
could dereference into something executable.

Item ids are minted per offer — a counter within the offer, not a path and not a hash of one — so
an id from a previous offer resolves to nothing rather than to whatever now occupies that slot.

This change issues offers and never redeems one, which is deliberate: the store is the authority
WT-012.2 and WT-012.11 execute from, and building it here is what makes "the model the user saw is
the model that runs" a property of the system rather than of a later task's discipline.

### D6: The section renders from the offer, and the empty case is a row of prose

The panel keys nothing on which provider produced a row. It renders `entries`, `ports` and `setup`
as one flat list of checkboxes, because § 2.4's selection is one flat list of ids and a UI that
sorted rows by kind would have to be undone to submit them.

The empty model is not an empty list — it is the sentence the spec requires, naming `.env` and
`node_modules`. The distinction that matters is "this repo needs nothing brought over" versus "we
did not look", and only the second is a defect.

Rows are rendered checked, matching `docs/ui/create-worktree.html`'s mockups. Nothing consumes the
checked state in this change; WT-012.2 is where a checkbox first decides anything, and § 7's rule
that a setup command is "gated by an explicit checkbox that is off unless the user leaves it on" is
about the user's opportunity to clear it, which this rendering provides.

### D7: A port row has no number yet, so `ProvisionPort.port` becomes optional

`worktree-provisioning.md` § 2 declares `port` as a required `number`, resolved "when the dialog
builds the model". That was written assuming allocation already existed. It does not: probing and
allocating a free port is WT-012.6, which depends on WT-012.2, which depends on this change.

So the field is declared optional and this adapter never sets it. The row renders the port's
**name** and its source file, which is what this change's acceptance asks for; WT-012.6 fills the
number in and § 5.3's re-resolution rule then applies to it.

The alternative — inventing an allocator here to satisfy a field nobody reads yet — would put port
probing in the read path of a task whose whole acceptance is that it touches nothing, and would
land it before the task that owns its collision semantics.

This is a change to an accepted blueprint type, so it syncs back to
`worktree-provisioning.md` § 2 on approval rather than living only here. Note this repository's own
`asimov/worktree.yaml` declares no `ports:` at all — deliberately, its comment explains why — so
the port row is exercised by a fixture rather than by the real file.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `yaml` parse of an untrusted checked-in file | A crafted file crashes the dialog, or its error message injects markup into the section | D1 — `parse` is wrapped and a throw becomes a `malformed` problem; `detail` is truncated and set as text, never as markup. The create stays enabled either way (§ 9) |
| Glob expansion | A pattern causes a directory read outside the repository, or expands to a list different from what is copied later | D3 + D4 — containment is checked on the resolved parent before the read, and expansion happens once at read time so the shown list is the stored list |
| Offer store | An id from a stale offer resolves to a model the user never saw | D5 — ids are minted per offer and the store is keyed by offer id; an unknown id resolves to nothing. Redemption is WT-012.2's, and it inherits a store that cannot silently substitute |
| Provenance | A later merge cannot say which file asked for an entry | D3 + § 4.3 — `source` is set by the adapter and every expanded entry carries the glob's own source; no transform in this change rewrites it |
| New runtime dependency | A second `dependencies` entry enters an extension that had one | D1 — `yaml` is data-only by default and bundled by esbuild; the alternative was a hand-rolled parser whose failure mode is a silently wrong file list |
| Bring over section | The section renders but says nothing for a repo that needs nothing, which reads as a bug | D6 — the empty case is a required sentence, and its own scenario in the spec delta |

## Failure surface

| Resource | Answer |
|---|---|
| Provider file `asimov/worktree.yaml` | Read-only in this change; nothing writes it. A failed or malformed read **fails open** — the model is empty, the file is named in `problems[]`, and the create stays enabled, because a broken provisioning config is not a reason to refuse to make a worktree (§ 9). It fails open rather than closed precisely because nothing executes from it here; WT-012.11 is where a problem gains teeth |
| Main worktree directory (glob expansion) | Read-only. Two racing reads are harmless — neither writes, and the result is a snapshot the offer freezes. A directory that disappears between the containment check and the read contributes no entries and is not a problem, which is the same answer as a glob matching nothing |
| Host-held offer store | Writes are owned by the extension host, one store per window, mutated only on the extension host's single thread — there is no concurrent access to serialize. It is in-memory, so a crash leaves nothing behind: the next window resolves a fresh model and issues a fresh id. Two windows hold independent stores and independent ids, and an id from one is unknown to the other, which resolves to the same "no create, no provisioning, re-present" answer as an expired one (rpc § 2.4) |
| Worktree destination directory | n/a — this change writes nothing to disk. `validateCreatePath`'s contract is untouched |
| Spawned process | n/a — no setup step runs. `setup[]` is display text here; WT-012.11 owns execution and its lifecycle |
| TCP ports | n/a — `ports[]` is read from the file and displayed. No port is probed or bound; `ProvisionPort.port` is resolved by WT-012.6, and this change renders the name and source without a number |
