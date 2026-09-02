# Worktree Provisioning — Apply

> **Ref**: docs/DESIGN.md § 8.2 — the "Create / remove / lock / prune / launch" row
> **Consumer**: `asimov-plan` reads this to turn a PLAN.md task into spec deltas and builder tasks.

What actually happens on disk once a worktree exists: the four apply steps, what each refuses, and
what is recorded afterwards. Split out of [worktree-provisioning.md](worktree-provisioning.md),
which owns the other half — what the extension **reads** to learn the material, and how it presents
that material before anything is created.

The model applied here is the one the user was shown, not a re-read of the provider files
([worktree-provisioning.md](worktree-provisioning.md) § 4.0). Message shapes live in
[worktree-rpc.md](worktree-rpc.md).

## 1. Overview

Ordering is fixed: **copy → link → ports → setup**. Ports precede setup because a setup command
is the usual consumer of the allocated values; setup runs last because setup commands routinely
depend on copied config, and never the reverse.

Applying happens **after `git worktree add` reports success** and is reported per step. It is
started by the create action ([worktree-create.md](worktree-create.md) § 6) and is the only part
of provisioning that touches the filesystem.

## 2. The four steps

### 2.1 Copy

Recursive for directories, preserving mode bits but never ownership.

**Never overwrite applies to every descendant, not just the named entry.** A directory copy that
replaced files inside an existing destination because the top-level name was free would be the
same defect with more steps. Each descendant that already exists is skipped and reported.

Source and destination are validated **separately**: the source must resolve inside the main
checkout, the destination inside the new worktree. A single "inside the repository" test passes
both a source that is really a destination and a destination whose existing parent resolves out of
the new worktree.

Three rules the word "containment" does not by itself supply:

- **Special files are refused** — devices, sockets, and FIFOs are not configuration, and copying
  them is never what a provider meant.
- **Symlinks encountered while walking a source tree are not silently dereferenced.** An in-repo
  symlink is preserved as a symlink; one resolving outside the repository is refused and reported.
  Recursive symlinks therefore terminate the walk rather than expanding it.
- **Validation is redone immediately before each operation**, and creation uses the
  exclusive/no-follow primitive where the platform has one. A component validated once and written
  later is a component something else had time to replace.

Lockfiles are never copied and never linked, whether or not a provider names one. A lockfile
copied from main describes main's dependency tree, and the entire point of a per-worktree install
is that this branch's lockfile is authoritative. A provider entry naming one is reported as a
skipped step with that reason.

The rule is over the **resolved destination**, not the spelling the provider wrote, and it applies
at every depth: a lockfile found inside a copied directory, and a symlink named like one whose
target lands inside the repository, are both refused. A rule over the spelling would refuse
`scratch./../.env`, whose offending segment resolution has already discarded; a rule over the top
level alone lets the same file arrive one directory down.

The name is compared as the **filesystem's own identity for it**. Case is folded everywhere.
Trailing dots, trailing spaces and a `::$DATA` suffix are folded only under Win32 path semantics,
where they name the same object; on POSIX they are literal bytes in a filename and folding them
would refuse a file the rule was never about.

The whole apply is **bounded, and the bound is shared across every entry**: a node count, a byte
count and a deadline. One selected directory can hold a million files, and this runs inside the
per-repository mutation queue, so an unbounded walk delays the create result and every mutation
behind it. A transfer is bounded **while it runs** rather than audited afterwards — a size read
before the open is an estimate, and a source that grows between the two would otherwise pass a
check that had not been spent yet. A transfer that fails after writing part of a file is charged
for what it wrote: those bytes are in the worktree, because a failed step is never rolled back
(§ 2.5), and a later entry must not be able to spend them again.

### 2.2 Link

A relative symlink from the worktree to the main checkout.

**A linked path writes through to the main checkout**, and every other worktree sees the write.
That is the whole reason copy is the default and link is opt-in: an agent editing a linked `.env`
silently reconfigures the user's main checkout, and branches legitimately need different ports and
endpoints. The UI states this on every linked row, and the statement is not suppressible.

Where symlinks are unavailable — Windows without Developer Mode or elevation — the entry
**degrades to a copy and says so**, rather than failing or silently promising a link it did not
make. The degradation is per entry and visible in the result.

`node_modules` is never linked as a root, by any provider, even when one asks. A shared
`node_modules` makes every worktree's dependency tree the same tree, which defeats per-branch
lockfiles and corrupts installs that run concurrently. The supported answer is pnpm's
`virtualStoreType: global` plus a per-worktree `pnpm install` in `setup` — cheap, because the
global store is already populated. An entry naming `node_modules` with `mode: "link"` is reported
as a refused step naming this rule.

The refusal is about **sharing a dependency tree**, so it is scoped to a root named `node_modules`
in `link` mode. A `node_modules` directory found inside a copied tree shares nothing and is copied
like anything else; refusing it would make a copied dependency tree unreachable.

### 2.3 Ports

