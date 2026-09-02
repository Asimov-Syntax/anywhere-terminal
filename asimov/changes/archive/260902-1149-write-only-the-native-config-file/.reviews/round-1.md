# Review round 1 — write-only-the-native-config-file

- Date: 2026-09-02
- Cycle: 1
- Mode: discovery
- Scope: range `750bd053~1..HEAD` (7 commits), reviewed at Head `b9a6523a`. Working tree clean apart from `asimov/changes/*/analytics.json`, which is not reviewable.
- Reviewable lines: ~640 added/modified across 12 reviewable files (2288 total insertions include change artifacts and tests). NOTE: `docs/ui/create-worktree.html` and `docs/ui/worktree-create-dialog.css` are not in this range; `docs/**` is skipped by classification regardless.
- Verify gate: `bun run asm change verify-status` reports 1_1–1_5 all `[x] exit 0`. Not re-run here.
- Agents spawned: 6 (data-security, logic ×2, contracts, frontend, reuse) + chair self-review and full-flow trace.
- Verdict: **BLOCK**
- Counts: 2 BLOCK · 10 WARN · 5 SUGGEST (17 findings, all persisted)
- Split over gating blockers: 2 feature / 0 machinery.

## Findings

### F001 — The containment answer never binds the path that is written through
- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Agent: chair + asm-review-data-security · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:233-245`
- Invariant: every path this module opens for writing resolves strictly inside the resolved repository root.
  - Boundary categories searched: parent resolution (directory exists), parent creation (directory absent), target `lstat`, lock file, temporary file, commit (`link` / `rename`).
  - Boundaries affected: parent resolution (re-derive window); parent creation (`mkdir` recursive through a planted symlink); the lock, temporary and commit inherit the escape from both.
  - Boundaries verified safe: the final component is refused when it is itself a symlink; `rename` rebinds the name rather than writing through a link.
- Evidence: `isResolvedPathInsideRoot(dir, prepared, deps)` returns a boolean and discards the directory it resolved. The code then calls `deps.realpath(dir)` a SECOND time and builds `target` from that second, never-checked result; a swap of `.vscode` between the two calls redirects every later operation. In the ENOENT branch `here` stays the unresolved logical `path.join(repoRoot, ".vscode")` and is never resolved at all — `LockedFile.acquireLock` then calls `mkdir(dirname(target), {recursive:true})`. Probed on this host: `mkdir` with `recursive:true` over an existing symlink-to-directory returns success, after which `open(lockPath,"wx")`, `open(tmp,"wx")` and `link(tmp, target)` all landed in `/tmp/wtprobe/evil` — the lock, the temporary and the full JSON document, outside the repository. The design's own D7 records this exact bypass as reproduced and closed; it is closed only for the pre-check plant, which is what `writeNativeConfig.test.ts:203` covers.
- Impact: violates the change's stated must-not ("must not write any path but `.vscode/worktree.json` … under any operation, in any repository state") and the obligation ledger's first row. A local attacker who wins a short race gets the extension to create attacker-named files with attacker-influenced JSON content anywhere the user can write.
- SuggestedFix: create the directory non-recursively (tolerating EEXIST) before resolving; `lstat` it and refuse a symlink; `here = realpath(dir)`; then re-run containment on `here` against `prepared` and build `target` only from the verified `here`. Re-assert the directory's identity inside `withLock`, immediately before `stageReplacement`, so check and write are separated by the lock rather than by an unbounded async gap.
- Status: accepted
- Triage: Accepted. D7 already MANDATES the fix — "the parent directory is resolved once ... and every subsequent operation names the resolved path" — and the code resolves twice and names the second, unchecked result. The ENOENT branch never resolves at all. This is the code failing a decision it already has, so it is remediation and not a design question. The recursive `mkdir` through a planted symlink is the part D7's own reproduction missed.

### F002 — An `extends`-less first write silently drops every inherited entry
- Severity: BLOCK · Confidence: HIGH · Priority: P1 · Agent: chair + asm-review-logic · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:98-101` (`divergenceOf`), `:207-220` (`firstDocument`)
- Evidence: when the active non-native provider has `present: []`, `divergenceOf` returns no `extends`. If the user has also cleared an inherited entry, `firstDocument` writes `{"exclude":["…"]}` alone. On the next read `readProvisioning` chooses the native adapter (it is first in `DETECTION_ORDER` and now present), `assemble` finds no `extends`, so `base` is null and NO inherited entry is contributed — the provider the exclusion was about is demoted to a switch offer. The one path removed becomes every path removed. `messages.ts` documents `present` as possibly empty and `readProvisioning.ts:112-127` explains why; design D11's claim that `present` is "non-empty wherever it appears" is contradicted by its own producer. `openProviderFile` also answers `at:"root"` (not `at:"file"`) when the root stops resolving, which gives every provider `present: []` at once.
- Impact: a transient condition turns one user exclusion into a checked-in configuration that hides the entire inherited provisioning set, in the repository's own file, with no report. This is the failure mode D11 exists to prevent, arriving through the branch D11 opened.
- SuggestedFix: treat an active non-native provider with empty `present` as a state the save cannot express — refuse (a new reason, or `unavailable`) rather than creating an `extends`-less native file. Separately, the author's known gap is the missing witness here: no test round-trips a written document back through the real `nativeProvider` reader, which is exactly what would have caught this and F010.
- Status: accepted
- Triage: Accepted, and it is NOT remediation. Refusing here needs a refusal the vocabulary cannot currently express: D9 enumerates `unavailable | outside | malformed | unwritable`, and every one of them would lie about a source file that simply went away. Reusing `unavailable` — the SuggestedFix's parenthetical — would report a held lock. This changes D9's enumeration and D11's claim about `present`, so it goes back to plan rather than into a fix commit. Carrying the missing round-trip witness through the real `nativeProvider` with it.

