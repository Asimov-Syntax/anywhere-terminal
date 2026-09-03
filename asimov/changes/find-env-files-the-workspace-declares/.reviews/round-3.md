# Review round 3 — find-env-files-the-workspace-declares

- Date: 2026-09-04
- Cycle: 2
- Mode: discovery
- Arbiter: yes
- Head reviewed: `a7d22a461c5491ec273bd5c229e1f1e501eeb424` (`review/find-env-files`)
- Diff scope: `git diff 25bba4a3fd218d326ff8c22f18279c82902799d0..review/find-env-files`
- Tree: the active checkout is on a different branch and dirty in an unrelated change; the explicit ref range was reviewed without including that state
- Reviewable lines: 227 added/modified across 2 reviewable production files; 354 added test lines reviewed inline; change-state Markdown and the persisted round-1 file were context/skipped targets
- Agents spawned: 5 specialists plus `asm-finder`
- Agents skipped: `asm-review-frontend` — no frontend production code changed; consent and opaque-id behavior were traced through existing production plus changed end-to-end tests
- Verdict: **REJECT**
- Status: **blocked**
- Counts: 3 BLOCK · 1 WARN · 0 SUGGEST open; 4 prior findings fixed
- Split over gating blockers: 3 feature / 0 machinery

## Agents

| Agent | Region | Lens | Model |
|---|---|---|---|
| asm-review-data-security | manifests, directory containment, candidate probing, offer/apply boundary | secrets and security boundaries | `opus[1M]` |
| asm-review-logic | declaration states, glob branches, failures | edge cases and control flow | `gpt-5.6-terra[1M]` |
| asm-review-contracts | D1–D5, task boundaries, model contracts | accepted obligation compliance | `sonnet[1M]` |
| asm-review-performance | manifest and directory growth axes | bounded work | `gpt-5.6-terra[1M]` |
| asm-review-reuse | openProviderFile and entriesFor discipline | reuse and boundary cohesion | `gpt-5.6-luna[1M]` |
| asm-finder | detection through selected nested-file application | full-flow support trace | inherited |
| chair | complete range | all lenses, prior-witness verification, full-flow trace, arbitration | `gpt-5.6-sol[1M]` |

Verification evidence: the accepted task records at the reviewed ref show task verification exit 0 and the workflow records 7621/7621 twice. The coordinator reports the remediation at 7626/7626 on three runs plus two failures under the repository's documented load flake, and check-types clean. The chair ran no project verify command or suite; it used only disposable targeted probes for exact finding witnesses.

---

## Open findings

### [F002] Refused higher-priority package declarations still fall through to pnpm

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-contracts + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:105-113,134-180`
- Status: accepted; persists from round 1
- Triage: The syntax-error witness now closes, but the accepted invariant's wrong-shape boundary remains open. Targeted probes combining a valid lower-priority `pnpm-workspace.yaml` with `workspaces: 42`, `workspaces: "apps/*"`, or `workspaces: {"nope":["apps/*"]}` all emitted `apps/web/.env`. The existing wrong-shape test remains vacuous for precedence because it supplies no pnpm manifest.

**Invariant.** A present higher-priority declaration that this reader refuses to interpret must terminate workspace discovery; only absence or a valid no-declaration state may fall through.

**Boundary inventory.** Affected: present `workspaces` values of an unrecognized shape and all-invalid arrays that `patternsOf` collapses to `[]`. Verified safe: JSONC syntax errors now return `refused`; valid non-empty declarations stop; a genuinely absent key or valid empty declaration falls through; valid package declarations suppress pnpm. Top-level `null` is a separate crash mechanism in F006.

**Evidence.** `patternsOf` returns the same empty array for “no key” and “present but invalid shape.” `packageDeclaration` maps any empty result to `{ kind: "none" }`, and `declaredWorkspaces` consults pnpm for every `none`. The round-1 F002 inventory and the approved obligation ledger explicitly name wrong-shaped `workspaces`, not only parse errors.

**Impact.** A malformed primary workspace declaration still lets a lower-priority file govern filesystem probing and offers. The central D1 fail-closed decision is only partially implemented.

**Suggested fix.** Distinguish key absence/valid emptiness from a present unrecognized shape; map the latter to `refused`. Add a wrong-shaped-package plus valid-pnpm witness.

---


**Status:** accepted
**Triage:** Correct and load-bearing. `patternsOf` collapsed "absent" and "present but unsupported" into the same answer, so a wrong-shaped `workspaces` handed authority to the lower-priority manifest — the exact fall-through the round-1 fix was meant to close. Fixed: `patternsOf` now returns `undefined` for an unsupported shape, `packageDeclaration` maps that to `refused`, and only `none` falls through. Witnesses: `[F002] a wrong-shaped workspaces value is refused, not read past` and `[F002] an absent workspaces key still falls through to pnpm`.

### [F006] A top-level JSON `null` aborts all fallback suggestions

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:134-148`
- Status: accepted
- Triage: A disposable probe with `package.json` containing only `null` threw `TypeError: null is not an object (evaluating 'parsed.workspaces')`. `readJsonc` returns `null` with no parse errors, so the refusal guard does not run. The rejection propagates to `WorktreeHost`, which catches it without publishing the provisioning offer.

