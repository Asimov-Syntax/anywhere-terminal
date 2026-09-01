# Design: assemble-one-config-from-several-files

Mechanism and risk for WT-012.4. External behaviour is `specs/worktree-panel/spec.md`; why is
`proposal.md`.

An `asm-oracle` plan attack ran before Gate 2 on frozen artifacts. It refuted six claims and left
three unresolved; every finding was accepted and none rejected. What changed is recorded in the
decisions below and in `workflow.md`.

## Shape

```
readProvisioning(deps, repoRoot, prefer?)
  │
  ├─ ordered(prefer) ──> [nativeAdapter, asimovAdapter, orcaAdapter, vscodeTasksAdapter]
  │                        (§ 4.1 order; `prefer` still moves ONE entry to the front)
  │
  ├─ first adapter whose read() is non-null wins ─┐
  │                                               │
  │   read() answers AdapterRead, not a model:    │
  │     { model, extends?, exclude? }             │
  │                                               │
  └─ if the winner declared `extends` ────────────┤
        │                                         │
        ├─ the NAMED FILE must itself be present, and must belong to a
        │  FRAMEWORK adapter (§ 3.1–3.3). Otherwise `missingExtends`.
        ├─ base = that adapter's read(), on the SAME budget
        └─ merge(base.model, native.model, exclude) ──> one model
                                                          │
                                    providers[]: native active, base active,
                                    every other detected file active:false
```

## Decisions

### D1: `read()` answers a record, not a model

`ProviderAdapter.read` becomes `Promise<AdapterRead | null>` where
`AdapterRead = { model: ProvisionModel; extends?: string; exclude?: readonly string[] }`. The three
framework adapters return `{ model }`. The field is named `extends` everywhere — design, tasks and
code — because an earlier draft called it `base` in one place and `extends` in another.

The alternative was to keep `read()` returning a model and have the dispatcher ask the native module
separately for its `extends` target. That reads the file twice, and this codebase already rejected a
second open for a reason it wrote down: `asimovProvider.fromOpened` exists so "the adapter and the
plain reader each open the file exactly once and then agree on every other outcome — a second open
is a second chance for the file to change under the check." An `extends` target read from a second
open could name a different file than the one whose inline keys were parsed.

Keeping the native file inside `DETECTION_ORDER` rather than special-casing it before the loop is
what keeps presence probing, `prefer`, and the `providers[]` rows uniform across all four.

**AMENDED after round 3 (F002).** `read` also takes an optional map of already-authorized files, and
`openProviderFile` answers from that map instead of opening when the map holds `ctx.file`:

```ts
type Authorized = ReadonlyMap<string, OpenedProviderFile>;
read(deps: ProviderDeps, repoRoot: string, budget: ProviderBudget, authorized?: Authorized): Promise<AdapterRead | null>;
```

Round 1 closed F002 by wrapping `deps.readFile` instead, deliberately, to stay inside this decision
rather than change it. Round 3 proved that insufficient and the reason is structural:
`openProviderFile` re-runs root preparation and the containment check BEFORE it reaches `readFile`,
so a target that resolves outside the checkout on the adapter's own re-open never consumes the
pinned bytes at all — the named file drops out of the offer while its unnamed sibling still
contributes paths and a shell command. Pinning below the check cannot fix a defect in the check's
own re-execution. The authorization has to cross the boundary as a RESULT, which is a change to this
interface and is why it took a Gate 2 reopen.

Only the exact named file is authorized. Every sibling the adapter reads is opened live and checked
on its own, because D2 rule 3 wants the whole adapter and an adapter reading a stale sibling would
be a different defect.

**This is not suite-preserving.** `orcaProvider.test.ts` and `vscodeTasksProvider.test.ts` call
`adapter.read` and use the result as a `ProvisionModel`; both must unwrap `.model`. 1_2 declares the
suite change rather than claiming the suites pass untouched.

### D2: `extends` names a file, and that file must be there

Three rules, because the loose version of this decision was refuted three ways.

1. **Framework adapters only.** § 3.4 says the value is "a repo-relative path to any file section
   3.1–3.3 can read" — and 3.1–3.3 are asimov, orca and VS Code tasks. § 3.4 is the native file
   itself and is not among them. So `"extends": ".vscode/worktree.json"` resolves to nothing and is
   a `missingExtends` problem. Without this rule a one-node cycle is expressible: the resolver either
   loops or reads the native file twice and merges it with itself, duplicating its ports and setup
   steps. Deeper cycles are not expressible, because no framework format has an `extends`.