**The extension allocates**, under a lock, because a probe alone cannot make the guarantee this
feature exists to make.

The sequence, all of it inside a lock taken on a file in the repository's **common git directory**
so that it holds across VS Code windows and across processes:

1. Read `.env.worktree` from every other worktree of the repo and collect the claimed values.
2. For each name, bind `127.0.0.1:0`, read the assigned port, close it, and reject any value in
   the claimed set. Repeat until distinct.
3. Write `.env.worktree` into the new worktree as `<NAME>=<port>` lines, atomically.
4. Release.

**What this guarantees and what it does not.** It guarantees that two worktrees created by this
extension never claim the same port, which is the collision the feature exists to prevent — and
which a bare OS probe cannot prevent, because a port nobody is listening on right now is free to
the probe and already spoken for by a sibling's config. It does **not** guarantee that an
unrelated process will not bind the port before setup runs. Nothing at this layer can, and the
acceptance says so rather than implying a stronger claim.

**The dialog's number is a preview.** The dialog resolves values outside the lock in order to show
them, and the locked pass is authoritative. A number that changed between the two is **reported**
rather than swapped silently — the user was shown a number for the express purpose of remembering
it, and a UI that quietly replaced it would be lying about the one value it asked them to keep.

**An existing `.env.worktree` in the new checkout is parsed and reused, never overwritten and
never ignored.** Allocating fresh values while a file on disk names different ones would export
one set to setup and persist another. Where the file already covers every configured name,
allocation is skipped entirely.

`.env.worktree` must not show up as untracked noise: it is added to the repository's
`info/exclude` alongside the worktree root ([worktree-create.md](worktree-create.md) § 3), never to
`.gitignore`.

A name whose port cannot be allocated is reported as a failed step; remaining names still get
theirs, because a partially ported worktree is more useful than none.

### 2.4 Setup

Commands run sequentially in the new worktree's directory, every one of them through a shell —
including the steps a `tasks.json` entry supplied, which reach here as ordinary shell steps
([worktree-provisioning.md](worktree-provisioning.md) § 3.3). argv is never assembled by string
concatenation; the command is passed as the shell's single script argument.

Running them through the VS Code task system instead was designed and then measured out: a task
scoped to a directory that is not an open workspace folder runs in the window's opened folder
rather than refusing, which for a setup step means succeeding in the wrong checkout.

**Setup steps are unchecked by default.** A default-on box that the user did not clear is not
consent to run a command a checked-in file supplied. Persisting a per-repository "always run setup
here" trust decision is a reasonable future addition and is explicitly **not** designed here —
until it is, the checkbox starts off every time.

Environment: the process environment plus `ANYWHERE_TERMINAL_WORKTREE_PATH`,
`ANYWHERE_TERMINAL_MAIN_PATH`, and `ANYWHERE_TERMINAL_BRANCH`. Where the asimov adapter supplied
the model, `ASIMOV_WORKTREE_PATH`, `ASIMOV_MAIN_ROOT` and `ASIMOV_BRANCH` are set to the same three
values, because a repo's setup script was written against those names. `ASIMOV_CHANGE_ID` is
**deliberately not set**: this model has no value to put in it, and inventing one would make a
worktree created here look like a change created by the asimov tooling.

Setup may run **concurrently with** `openAfter` or be gated ahead of it, per
[worktree-create.md](worktree-create.md) § 6. Copy, link and ports never are — they always complete
first.

Cancellation, timeout, and where output goes belong to the existing mutation budget, for every
step ([worktree-actions.md](worktree-actions.md) § 3.6) — there is no second owner now that no
step reaches the task system.
Retry state lives with the worktree row and does not survive a host restart — a retry offered
after a restart would be offering to re-run a model the host no longer holds (§ 4.0).

A non-zero exit stops the remaining steps and is reported. It does **not** stop the copy and link
results from standing, and it does not affect the worktree.

### 2.5 Setup failure is not create failure

**The worktree is never rolled back because provisioning failed.** By the time provisioning runs,
`git worktree add` has already succeeded; deleting the directory the user asked for in order to
tidy up an error message destroys their work to make a status line look clean.

The outcome surfaces on the created worktree's row — "setup failed — view output / retry" — and
persists there until the user acts on it. Retry re-runs the setup steps only; copy and link are
not repeated, because a retry after a partial copy would hit the never-overwrite rule (§ 5.1) and
report collisions that are not problems.

This mirrors § 3.6 of [worktree-actions.md](worktree-actions.md): a failure that leaves real state
behind is reported for what it is, not flattened into "nothing happened".

### 2.6 The manifest — what this worktree was set up with

Applying writes a **manifest** into the new worktree's administrative directory
(`.git/worktrees/<id>/anywhere-terminal-provision.json`, which git itself deletes when the worktree
is removed). It records, for one create:

```ts
interface ProvisionManifest {
  readonly version: 1;
  readonly createdAt: string;
  /** Successfully materialized paths, worktree-relative, with the mode used. */
  readonly materialized: readonly { path: string; mode: "copy" | "link" }[];
  readonly ports: readonly { name: string; port: number }[];
  /** `source` is the provider file the step came from — the only stable name a shell step has. */
  readonly setup: readonly { source: string; outcome: "ok" | "failed" | "skipped" }[];
}
```

It exists because two later claims are otherwise unsupportable across a host restart:

- **Removal naming what this extension provisioned** — "the 4 files this worktree was set up with"
  rather than "1.2 GB of ignored content" ([worktree-removal.md](worktree-removal.md) § 2.3). After
  a restart there is nothing else to derive that from.
- **A retry that knows what already succeeded.** Without the manifest, a retry after a restart is
  offering to re-run a model the host no longer holds.

The manifest is a **record, not an authority**: it is never used to decide what to delete, only to
describe. A missing or unreadable manifest degrades every claim that depends on it to "could not be
determined" — it never blocks a removal and never causes one.

Living in the administrative directory is deliberate. It is outside the working tree, so it never
appears in `git status`, and git's own removal takes it with the worktree.

## 3. Security

- **Every path is repo-relative and must resolve inside the repository.** Containment is checked
  with `isPathInside` from `src/utils/pathBoundary.ts` — the single definition in `src/`. This
  module never spells its own containment test. Where the answer authorizes a filesystem read or
  write, the resolved form (`isResolvedPathInside`) is used, per DESIGN.md § 9 D31.
- An entry escaping the repository — `../`, an absolute path, or a symlinked component resolving
  outside — is **refused and reported**, never clamped into range. Clamping turns a suspicious
  entry into a silently different one.
- Copy never follows a symlink out of the repository; a symlinked source resolving outside is
  refused under the same rule as an escaping path. Both ends are opened **no-follow**: an `lstat`
  saying "regular file" is not a promise the path is still one when the open happens, so the source
  is opened `O_RDONLY | O_NOFOLLOW` and the destination exclusively, and each descent re-checks.
- **The intermediate-component window is named, not closed.** Validating `/wt/cfg/secret`, then
  having something replace `cfg` with a symlink out of the worktree before the write, escapes
  through a component that is neither end. Node exposes no `openat`, so no walk written in Node can
  close it; the per-descent check narrows it and the exclusive create protects the final component.
- A setup command runs only because the user left its checkbox ticked, and what runs is the
  host-held model the offer names — never text the webview supplied, and never a re-read of the
  provider file after submit ([worktree-provisioning.md](worktree-provisioning.md) § 4.0, § 7).

## 4. Edge cases

| Case | Behaviour |
|---|---|
| Entry path already exists in the new checkout | Copy skipped and reported (§ 2.1) |
| Selected entries may name one destination | Decided by how many of them the repository's own file declared, over the selection submitted — see worktree-provisioning.md § 4.4. The destination is read before the ordered pass AND again immediately before the favoured member's turn, because an earlier uncontested copy can create the name in between |
| A contested destination cannot be shown free | The whole group is refused, not only the losing member: letting the favoured member run would merge it into a directory it did not create, installing neither its material nor its mode |
| A contested member is refused by a rule of its own | It is refused ALONE and keeps the rule that fired — an unsupported file type stays an unsupported file type, never a destination collision — and the group goes on without it. Every refusal still identifies every member of the contest |
| Symlink unavailable on the platform | Degrades to copy and says so (§ 2.2) |
| `node_modules` declared as a link | Refused with the reason (§ 2.2) |
| Lockfile declared in copy or link | Skipped with the reason (§ 2.1) |
| Lockfile found inside a copied directory, or named by a symlink | Refused with the same reason (§ 2.1) |
| `node_modules` inside a copied tree | Copied — the rule is about sharing a root (§ 2.2) |
| Apply exceeds its node, byte or time bound | Stops and reports; what already landed stands (§ 2.1) |
| Port taken between preview and apply | Applied number wins and the change is reported, never silently swapped (§ 2.3) |
| Port claimed by a sibling worktree's `.env.worktree` | Excluded from the probe (§ 2.3) |
| Setup step fails | Remaining steps stop; worktree stands; row carries retry (§ 2.5) |
| Manifest missing or unreadable | Claims that depend on it degrade to could-not-be-determined; never blocks a removal (§ 2.6) |

## 5. Testing

| Area | Cases |
|---|---|
| Apply | Ordering copy → link → ports → setup; never overwrite; lockfile refusal; `node_modules` link refusal; symlink degradation reports; every setup step runs through a shell in the new worktree's directory, none through the VS Code task system; each contested-group outcome — favoured member claims, group refused for an unprovable destination, favoured member refused before claiming, and more than one of the repository's own declarations selected — asserting that nothing was written for every refusing case |
| Ports | Sibling `.env.worktree` values are excluded; re-probe before write; a changed number is reported; existing `.env.worktree` is not overwritten |
| Failure | Setup failure leaves the worktree and every prior step standing; retry re-runs setup only |
| Manifest | Written after a successful apply; a missing or unreadable manifest degrades a claim rather than blocking |