**Evidence.** `parsed === undefined` is checked, but `parsed === null` and the top-level object shape are not validated before direct `.workspaces` access. The pnpm path uses optional chaining for its corresponding access, confirming the asymmetry.

**Impact.** One hostile or damaged checked-in manifest makes the complete Bring over section disappear, including independent root `.env` and root lockfile setup rows. This violates the obligation that malformed/hostile manifests produce no workspace suggestions and no crash.

**Suggested fix.** Refuse a non-record top-level package value before reading `workspaces`, and add a `package.json: null` witness that also proves root and setup suggestions survive.

---


**Status:** accepted
**Triage:** Correct, and worse than the report scopes it — the throw escaped the whole offer, dropping root `.env` and the lockfile setup step too, so a malformed manifest silently disarmed a feature that has nothing to do with workspaces. Root cause is that `readJsonc` RECOVERS: it returns the tree it built with no error for `null`, and the code read `.workspaces` off it. Fixed by `recordOf()` — a non-record manifest is `refused`, never dereferenced. Witness: `[F006] a manifest that is not a record does not take the whole offer down`, covering `null`, a number, a string, and an array.

### [F007] An absolute single-segment glob is reinterpreted as a repository-root glob

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:222-250`
- Status: accepted
- Triage: A disposable probe with `workspaces: ["/*"]` and `web/.env` returned `web/.env`. `splitGlob("/*")` yields an empty `dir`, so the F005 root-glob exemption skips containment and scans the checkout root rather than refusing the absolute pattern.

**Invariant.** An escaping or unsupported spelling must be refused, never reinterpreted as a different in-checkout pattern.

**Boundary inventory.** Affected: absolute one-segment glob spellings such as `/*` and `/prefix*` after slash normalization. Verified safe: absolute literals pass through `contained` and refuse; nested absolute globs retain a non-empty parent and refuse; `../*` refuses; the valid relative `*` now works.

**Impact.** A hostile manifest can make the extension scan and offer files from a directory the repository did not declare as a workspace. This is the exact generous/clamping behavior D2 and the specification prohibit, even though the eventual probes remain inside the checkout.

**Suggested fix.** Reject absolute pattern spellings before `splitGlob` and before applying the root-glob exemption. Add paired `*` accepted / `/*` refused witnesses.

---


**Status:** accepted
**Triage:** Correct. `splitGlob("/*")` reports an empty parent, which is precisely the shape the deliberate root-glob exemption at `providerKit.ts:822` trusts, so containment was never consulted and `/*` was executed as `*`. Fixed by rejecting absolute spellings before `splitGlob` runs, so the exemption keeps its intended narrow meaning. Witness: `[F007] an absolute glob is refused rather than read as a root glob`, covering `/*`, `/etc/*`, and `//*`.

### [F008] The final parent-budget charge can still trigger an eager directory read

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: asm-review-performance + asm-review-logic; adjudicated by chair
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:242-250`
- Status: accepted
- Triage: With `budget.scanned = MAX_SCAN - 1` and a non-root glob, the parent charge reaches `MAX_SCAN`, but `deps.readdir(...)` is still evaluated before `scanNames` checks its zero room. A targeted Promise-backed dependency materialized 100,000 names and recorded one listing despite zero remaining name capacity.

**Growth axis.** Directory entry count is repository-controlled and uncapped for the Promise form permitted by `SuggestDeps`. Production currently supplies a lazy async generator, so the real shipped dependency does not open the directory in this exact zero-room state; this full-flow reachability evidence downgrades the performance specialist's BLOCK to WARN.

**Impact.** The module's supported dependency contract can perform unbounded eager work after the shared account is exhausted, and it diverges from `entriesFor`'s explicit pre-listing exhaustion check.

**Suggested fix.** Re-check `scanExhausted(budget)` after charging the glob parent and before invoking `readdir`, or narrow the dependency contract to a lazy listing and enforce it at the shared scanner boundary.

---


**Status:** accepted
**Triage:** WARN, accepted and fixed rather than backlogged, because the cost is the same class as the bound it defends: the parent-containment charge can itself spend the last unit, and a Promise-backed `readdir` has already materialized the whole directory by the time `scanNames` bounds what it keeps. `scanExhausted(budget)` is now re-checked after the charge and before the syscall. Witness: `[F008] a directory is not read once the account is spent`.

## Prior finding dispositions

### [F001] Workspace manifests bypass resolved containment before reading bytes

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security + asm-review-reuse
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:124-131`
- Status: fixed
- Triage: Both manifest names now go through `openProviderFile` with the already-prepared root. Fake and real symlink probes confirmed an outside-resolving manifest is rejected before `readFile`; no external bytes were read. Stable outside workspace-directory and final-leaf symlinks also produced no rows.
- Evidence: the witness redirects both manifest names and asserts the read list is empty; a chair real-filesystem probe returned no rows for a symlinked external package manifest.
- Impact: closed — external manifest bytes no longer steer discovery.
- SuggestedFix: none.

### [F003] A missing or unreadable glob directory discards the fallback offer

- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: chair + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:248-257`
- Status: fixed
- Triage: Enumeration is now caught per pattern. Both synchronous and production-style asynchronous failures are inside the awaited `try`; the witness preserves root `.env` and `pnpm install` rows.
- Evidence: targeted probe returned root `.env` plus `pnpm install` when the workspace listing threw.
- Impact: closed — one workspace path no longer erases independent fallback rows.
- SuggestedFix: none.

### [F004] Refused declarations perform filesystem work without spending the scan budget

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-performance + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:211-246`
- Status: fixed
- Triage: Declaration and glob-parent charges now occur before containment, and the outer loop breaks when exhausted. A near-cap escaping-manifest probe reached exactly `MAX_SCAN` and stopped after five declaration resolutions.
- Evidence: the F004 witness plus chair call-count probe close literal refusal, glob-parent, and loop-exhaustion boundaries.
- Impact: closed for production filesystem discovery; F008 is a separate eager-dependency boundary.
- SuggestedFix: none.

### [F005] A supported root-level `*` workspace pattern can never match

- Severity: WARN
- Confidence: HIGH
- Priority: P2
- Agent: chair + asm-review-logic + asm-review-data-security
- Class: feature
- File: `src/worktree/provisioning/suggestProvisioning.ts:237-250`
- Status: fixed
- Triage: The parent check now applies only when `glob.dir !== ""`. The corrected root-listing fixture and a chair probe both returned `server/.env` and `web/.env` for a relative `*`. F007 is a different mechanism: absolute syntax collapsing into that exemption.
- Evidence: the F005 witness closes the valid relative root-glob path.
- Impact: closed for `*`.
- SuggestedFix: none.

## Findings considered and not carried

- `scanNames.truncated` was reported as producing a partial wildcard offer. Refuted: truncation necessarily exhausts the shared scan account, and every returned name then fails `charge` at `scanExhausted`; that glob contributes no partial rows.
- Equivalent dot-segment spellings were reported as duplicate suggestions. Not carried: the existing provisioning contract deliberately preserves declared spellings and groups lexical/folding contenders; no accepted obligation requires canonical deduplication here.
- Mapping every `openProviderFile` problem to absence was reported separately. Not split from F002 where the problem represents a refusal; unreadable manifests were explicitly treated as legitimate fallthrough in round 1, while wrong-shape fallthrough remains the concrete accepted blocker.

## Full-flow trace

- **Detection:** `extension.ts` supplies `createProvisioningDeps`; its manifest reads remain bounded regular-file reads and directory enumeration is lazy in production. `readProvisioning` reaches suggestions only after every supported provisioning source is absent. Manifest containment is fixed; F002 and F006 remain in package declaration classification, and F007 remains in glob spelling classification.
- **Scale:** manifest bytes are capped; accepted/refused declarations and wildcard parents now share `MAX_SCAN`; candidate names use `scanNames`; each accepted directory causes exactly seven `lstat` probes; output rows share `MAX_MODEL_ROWS`. F008 remains only on the Promise-backed dependency boundary, not the current production generator.
- **Presentation and consent:** host `offerStore` remints and holds the model; suggested entries render unchecked; the webview submits only `offerId` and item ids. No path or command authority moved into the webview.
- **Apply:** the host redeems selected ids against the exact held offer. `entryGate` revalidates both source and destination containment before copy, and apply retains its no-clobber/no-follow boundaries. The changed assembly test proves the selected package env reaches the same relative destination and the unticked sibling contributes nothing.
- **Error paths:** package classification can still reject the whole suggestion read through F006; workspace enumeration failures are now isolated. `WorktreeHost` intentionally lets create defaults continue when provisioning read rejects, so that failure appears as a missing Bring over section rather than a create crash.

## Arbiter dispositions

- F002 — **accepted**. The persisted round-1 invariant explicitly includes wrong-shaped `workspaces`; direct evidence shows valid pnpm still governs those cases. Gating.
- F006 — **accepted**. A repository-controlled top-level `null` deterministically throws and erases the complete provisioning offer, falsifying the hostile-manifest/no-crash obligation. Gating.
- F007 — **accepted**. An absolute glob is demonstrably reinterpreted as a different relative pattern, violating the accepted refuse-not-clamp boundary. Gating.

No blocker is external, rebutted, or eligible for audit backlog. No user-granted risk acceptance exists. The change remains parked with `STATUS: blocked`.