2. **The named file must itself be present.** Orca is one provider over two files, so adapter
   presence is not file presence: `"extends": "orca.yaml"` in a repository carrying only
   `.worktreeinclude` would otherwise select orca, get a non-null model, and silently inherit a file
   the user did not name — with no `missingExtends` anywhere. Presence is checked on the exact path
   named, before the adapter is asked for anything.
3. **Then the whole adapter reads.** Once `.worktreeinclude` is confirmed present and resolves to
   orca, orca reads *both* of its files. Reading half of orca would produce a model orca itself would
   not recognize.

A path matching no framework adapter's files, and a path whose file is absent, are the same
`missingExtends` problem. From the user's side both are "the thing you named is not something I can
read", and splitting them would mean explaining the adapter table in an error message.

### D3: the native rows are built first — which is a priority choice, not a neutral one

§ 4.2 states the merge as "start with the extended provider's model, append the native file's inline
entries, dedupe, native wins". Building in that order is unsafe under the shared row budget: the
inherited model can spend all 200 rows before a single native entry is appended, and then "the
native entry wins" is false precisely when the file is large — the case where a user most needs
their own override to hold.

So the two drafts are BUILT native-first on the shared budget and ASSEMBLED in § 4.2's order.

**What this preserves:** the dedupe outcome, the displayed order (inherited, then own), and setup
order (base then native), which § 4.2 makes load-bearing — "reordering or dropping steps changes
their meaning".

**What it deliberately changes, and an earlier draft of this decision wrongly claimed it did not:**
which file's declarations get the budget first. Both accounts are affected. A native glob that
consumes all 2,000 scan names leaves an inherited glob refused as past-budget, where base-first
would have produced the opposite model; the row cap allocates the same way. That is the intended
effect — the repository's own file outranks the one it inherits from — but it is a change in
observable output, not a reordering that cancels out.

**Problem order is chosen, not inherited.** Problems are assembled base-first, matching the entry
order, rather than falling out of whichever draft was built first. The blueprint does not specify
problem order, so it is specified here instead of being an accident.

Entry ids are not affected: `offerStore` remints every selectable id after assembly.

This is a deviation from § 4.2's literal wording. It goes to blueprint sync.

### D4: `active` marks every provider that contributed

Without `extends`, the native file is the sole active provider and every framework file is
`active: false` — § 4.1 states this outright, and the reason is that inline keys must never
implicitly overlay a framework.

With `extends`, both the native file and the file it extends are `active: true`. `active: false` is
what makes a row offer to switch, and offering to switch to the provider you are already building on
would be an offer to do what is already done.

### D5: a preference for a framework answers alone; a preference for native does not

Taking a switch to a **framework** provider populates the section from that source alone — including
when a native file exists, and including when that native file extends the very provider being
switched to. The user asked to see that source's answer; showing it wrapped in the native file's
additions would not be that source's answer.

`prefer: "native"` is different, and the loose version of this decision left it undefined. After
switching to a framework the native row becomes inactive, so clicking it sends `provider: "native"`
— and if every preference answered alone, that click would return the native file's inline rows
*without* the base it declares. The way back would not lead back. So a native preference means the
ordinary native path, `extends` and all.

### D6: the expand rule is superseded, not satisfied

