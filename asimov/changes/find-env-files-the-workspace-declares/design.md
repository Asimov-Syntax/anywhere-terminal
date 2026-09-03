# Design: find-env-files-the-workspace-declares

## Decisions

### D1: Where to look is the repository's own declaration, never a guess

The detector reads two manifests, in this order, and stops at the first that declares packages:

- `package.json` — `workspaces` as an array, or as `{ "packages": [...] }` (the bun/yarn shape
  `koto-prototype` uses);
- `pnpm-workspace.yaml` — `packages:`.

These are manifests, not candidate secrets, and they are the same class of checked-in untrusted file
the provider adapters already open through `openProviderFile` — bounded by `MAX_PROVIDER_BYTES` and
parsed with the reader's own `readJsonc`. A repository declaring no workspaces keeps exactly today's
root-only behaviour.

Refusing a malformed manifest is an explicit act, not a property inherited from the parser.
`readJsonc` RECOVERS: it returns whatever tree it could build and appends syntax errors to a
caller-supplied array rather than throwing (`providerKit.ts:185-194`), which is why
`nativeProvider.ts:104-121` reports the errors and then keeps processing the recovered keys. A
detector that only checked `parsed === undefined` would therefore read `workspaces` out of
`{"workspaces":["apps/*"],"broken":` and act on half a file. This detector refuses on a non-empty
error array as well as on an undefined parse, and a refused manifest yields no workspace suggestions
at all rather than the ones that happened to survive.

Guessing conventional directory names (`apps/`, `packages/`) was rejected: it finds nothing in a
repository that names its workspaces differently and invents directories in one that has none, and
neither failure is visible to the user.

### D2: A declared pattern expands through the existing bounded scanner

Each declared pattern is resolved with `providerKit`'s own machinery rather than a second
implementation: `splitGlob` for the one `*` permitted in a final segment, `contained` for the
resolved-path containment rule, and `scanNames` against the shared `ProviderBudget` for the single
`readdir` a glob costs. A pattern this reader does not implement — more than one `*`, or a `*`
outside the last segment — is skipped rather than interpreted generously, exactly as
`entriesFor` skips it.

The budget is the one the whole read already spends, and the row cap that bounds `postMessage` and the
DOM is the same one.

`MAX_SCAN` alone does not bound this, and assuming it did was the plan's first real hole. It counts
directory-entry names examined during WILDCARD expansion; a literal path skips `splitGlob` and
`scanNames` entirely and never increments `budget.scanned` (`providerKit.ts:771-805`, `:307-310`). A
manifest declaring ten thousand literal workspace directories would thus buy ten thousand
containment resolutions and seventy thousand `lstat` probes without touching the scan budget, and the
row cap cannot stop it because probing happens before any row exists.

So the detector charges its own work: every resolved workspace directory — literal or glob-expanded —
counts against the shared `ProviderBudget` before it is probed, and a directory that cannot be
charged is skipped. Declared patterns are then bounded whatever their spelling, which is the property
the requirement actually asks for.

### D3: One level, and only the fixed names

Inside each resolved workspace directory the detector probes the same fixed environment filenames
from `SUGGESTED_ENV_FILES` with the same required typed `lstat`, accepting ordinary files only. It
does not descend further, does not enumerate the workspace directory to discover names, and never
calls `readFile` for an environment file at any depth. Depth is exactly: repository root, plus one
level inside each declared workspace directory.

### D4: A row names the path the copy will use

A workspace suggestion carries its repo-relative POSIX path (`apps/web/.env`) as both `path` and
`source`, because that is the file whose presence is the evidence and the file the copy will read.
The explanation names the same path, so a user comparing two rows can tell `apps/web/.env` from
`apps/server/.env` — which a row displaying the bare filename could not.

Root suggestions are unchanged and are offered first, so the common case reads the same as before.

### D5: Setup stays a root question

A workspace install runs once at the repository root, so the lockfile-derived setup suggestion keeps
its existing root-only rule. Probing every package for its own lockfile would offer several installs
where the repository wants one.

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| No environment file's contents are read at any depth | Across the whole fallback, `readFile` is called only for the two manifest names; every environment candidate is decided by `lstat` alone | A `.env` is opened, or a workspace directory is enumerated and a matching name read | Dependency spy asserting the exact `readFile` call list, over a repository carrying root and nested environment files | supported — no counterexample; the witness is task 1_1's |
| Nothing outside the repository is inspected or offered | Every resolved workspace directory and every candidate inside it passes the existing resolved-path containment rule | A `../../*` pattern, an absolute pattern, or a symlinked package directory pointing out of the checkout produces a row or a probe outside | Containment tests over escaping spellings and a real symlinked package directory | supported — `openProviderFile` resolves and contains before opening (`providerKit.ts:666-701`), and candidates are decided by `lstat`, which does not follow |
| The work a repository can cause is bounded | Every resolved workspace directory is charged to the one shared `ProviderBudget` before it is probed, and rows to `MAX_MODEL_ROWS`, across every pattern in the read | A manifest of many LITERAL directories probes past the cap, because literal paths never increment `scanned` (`providerKit.ts:771-805`) | Budget tests over literal-only, glob-only, and mixed manifests against one budget, plus a directory larger than the scan cap | supported — D2 amended after the defeater was demonstrated in shipped code |
| Widening where we look does not widen when we look | A present provisioning source, including an empty or unreadable one, still suppresses every suggestion | A workspace environment file is offered over a repository that has a provisioning source | The existing three-state integration witnesses, extended to a workspace repository | supported — no counterexample; the witness is task 1_1's |
| A malformed or hostile manifest yields no suggestion rather than a wrong one | A parse reporting ANY syntax error, or a `workspaces` value of the wrong shape, produces no workspace suggestions and no crash | `readJsonc` recovers `workspaces` from a truncated file and reports errors out-of-band, so an undefined-only check acts on half a manifest (`providerKit.ts:185-194`) | Manifest-shape tests across array, object, absent, malformed-but-recoverable, and non-string members | supported — D1 amended to refuse on a non-empty error array |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Manifest read | A checked-in file steers the reader | Bounded read, reader's own parse, refuse rather than repair (D1) |
| Pattern expansion | An escaping or unimplemented pattern is interpreted | `splitGlob` + `contained`, skip what is not implemented (D2) |
| Depth | Discovery becomes a recursive scan | Exactly one level, fixed names, no enumeration for names (D3) |
| Scale | A large monorepo floods the offer | Each resolved directory charged before probing, plus the shared row cap (D2) |
| Display | Two packages' files look identical | Repo-relative path as path, source, and explanation (D4) |