### F003 — The target symlink refusal and the mode capture are taken outside the lock
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: asm-review-data-security + asm-review-logic · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:247-269`
- Evidence: `lstat(target)`, the `isSymbolicLink()` refusal and `mode = stat.mode & 0o777` all run BEFORE `new LockedFile(...)` and before `withLock`. Inside the lock, `file.readText()` uses `readFile`, which follows symlinks. A target replaced by a symlink after the `lstat` is read through, `planEdits` runs on that foreign content, and the edited result is written to `target`. Two further stale-`mode` interleavings: a target replaced by a different regular file gets the prior file's permissions, and a target removed after the `lstat` takes the first-write branch while carrying an existing-file mode.
- Impact: the contents of any JSON-object file the user can read can be copied verbatim into a checked-in, likely-committed repository file. No write escapes — `rename` rebinds the name — so this is disclosure, not the must-not violation. The comment at line 250 ("the write would land wherever it points") describes a guarantee the check's placement does not provide. D3 already argues the lock must span the whole read-modify-write; the symlink verdict and the mode are part of that transaction and are outside it.
- SuggestedFix: move the `lstat`, the symlink refusal and the mode capture inside `withLock`, before `readText()`, and derive the read branch from that same locked observation.
- Status: accepted
- Triage: Accepted, remediation. D3 already says one lock spans the whole read-modify-write; the symlink verdict and the mode are part of that transaction and are currently outside it. The comment at :250 claims a guarantee the placement does not provide, which is the part that made this survive its own review.

### F004 — Whole-array edit spans destroy comments the save did not touch
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: chair + asm-review-logic · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:180-196`
- Evidence: `planEdits` replaces the ENTIRE array value — `modify(next, ["exclude"], [...excluded, ...added])` and the same shape for `copy`/`link`. Probed against the pinned jsonc-parser 3.3.1: a document with `"copy": [ /* comment */ ".env", /* comment */ "config.local.json" ]` and `"exclude": [ /* comment */ "node_modules" ]` came back with all three interior comments gone and both arrays reflowed — including the comment attached to `.env`, an element the edit KEPT. The narrow form preserves every one of them: `modify(t, ["exclude", n], v, {isArrayInsertion:true})` for an append and `modify(t, [key, i], undefined)` for a removal, probed in the same run.
- Impact: the spec requirement "a save SHALL preserve the comments and formatting of every part of that file it did not change" is not held for any array this writer edits. D4's narrowed claim ("bytes outside the spans `modify` returns are unchanged") survives literally, but the ledger's named defeater — nominating a span wide enough to make the property vacuous — is instantiated at array granularity rather than file granularity. Comment preservation is the headline reason this change edits text instead of re-serializing.
- SuggestedFix: plan element-level operations — indexed `isArrayInsertion` appends, indexed deletions in descending order — each applied against the current text.
- Status: accepted
- Triage: Accepted, remediation. D4's decision — claim only the outside-the-span property — is unchanged; narrowing `modify` to element granularity strengthens conformance rather than moving the decision. Comment preservation is the reason this change edits text instead of reserialising, so a span wide enough to reflow an array defeats the purpose while leaving D4 literally true.