`worktree-create.md` § 4.3 says mixed provenance is click-to-expand: a row from two files states a
source count collapsed, and names each provider expanded. That rule describes a one-row-per-KIND
section. The shipped section is one row per ITEM and each row already names its own file —
`WorktreeCreateDialog.bringRows` says so and says why ("one row per ITEM rather than the mockup's
one row per kind because the spec says each row names the file that declared it, which a 'Copy 2
files' row cannot do once two files came from two providers").

An earlier draft of this decision said the rule was "satisfied by construction". It is not: the
shipped UI has no collapsed source count and no expansion state, so it does not satisfy that rule —
it makes it unnecessary. The honest statement is that a per-item section supersedes a per-kind
affordance, and § 4.3's first bullet is stale. WT-012.4's PLAN acceptance asks for deliberate
excluded rendering and totals, never for expansion, so nothing accepted is being cut. Blueprint
sync.

### D7: one owner for the four inline keys

`.vscode/worktree.json` uses "the same shapes as the asimov adapter" (§ 3.4). That mapping is ~60
lines living in `asimovProvider.fromOpened`, and a second copy is exactly the drift the kit exists
to prevent. It moves to `providerKit` as one reader over an already-parsed record.

The mapping currently stamps `ASIMOV_PROVIDER_FILE` literally into `addPort` and `addSetup`, and
into every `problem(ASIMOV, …)` it raises. A shared copy would make native rows *and native
problems* claim they came from `asimov/worktree.yaml` — with the whole asimov suite still green,
because that is what it asserts. Provenance comes from `draft.ctx` instead, for problems as well as
rows.

An extraction has no behavioural witness — a correct extraction emits identical output — so
acceptance is a structural test in `oneOwner.test.ts`, not the asimov suite. The asimov suite is the
regression half only.

### D8: the root-failure diagnostic is not adopted here

Round-2 F009 of the previous change: every adapter answers `null` for an unresolvable repository
root, so the dispatcher returns `emptyModel()` and the root problem is discarded. Carrying it needs
an owner for "no provider was elected, and here is why" — a problem that names no provider file,
which every current `ProvisionProblem` does. That is a new invariant owner and appears in none of
WT-012.4's eight acceptance clauses. Follow-up PLAN task, not folded in.

### D9: every problem is charged to the budget, including the ones on an early return

`addEntry`/`addPort`/`addSetup` enforce the cap, and `report()` charges problems — but three paths
in `asimovProvider.fromOpened` return `problems: [problem(…)]` as a raw array without touching the
budget at all: an opened-file problem, a YAML parse failure, and a non-mapping document. One adapter
per read made that harmless. Two do not: a native draft can reach exactly the cap, and a malformed
inherited file then adds a 201st row to the concatenation.

So those early returns build a one-problem draft and go through `report()` like everything else, and
the same rule binds the native reader. The cap is a property of the read, not of a draft.

### D10: base, native, and exclude all naming one path

`exclude` never matches an inline entry (§ 4.2), so with `x` declared by the base, declared by the
native file, and excluded: the native row survives and is offered, and the contradiction is reported
as a problem naming `x`. Exclusion runs against the INHERITED set, which is what makes an inherited
`x` distinguishable from an inline one after dedupe — but the explicit inline-path check is also
required, because dedupe has already removed the inherited `x` by the time exclusion would see it.

The losing inherited `x` does **not** appear in `excluded`. It was superseded by dedupe, not
excluded by the user, and listing it as "deliberately excluded" would attribute to the user a choice
they did not make. `excluded` holds only paths the user removed and did not re-declare.

### D11: identity is the declared path, normalized, folded where the PLATFORM folds

`§ 4.2`'s "dedupe by `path`" and the spec's "exactly one row SHALL be offered for that path" are
answered here by the DECLARED path: `path.posix.normalize` plus a trailing-slash strip, then
lower-cased only where the PLATFORM's own path semantics are case-insensitive. `node_modules`,
`./node_modules` and `a/../node_modules` are one row and one exclusion target everywhere; `MixedCase`
and `mixedcase` are one row on Windows and two on POSIX. Nothing on this path touches the filesystem.

**Taken from two shipped implementations of the same problem**, both consulted for this decision and
both arriving at it independently: `orca/src/relay/git-handler-worktree-ops.ts:140-146` compares
worktree paths with `isWindowsAbsolutePath(left) && isWindowsAbsolutePath(right) ? lower === lower :
left === right`, and `t3code/apps/mobile/src/features/files/filePath.ts:80-82` does the same for
workspace-relative file paths. Neither probes a volume. Neither asks the filesystem what a name
means. This repository has already made and reviewed the same call one module over:
`entryGate.ts` folds a lockfile's Win32 aliases on Win32 path semantics alone (round-5 F028), and the
predicate is shared with this decision rather than spelled twice.

The stronger reading — that a path is a place on disk, so two case spellings of one file on a folding
volume are one row — was attempted five times and refuted five times. The attack log below is kept
because it is the reason this decision does not attempt a sixth, and because it is the specification
of the change that now owns the harder question.

**What moved out.** "Two declarations name one destination slot on a volume that folds names" is its
own invariant with its own acceptance story, and it consumed four review rounds inside this change
without closing. It is now a change of its own; this one ships without it and records the residual.

**The residual, stated plainly.** On a case-insensitive POSIX volume — the macOS default — an
inherited `mixedcase` and a native `MixedCase` are offered as two rows for one file, and `exclude`
naming either matches only that spelling. The user sees both rows and can act on them. That is
round-3 F001, reopened deliberately: it is the failure direction that does not silently discard
something the repository declared.

The one place this decision can still merge wrongly is a Windows directory with per-directory case
sensitivity turned on, where two real files fold to one row. That is the same exposure `entryGate.ts`
already carries for the lockfile rule and that round 5 accepted there; it is opt-in, rare, and it is
recorded rather than hidden.

#### D11 attack log — why the mechanism question is exhausted

Five mechanisms, one pattern. Lexical normalization SPLITS a destination the volume folds — a visible
extra row. Every object-identity mechanism MERGES two destinations the worktree keeps apart — a
declared row that silently vanishes.

| Mechanism | Refuted by | Failure direction |
|---|---|---|
| Lexical normalization only | round 3 F001 | extra row (visible) |
| **Lexical + Win32 platform fold — CHOSEN** | not refuted; what orca and t3code ship | extra row on folding POSIX (visible); merge only in a case-sensitive Windows directory |
| Does a case-toggled spelling of the native file exist? | round 4 F005 | dropped row (silent) |
| Do both spellings of that probe file resolve alike? | oracle, pre-build | dropped row (silent) |
| `realpath` each declared path | round 5 F008 | dropped row (silent) |
| `lstat` `dev`+`ino` each declared path | oracle, pre-build | dropped row (silent) |

The counterexamples, all reproduced on this host:

- **Existence is not folding.** On a case-sensitive volume `.vscode/worktree.json` and
  `.vscode/WORKTREE.JSON` can both exist as two files (round 4 F005).
- **A case-toggled SYMLINK to the probed file** makes both spellings resolve alike on a volume that
  folds nothing, so any single-file probe answers "insensitive" for the whole repository.
- **Case sensitivity is not a repository property.** A case-sensitive APFS volume mounts inside a
  case-insensitive one, and on Windows it is a per-DIRECTORY attribute, which
  `src/utils/resolvedPathBoundary.ts` already acknowledges. One boolean is the wrong SHAPE.
- **`toLowerCase` is not a filesystem fold.** `Straße`/`STRASSE`, `Σ`/`ς` and `ﬀ`/`ff` are each one
  file on ordinary APFS and two keys in JavaScript.
- **`realpath` dereferences.** Two symlinks `alias-a` and `alias-b` to one in-repository file give one
  resolved answer and two destination slots — one declared row dropped (round 5 F008).
- **`dev`+`ino` identifies an object, not an entry.** Two hard links are two directory entries with
  one inode, on both APFS variants; a symlinked PARENT defeats `lstat`'s no-follow property the same
  way. On Windows `st_ino` is the 64-bit NTFS file id read without `{ bigint: true }`, so ids past
  2^53 compare equal (Node #12115 records a real NTFS pair), it is not unique on ReFS, and remote
  filesystems may return zero; CIFS does not guarantee unique inode numbers under one share.

The invariant, stated one-way: **two declarations may merge only when it is proven they name one
destination pathname slot, and filesystem-object equality is not that proof.** Node exposes no
no-follow canonical-directory-entry-name call, so on these primitives the proof cannot be obtained.
The change that owns this question starts from that sentence, not from another primitive.

**What narrowing this closes by construction**, because the identity path no longer touches the
filesystem at all: round-5 F009 (raw `exclude` spellings reaching `realpath` outside the checkout),
F010 (the resolution bound) and F011 (the `realpath` contract) all cease to exist rather than being
fixed.

## Obligation ledger

Dispositions were written by the plan attack. Two rows were narrowed and one added in response.

| Claim | Semantics | Defeater | Witness | Disposition |
|---|---|---|---|---|
| A native entry that was admitted wins any path it shares with the inherited model, including its mode | For every path declared by both where the native entry is within the row cap, exactly one entry is offered and it is the native one | Native-first ordering alone does not save an overlap declared past row 199 of the native file's own list — the cap refuses it and the inherited copy too, so ZERO rows are offered for that path | Test: inherited file declaring more than the cap, native declaring one shared path early — assert one row, native's mode. Second test: native declaring the shared path past its own cap — assert the documented zero-row outcome and the cap diagnostic | supported (narrowed — the unnarrowed claim was refuted) |
| An entry's `source` is never rewritten | For every entry in `entries` and `excluded`, `source` equals the file its adapter read | Dedupe keeps the loser's source; exclusion re-stamps the native file as the source of what it removed | Test asserting source per row across merge, dedupe and exclusion; the excluded row keeps the ORIGINAL declaring file | supported |
| Identity is the destination on disk, on either kind of filesystem | Two declarations naming one file are one row and one exclusion target, whether they differ by dot-segment or by case, and two declarations naming two files stay two rows | A case-insensitive volume where `MixedCase` and `mixedcase` split into two rows and `exclude` matches neither; a case-SENSITIVE volume where unconditional folding merges two real files into one; a case-SENSITIVE volume that genuinely holds BOTH spellings, where an existence-only probe answers "insensitive" and drops a declared row; a case-toggled SYMLINK to the probed file, which makes any single-file probe answer "insensitive" on a volume that folds nothing; a case-sensitive volume mounted inside a case-insensitive repository, where no repository-wide answer is correct; `Straße` and `STRASSE`, which one macOS volume calls one file and `toLowerCase` calls two; two symlink aliases to one in-repository target, which `realpath` calls one destination and the worktree calls two; an `exclude` entry spelled `../outside`, which reaches the filesystem outside the checkout | Tests: `node_modules`, `./node_modules` and `a/../node_modules` are one row and one exclusion target on every platform; case-variant spellings are one row under Win32 semantics and two under POSIX; no filesystem call is made on the identity path at all (D11) | supported — narrowed to the platform reading that orca and t3code both ship, and to the fold predicate `entryGate.ts` already uses; the volume-level question moved to its own change |
| The authorized `extends` file is the file the base adapter reads | The bytes that passed the check are the bytes consumed, and the named file's material appears in the offer whenever the base contributes at all | Pinning below the containment check: `openProviderFile` re-runs root prep and containment first, so a target resolving outside on the re-open never reaches the pinned read while the sibling still contributes | Test where the named file resolves outside the checkout on the adapter's own re-open — assert its material is present and the sibling did not answer alone (D1 as amended) | supported (round 1's deps-wrapper was refuted by round 3) |
| `extends` reaches only a present file of a framework adapter, inside the repository | The named path is inside the root, belongs to § 3.1–3.3, and is itself present; otherwise `missingExtends` | `../` or a symlink out of tree; a path naming the native file itself, which self-merges or loops; `orca.yaml` named while only `.worktreeinclude` exists, which inherits a file nobody named | `contained()` reused not re-derived; tests for `../`, an out-of-tree symlink, `extends` naming `.vscode/worktree.json`, and each orca file named while only the other is present | supported (D2 rules 1 and 2 were added because the loose version was refuted) |
| One read spends at most `MAX_MODEL_ROWS` rows and `MAX_SCAN` names across every file it touches | Both accounts are shared by the native draft, the inherited draft, and every presence probe | A second `newBudget()`; an append that charges without enforcing; **an early-return problem path that builds `problems: []` directly and charges nothing** | Test: native draft driven to exactly the cap, then an inherited file that is malformed — assert the total never exceeds `MAX_MODEL_ROWS`. D9 routes every early return through `report()` | supported (D9 was added because the unrouted early returns refuted this) |
| Setup steps are neither deduped nor reordered | The offered steps are the base's in file order, then the native's in file order, duplicates intact | A `Set` or a path-keyed map used for setup as it is for entries | Test: identical command in both files; assert two rows and their order | supported |
| `exclude` never silently removes a row the native file itself declared | An excluded path matching an inline entry leaves the row and reports a problem | Applying `exclude` after dedupe, where the surviving native entry is indistinguishable from an inherited one | Test declaring and excluding the same path; assert the row survives, one problem names it, and `excluded` does not list the superseded inherited copy (D10) | supported |
| A missing `extends` target does not discard the inline keys | The native model is offered in full alongside a `missingExtends` problem | An early return on the failed resolution, before the inline keys are parsed | Test: `extends` naming an absent file plus inline `copy`; assert the row, the problem, and that Create stays available | supported |
| Nothing on this path executes or writes | No read-path module imports anything that runs a command or mutates the filesystem | A new module added to the directory and left off `readOnly.test.ts`'s lists | `readOnly.test.ts`, whose completeness check fails on an unlisted module — the new native module must be added to `READ_PATH` | supported |

## Risk Map

| Risk | Mitigation |
|---|---|
| A merged model makes the per-row source badge lie, so the user consents to a command believing another file asked for it | `source` is set once by the producing adapter and asserted per row through merge, dedupe and exclusion |
| `extends` used to read a file outside the checkout, the native file itself, or a file the user did not name | D2's three rules; `contained()` reused, never a second containment implementation (`rg -n 'function isPathInside' src/` must find nothing outside `pathBoundary.ts` and `resolvedPathBoundary.ts`) |
| Two adapters in one read exceed the row cap through a path that never charged it | D9 — every problem, including the early returns, goes through `report()` |
| The inherited model starves the native file's own entries under the row cap | D3 builds native-first on the shared budget; the residual case is documented rather than claimed away |
| The extraction in D7 silently re-stamps provenance on rows or problems | `draft.ctx` replaces the literals; structural test in `oneOwner.test.ts`, asimov suite as the regression half |
| A fourth adapter is added to the directory and escapes the read-only proof | `readOnly.test.ts`'s completeness check fails on any unlisted module |

#### D11 attack log — why this is now a scope question, not a mechanism question

`dev`+`ino` was attacked before it was built and refuted on this host:

- **Hard links.** `RealParent/Target` and `RealParent/HardAlias` are two directory entries with one
  inode, on both a case-insensitive and a mounted case-sensitive APFS volume. The apply derives each
  destination from `entry.path` independently (`entryGate.ts:234-235`), so they are two destination
  slots — and the key merged them. This is F008's failure reproduced through the primitive meant to
  fix F008.
- **A symlinked PARENT.** `lstat` does not follow the FINAL component, and the kernel walks the rest:
  `AliasParent/Target` and `RealParent/Target` return one identity and stay two destinations.
- **Windows.** libuv sets `st_ino` from the 64-bit NTFS file id and `provisioningDeps.ts:76` calls
  `lstat` without `{ bigint: true }`; past 2^53 distinct ids compare equal, and Node #12115 records a
  real NTFS pair that did. Microsoft documents that the id is not unique on ReFS and that remote
  filesystems may return zero.
- **Network mounts.** CIFS does not guarantee unique server inode numbers under one share, and those
  files share the mount's `dev`.

Every mechanism tried has failed in the same direction. Lexical normalization SPLITS a destination
the volume folds — a visible extra row. Every object-identity mechanism MERGES two destinations the
worktree keeps apart — a silently dropped row that the user declared. The four attempts are:

| Mechanism | Refuted by | Failure direction |
|---|---|---|
| Lexical normalization only | round 3 F001 | extra row (visible) |
| **Lexical + Win32 platform fold — CHOSEN** | not refuted; what orca and t3code ship | extra row on folding POSIX (visible); merge only in a case-sensitive Windows directory |
| Does a case-toggled spelling exist? | round 4 F005 | dropped row (silent) |
| Do both spellings of the probe file resolve alike? | oracle, pre-build | dropped row (silent) |
| `realpath` each declared path | round 5 F008 | dropped row (silent) |
| `lstat` `dev`+`ino` each declared path | oracle, pre-build | dropped row (silent) |

The invariant, stated one-way: **two declarations may merge only when it is proven they name one
destination pathname slot, and filesystem-object equality is not that proof.** Node exposes no
no-follow canonical-directory-entry-name call, so on the available primitives that proof cannot be
obtained. What remains is a scope question — whether the spec's "exactly one row per path" may be
read as the declared path rather than the place on disk — and that is the user's call, not this
document's.

Two consequences if the lexical reading is taken: nothing on the identity path touches the
filesystem, which closes round-5 F009 (uncontained `exclude` reaching `realpath`), F010 (the
resolution bound) and F011 (the `realpath` contract) by construction; and round-3 F001 returns as a
known residual — a case-variant duplicate row on a folding volume, which the user can see and
remove, rather than a declaration that vanishes.
