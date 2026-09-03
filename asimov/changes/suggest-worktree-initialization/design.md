# Design: suggest-worktree-initialization

## Decisions

### D1: Suggestions are a bounded fallback, not another provisioning provider

`readProvisioning` consults existing providers exactly as it does today. Only when none is present does
it call one fallback detector over fixed repository-root names:

- environment: `.env`, `.env.local`, `.env.development`, `.env.development.local`, `.env.test`,
  `.env.test.local`, `.envrc`;
- setup: `pnpm-lock.yaml` → `pnpm install`, `package-lock.json` → `npm install`, `bun.lock` or
  `bun.lockb` → `bun install`, `yarn.lock` → `yarn install`.

Detection accepts ordinary files only, proven through a required, typed stat dependency — not
`ProviderDeps`' optional untyped `lstat`. The detector declares its own dependency whose
`lstat(path)` resolves to `{ isFile(): boolean }`; `readProvisioning` requires that intersection in
its signature, and `createProvisioningDeps` declares that it supplies it (Node `fs.promises.lstat`
already satisfies it). A caller that cannot stat cannot compile a fallback. Detection performs no
directory enumeration and never calls `readFile` for an environment file or lockfile. `bun.lock` and
`bun.lockb` are one manager and produce at most one row. Distinct managers each produce one unchecked
row; the detector does not invent precedence between contradictory lockfiles.

A present provider, including an empty or unreadable one, still answers and suppresses this fallback.
Suggestions therefore do not participate in provider ordering, switching, or `extends`.

### D2: The host-issued model carries suggestion provenance and initial consent

`ProvisionEntry` and `ProvisionSetupStep` gain an optional bounded `suggestion` explanation. Presence
of that field means the row is opt-in: file suggestions start unchecked, as setup rows already do.
The `source` remains the root filename whose presence is the evidence (`.env`, `pnpm-lock.yaml`, and
so on); the explanation is static host text and contains no file content.

The existing offer store remints ids and retains the full model. Create still submits only `offerId`
and item ids, and the host redeems paths and scripts from its current model. No new webview-to-host
path or command field exists.

The dialog renders the explanation beside the row. Environment explanations say the file may contain
secrets and that Copy creates an independent worktree file. Setup explanations name the lockfile and
say Run setup executes after file provisioning. With suggestion rows present but none selected, the
summary says **No suggestions selected** rather than “Nothing configured.” The true empty state says
no configured items or supported root suggestions were found.

### D3: Save distinguishes no opinion from positive file consent

An unselected suggested entry is absence of consent, not a request to exclude the path. `divergenceOf`
therefore ignores unselected suggestions. A selected suggested copy becomes `addCopy` in the native
configuration divergence; the native writer appends it to `copy`, preserving existing formatting,
comments, permissions, lock discipline, and idempotence.

Suggested setup steps never enter the divergence. Pressing Save with no selected file suggestion and
no other expressible change writes nothing. After a selected environment suggestion is saved, the
native configuration is the repository's provisioning source: the normal re-read returns the saved
file as a native configured copy and — per D1 — no fallback suggestion, file or setup, appears on a
later form. Suggestion authority is bounded to the configuration-free state; a user who wants a
standing setup step after saving declares it in the native file, which the existing configure surface
already reads. This is the deliberate resolution of the save-versus-reoffer conflict the plan attack
refuted: re-offering setup over a present source would reintroduce fallback authority D1 forbids.

### D4: Setup-before-agent recommendation is a dependent UI change

This change makes setup commands discoverable but does not alter the existing `waitForSetup` default.
`recommend-setup-before-agent` will own the dialog preference state: recommend waiting when agent and
setup are both selected, preserve an explicit overlap choice, and explain the order. Splitting keeps
the host evidence/save invariant independent from the after-create sequencing preference.

## Obligation Ledger

| Claim | Semantics | Defeater | Witness/check | Disposition |
|---|---|---|---|---|
| Secret values are not inspected for suggestions | Detection performs at most the fixed-name calls of a required typed `lstat` dependency and zero `readFile`/`readdir` calls for the fallback | `.env` contents are opened, a wildcard enumerates arbitrary names, a symlink is accepted, or `readProvisioning` is invocable without the stat dependency | Required typed `lstat` in `readProvisioning`'s signature; detector test spies every dependency call across regular, absent, symlink, directory, and failing entries; integration tests prove fallback runs only when every provider is absent and never over an empty or unreadable present provider | supported |
| Nothing suggested is copied or run without explicit current-offer selection | Every suggestion starts unchecked; Create carries only selected opaque ids; the host redeems the path/script from its current offer | A suggestion starts selected, a stale/foreign id resolves, or webview text reaches apply/setup | Dialog defaults, offer remint/lookup, host action, and assembly create tests | supported |
| Saving an untouched suggestion records no preference | Unselected suggestions produce no `exclude`, `drop`, or `addCopy`; setup never enters divergence | Pressing Save on untouched suggestions creates config, excludes an env file, or persists a command | Pure divergence tests plus first-write/idempotence writer tests | supported |
| Explicit Save can persist only the selected file suggestion | A selected suggested copy appends one native `copy` entry; no framework file is written and no setup consent is stored; the saved native file then governs and no fallback suggestion survives | Save writes another tool's file, duplicates the path, writes setup, or a later form re-offers a fallback suggestion over the saved source | Writer tests plus an end-to-end save/re-read test asserting the saved copy returns as a native configured entry and the model carries no suggestion rows, setup included | supported |

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Root detection | Secret values or unbounded names are inspected | Fixed names, `lstat` only, ordinary files only, no recursion (D1) |
| Suggestion display | An unchecked command looks authorized or unexplained | Suggestion marker/reason and existing unchecked setup default (D2) |
| Create redemption | Webview path/script becomes authority | Existing scoped offer id and host-held model remain the only redemption path (D2) |
| Save | Unticked suggestion becomes exclusion, or setup gains standing consent | Separate `addCopy`; suggestions ignored when unticked; setup excluded from divergence (D3) |
| Multiple lockfiles | The extension silently chooses a package manager | One unchecked row per detected manager; no precedence claim (D1) |