### F005 — The span witness is computed from the implementation's own key path
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: chair · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.test.ts:152-167`
- Evidence: the test asserts `after === applyEdits(original, modify(original, ["exclude"], [...], …))` — the SAME whole-key path the implementation passes. The spans are obtained from `modify` rather than from the implementation, which defeats a nominated whole-FILE span, but they are not independent of the span WIDTH the implementation chose. The fixture reinforces this: `{\r\n\t// keep me\r\n\t"copy": [".env"],\r\n\t"exclude": ["dist"]\r\n}` places its only comment outside every array and gives each array a single element on one line, so no in-array content exists for the edit to destroy.
- Impact: the ledger row "comments and formatting survive an edit" is discharged by a witness that cannot fail for the defect in F004. This is why F004 shipped green.
- SuggestedFix: add a fixture carrying a comment inside `copy` and inside `exclude`, and assert those comments survive — an assertion stated in terms of the user's content rather than in terms of `modify`'s return.
- Status: accepted
- Triage: Accepted, remediation, and paired with F004 — fixing the span without fixing the witness would leave the ledger row discharged by a test that cannot fail. The replacement witness must obtain its spans independently of the key path the implementation passes, and the fixture must carry a comment INSIDE an array and an array with more than one element.

### F006 — A save that changed nothing creates a checked-in configuration file
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: chair + asm-review-logic · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:98-101`, `:207-220`
- Evidence: with no `.vscode/worktree.json`, an active non-native provider with a present file, and every row left ticked, `divergenceOf` returns `{exclude: [], drop: [], extends: present[0]}` and `firstDocument` writes an `extends`-only document. `divergenceOf` sets `extends` from the ACTIVE provider unconditionally; nothing distinguishes "the user took a different source" from "the user took no action at all". The design's D6 table records this row as "A different detected source taken", and D10 states "where nothing remains to do, the save commits nothing at all".
- Impact: pressing Configure without changing anything produces a new file in `git status` and pins detection to a source the user never chose to pin. The second press is a no-op, so the growth is bounded — but the first press is a change the user did not make. The change notes defend keying off `active` (a switch re-reads with the taken provider preferred); that argument justifies reading `active`, not writing it when nothing diverged.
- SuggestedFix: carry a switched/not-switched signal, or omit `extends` when the active provider is the one plain detection would have chosen anyway.
- Status: accepted
- Triage: Accepted, and it is NOT remediation. D6's table records `extends` for "a different detected source taken", and the code writes it for "an offer was on screen" — but which of those Configure means is a product question the artifacts do not answer. Writing nothing contradicts D6's row; writing unconditionally contradicts D10. Plan owns the choice.

### F007 — Every host-side save rejection returns silently; D1's "re-offers" is not implemented
- Severity: WARN · Confidence: HIGH · Priority: P2 · Agent: asm-review-contracts · Class: feature
- File: `src/providers/WorktreeHost.ts:2354-2367`
- Evidence: D1 states "An unknown, expired or foreign offer id writes nothing **and re-offers**." The handler does `if (shown === undefined || options.readProvisioning === undefined || options.writeNativeConfig === undefined) { return; }` and posts nothing; the `repo === undefined` branch below it does the same. `offers.lookup` returns `undefined` for exactly the "unknown, expired or foreign" case (`offerStore.ts:154-159`).
- Impact: a form holding a stale offer gets no correction and no feedback — the button appears inert. Downgraded from the specialist's BLOCK: task 1_4's hard Acceptance field is "a stale offer id writes nothing", which the code satisfies; the divergence is a missing refresh, not a defect in the write. That is the stated evidence delta.
- SuggestedFix: on `shown === undefined`, re-issue a fresh offer from the current `readProvisioning` result, mirroring the switch's completion path.
- Status: accepted
- Triage: Accepted, remediation. D1 says "writes nothing AND re-offers" and the handler implements only the first half. Task 1_4's Acceptance is satisfied either way, which is why the tests did not catch it — the Acceptance is narrower than the decision it was drawn from.

### F008 — Write refusals are reported as `unreadable`, so the section says "Could not be read"
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: asm-review-contracts · Class: feature
- File: `src/providers/WorktreeHost.ts:167` (`refusedSave`), rendered at `src/webview/worktree/WorktreeCreateDialog.ts:649`
- Evidence: `refusedSave` maps `unavailable`, `outside` and `unwritable` — all write-side refusals — onto `reason: "unreadable"`. Every other producer of that reason (`providerKit.ts:622,673,697,833`, `readProvisioning.ts`) uses it for read/parse failure only, and the dialog's summary keys off it directly: `model.problems.length > 0 ? "Could not be read" : "Nothing configured"`.
- Impact: a lock held by another process, a target outside the repository, or a failed rename all surface to the user as "Could not be read" for a file that read fine. D9's requirement is that a failed save "reports"; what it reports is wrong.
- SuggestedFix: widen `problems[].reason` with a write-specific value and branch the summary label on it, or give save refusals a surface of their own rather than overloading the read-failure channel.
- Status: accepted
- Triage: Accepted, and it is NOT remediation. `ProvisionProblem.reason` has five values and all five describe a READ failing; there is no vocabulary for a write refusing. Saying `unreadable` about a file that read fine is the same category error as F002's, and inventing a sixth value is a wire-type change under this change's own `new-api-contract` flag. Plan owns it, together with F002.

### F009 — Configure is offered where the host cannot honour it
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1209-1212`, `:1338`
- Evidence: `saveRow` is appended for every drawn offer, but the click handler calls the optional `deps.onProvisionSave?.(...)`. The dep is absent on every surface but the real extension entry point — the same shape the `writeNativeConfig` host option carries and for the same documented reason. The button's own comment justifies removing rather than disabling it when there is no offer, but applies no equivalent rule to there being no save capability.
- Impact: a visible control that does nothing and explains nothing. Pairs with F007: on the shipped surface, every host-side rejection is also silent, so "pressed and nothing happened" has several causes and no message.
- SuggestedFix: append `saveRow` only when `deps.onProvisionSave` is present.
- Status: accepted
- Triage: Accepted, remediation. I had built this on the `onProvisionSwitch` idiom deliberately, and the specialist's version of the finding — that other surfaces omit the dep — I would have rebutted, since production always supplies it. The chair's version is sharper and I do not rebut it: the control's OWN comment argues for removing rather than disabling it when there is no offer, and then applies no equivalent rule to there being no capability. The inconsistency is mine.

### F010 — An empty existing configuration is refused as `malformed`
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: asm-review-logic · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:155-162`
- Evidence: `parseTree("", errors, {allowEmptyContent: true})` returns `undefined` with NO errors, and `planEdits` maps `tree === undefined` to `null` → `malformed`. Probed on the pinned 3.3.1: `modify("", ["exclude"], ["x"])` returns a safe insertion producing a valid object. The read side treats an empty or comment-only native file as a present native configuration with no entries, not as malformed — so reader and writer disagree about the same file.
- Impact: a checked-in empty `.vscode/worktree.json` — an ordinary state after `touch` or after a user empties the file — can never be configured, and the reported reason ("could not be edited without rewriting parts this did not change") is not what happened.
- SuggestedFix: treat empty/comment-only content as an editable initial document; no-op on an empty divergence, otherwise build the initial document while preserving any comment-only content.
- Status: accepted
- Triage: Accepted, remediation. `parseTree("")` returns undefined with NO errors, so `planEdits` maps a well-formed empty file onto `malformed`. The read side treats the same file as a present configuration declaring nothing. Reader and writer disagreeing about one file is the defect F011 predicts structurally.

### F011 — `planEdits` re-implements `providerKit.readJsonc`'s parse policy
- Severity: WARN · Confidence: HIGH · Priority: P3 · Agent: asm-review-reuse · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:155-160`
- Evidence: the writer calls `parseTree` with `{disallowComments:false, allowTrailingComma:true, allowEmptyContent:true}` and then `getNodeValue` — byte-for-byte what `providerKit.ts:184-193` already does, options included. That module's comment records the policy as load-bearing ("both files this reads are edited by hands that write comments and leave a trailing comma").
- Impact: the parse policy for `.vscode/worktree.json` now lives in two places across the read/write boundary. A change to comment or trailing-comma handling can update the reader and leave the writer accepting a document the reader rejects, or the reverse — which is precisely the class F010 already exhibits for empty content.
- SuggestedFix: call `readJsonc(text, errors)` and keep only the writer-specific key-shape validation in `planEdits`.
- Status: accepted
- Triage: Accepted, remediation. Byte-identical options to `providerKit.readJsonc`, for the same destination the native READER already parses through that helper. F010 is this finding having already happened once.

### F012 — `isKnownSave` admits a `provider` key task 1_5 removed and nothing validates
- Severity: WARN · Confidence: MEDIUM · Priority: P4 · Agent: asm-review-contracts + asm-review-data-security · Class: feature
- File: `src/providers/WorktreeHost.ts:1546-1553`
- Evidence: `onlyKeys(msg, ["type","repoId","opening","switch","offerId","kept","provider"])` — copied from `isKnownSwitch` at line 1533. `WorktreeProvisionSaveMessage` has no `provider` field, the type guard checks no property of it, and the handler never reads it. Task 1_5 step 1 explicitly removed the field for a stated reason: "the named offer already records which provider was active, so a wire field beside it is a second answer free to disagree with the offer the user is looking at."
- Impact: none today. `onlyKeys` is the single enforcement point for D1's "ids and ordering, and nothing else"; an admitted-but-unchecked slot is where a future reader picks up unvalidated webview text — the exact shape 1_5 removed.
- SuggestedFix: drop `"provider"` from the allowlist.
- Status: accepted
- Triage: Accepted, remediation, and mine — task 1_5 removed `provider` from the type and the guard's value checks but missed the `onlyKeys` allowlist, which is the single enforcement point for D1's "ids and ordering, and nothing else". No test covers an extra key on a save; the equivalent switch test exists, which is what made the omission invisible.

### F013 — `divergenceOf` picks the active provider from a list that can hold two
- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Agent: chair · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:98`
- Evidence: `model.providers.find((p) => p.active)` assumes one active provider. `readProvisioning.ts:414` marks the `base` active in addition to the chosen native adapter — `providers.map((p) => (base !== null && p.id === base.id ? {...p, active: true} : p))` — so a native file with an `extends` publishes TWO active providers. `find` returns the right one only because `DETECTION_ORDER` (`readProvisioning.ts:44-48`) puts `nativeAdapter` first, which makes the native entry `detected[0]`.
- Impact: correct today, and correct for an incidental reason. Reordering `DETECTION_ORDER` — a plausible future edit with no visible relation to this module — silently changes which source gets written into `extends`.
- SuggestedFix: select the native provider explicitly (`find((p) => p.id === "native")` first, falling back to the active one), or have `readProvisioning` publish a single active provider.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation. Correct only because `DETECTION_ORDER` puts native first — an ordering fact doing load-bearing work with nothing pinning it.

### F014 — The save note is not associated with the control, and a save has no busy or confirmed state
- Severity: SUGGEST · Confidence: HIGH · Priority: P4 · Agent: asm-review-frontend · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts:1196-1199`
- Evidence: `saveNote` is a sibling `<span>` with no `id`; the button carries no `aria-describedby`. D6 requires the two unrecordable choices be "stated in the form BEFORE the save", and the statement is the note. There is also no busy state during an in-flight save and no confirmation on success — success is only the arrival of a fresh offer.
- Impact: a screen-reader user can activate the control without reaching the sentence that D6 makes the point of it.
- SuggestedFix: give the note an id and set `aria-describedby` on the button.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation. The note states what the save will NOT keep, which is exactly the text a screen-reader user needs before activating the control, not after.

### F015 — `notFound` duplicates the exported `isNotFound`
- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Agent: asm-review-reuse · Class: feature
- File: `src/worktree/provisioning/writeNativeConfig.ts:107-109`
- Evidence: `lockedJsonFile.ts:275-277` already exports `isNotFound` with equivalent behavior, and this module already imports from that file.
- Impact: filesystem error classification can drift between the module and the lock discipline it depends on.
- SuggestedFix: import `isNotFound`.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation.

### F016 — `kept` is unbounded in length
- Severity: SUGGEST · Confidence: MEDIUM · Priority: P5 · Agent: asm-review-contracts · Class: feature
- File: `src/providers/WorktreeHost.ts:1563`
- Evidence: `Array.isArray(m.kept) && m.kept.every((id) => typeof id === "string")` caps neither the array length nor per-element length. `divergenceOf` ignores unmatched ids, so nothing downstream rejects an oversized array either.
- Impact: low — the trust boundary is the extension's own webview. It is the one unbounded array in this validator pair.
- SuggestedFix: cap `kept.length` against the model's own row cap, or record the webview-only boundary as the reason not to.
- Status: accepted
- Triage: Accepted (SUGGEST), remediation. The ids are host-minted and checked against the offer, so an oversized `kept` costs work rather than authority — bounded anyway.

### F017 — Presence is probed with a full re-read of every provider file
- Severity: SUGGEST · Confidence: HIGH · Priority: P5 · Agent: chair · Class: feature
- File: `src/worktree/provisioning/readProvisioning.ts:88-99`, `:112-134`
- Evidence: `filesPresent` calls `openProviderFile(deps, repoRoot, ctx)` with neither the prepared `root` nor the `authorized` map, so every call re-runs `prepareResolvedRoot`, re-runs containment, and performs a full `readFile` whose bytes are discarded — once per file per detected adapter, on every `readProvisioning`. Growth axis: adapters × declared files, structurally capped at 4 × ≤2, so this is not a scale defect.
- Impact: a large `.worktreeinclude` or `asimov/worktree.yaml` is read twice per create-form open. The `authorized` seam `openProviderFile` accepts exists to avoid exactly this.
- SuggestedFix: pass the prepared root, and reuse the assembly's `Authorized` map where it already holds the file. The comment's ordering argument (probe last so it cannot consume the assembly's read) is unaffected by reusing a read that already happened.
- Status: accepted
- Triage: Accepted (SUGGEST) as recorded, non-gating. The chair's own note that the growth axis is structurally capped is the reason this is not a scale defect; passing the prepared root and the `authorized` map is still the cheaper shape.

## Sub-agents spawned

- asm-review-data-security: `writeNativeConfig` containment, symlink, lock, mode — `opus[1M]`
- asm-review-logic: `writeNativeConfig` edit planning, refusals, idempotence — `gpt-5.6-terra[1M]`
- asm-review-contracts: wire contract (`present`, `WorktreeProvisionSaveMessage`), validators, refusal mapping — `sonnet[1M]`
- asm-review-logic: host save handler ordering, D8 gate, publish guards — `sonnet[1M]`
- asm-review-frontend: Configure control, controller wiring, D6 statement — `gpt-5.6-luna[1M]`
- asm-review-reuse: reuse of `LockedFile`, `jsonc-parser`, `readJsonc`, boundary helpers — `gpt-5.6-luna[1M]`

## Notes

- The save-versus-switch ordering gate (D8) was reviewed against the existing `worktreeProvisionSwitch` handler and found byte-identical in slot spelling, set-before-await discipline, and post-await re-checks. Not a finding.
- `present` is filled at every `ProvisionProvider` construction site; message-type registration is complete across `WORKTREE_MESSAGE_TYPES`, `WebViewToExtensionMessage`, the dispatch switch, and the exhaustive SAMPLE map.
- No webview-supplied string reaches a filesystem destination: `repoId` is a lookup key only, and every written path traces to `repo.mainPath` plus host-read model text, serialized as JSON string values.
- The permission-preservation claim holds: `open(tmp,"wx",mode)` is umask-subject but `handle.chmod(mode)` is not, and `rename` preserves the inode. `stat.mode & 0o777` discards setuid/setgid/sticky, which is harmless for this file.
- Deliberate decisions confirmed as such and NOT reported: the single `unavailable` refusal reason (D9), setup steps and ports left unrecorded (D6), the shared save/switch sequence (D8), the module's placement and `NOT_READ_PATH` declaration (D2), and `divergenceOf` keying `extends` off the active provider (though F006 reports its unconditional consequence).

## Author-raised, outside the round

### A1 — Configure during an in-flight source switch cancels the switch and records the superseded source
- Severity: BLOCK (author) · Confidence: HIGH · Class: feature
- File: `src/webview/worktree/WorktreeCreateDialog.ts` (the take handler and the save handler), `src/providers/WorktreeHost.ts` (the shared slot)
- Evidence: taking a source mints `switch: N` and posts the switch, leaving the old offer drawn and Configure live. A Configure pressed before the reply mints `switch: N+1` against the OLD `offerId`, clears the host's ceiling, and writes a divergence whose `extends` comes from the superseded source. The in-flight switch then fails its own `provisionSwitch.get(slot) !== mine` re-check and is dropped with no report. Both halves behave exactly as D8 specifies; the defect is that the form permits the interleaving at all.
- Impact: the user's source change silently never happens, and the configuration records the source they were moving away from.
- Status: accepted
- Triage: Accepted, and NOT remediation. D8 defines how a save and a switch ORDER against each other; it does not say what the form may offer while a switch is outstanding, and both available answers (suppress Configure until the replacement offer lands, or model the pending source so a save cannot derive from a superseded offer) have failure modes the artifacts do not adjudicate — the first is reachable-stuck if the switch's read rejects, since that path publishes nothing. Plan owns the choice. Raised here because the chair verified the host's D8 gate as sound, which it is; this is one layer up.
- Provenance: found by `asm-review-frontend` as a P1 WARN in its own report, independently traced and confirmed by the author against `WorktreeHost.ts` before the chair reported. It does not appear in the chair's adjudicated list.

