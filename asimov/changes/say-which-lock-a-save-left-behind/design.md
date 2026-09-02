# Design: say-which-lock-a-save-left-behind

## Decisions

### D1: No pathname reaches the user, and this is the finding that shaped the change

The plan attack refuted the whole premise of naming the lock, on a schedule no disposition table can
close: the wire carries a pathname and text, never an identity, and a human acts on it minutes later.
Between the identity check and `unlink` the name can be rebound; between the report and the user's
hand, our lock can be removed and a NEW writer can take the same name. "Remove this file" is then
advice to delete a live lock — the same harm the reverted attempt shipped, only slower.

There is no version of that advice that is safe while the name is reboundable, so this change gives
the user no pathname at all. It says the file was saved and may still be locked. That is actionable
enough — the user closes the other window, or waits — and it cannot be turned into a wrong deletion.

Removing a lock SAFELY means code re-verifying identity at the moment of removal, which is an action
this panel does not have. That is left to a future task rather than approximated here.

### D2: This is already shipping, in the installer

`ClaudeHookInstaller` collects the paths `releaseLock` refuses (`:91-117`), and
`AgentHookController.formatWarning` (`:358-360`) joins `unresolved` into the warning the user sees.
An identity MISMATCH returns `false` today (`lockedJsonFile.ts:270-271`), so the pathname of another
writer's lock is already being shown. That is a pre-existing defect, found by this change's plan
attack rather than introduced by it, and it is fixed here because it is the same defect: the installer
stops naming a path it cannot vouch for.

This REVERSES the earlier decision to leave the installer's behaviour identical. Leaving it identical
would have meant knowingly preserving the harm.

### D3: `releaseLock` answers what happened, exhaustively

The boolean collapses distinguishable situations, and the first table drawn for it missed one. Read
against `lockedJsonFile.ts:258-283`, every reachable exit:

| Situation | Disposition | Vouched? |
|---|---|---|
| `handle.stat` throws, or any unexpected throw | `indeterminate` | no |
| `lstat` `ENOENT`, held handle `nlink === 0n` | `alreadyGone` | nothing remains to speak about |
| `lstat` `ENOENT`, held handle `nlink > 0n` | `movedAway` | our lock exists under some other name we cannot address |
| `lstat` fails for another reason | `indeterminate` | no |
| `lstat` succeeds, identity differs | `notOurs` | no — and never nameable |
| identity matched, `unlink` succeeded | `released` | see below |
| identity matched, `unlink` `ENOENT` | `released` | the name was already free |
| identity matched, `unlink` failed otherwise | `stuck` | a lock is very likely still there |

`movedAway` is the arm the first table omitted; it is reachable and it is not `alreadyGone`.

Two honest limits, stated rather than designed away. `released` is a claim about the NAME at the
moment of the unlink, not proof the held inode was deleted — a rename between the check and the
unlink means we removed whatever then held the name. And `stuck` is likewise a claim about that
moment. Both are why D1 refuses to turn any of them into a deletion instruction. Their cause is a
reboundable name, which is WT-012.21's subject.

Only `stuck` and `movedAway` mean the user may hit a lock; both produce the same message, because the
difference between them is not something the user can act on differently.

### D4: A written file is not an unsaved one, on the wire and in the summary

`ProvisionProblem.reason` (`src/types/messages.ts:944`) has six values and its comment defines
`unsaved` as "a save was refused and nothing was written". A written-but-locked save is a seventh
thing, and the renderer proves it matters: `WorktreeCreateDialog.ts:735` reads

    model.problems.every((p) => p.reason === "unsaved") ? "Not saved" : "Could not be read"

so reusing `unsaved` prints "Not saved" over a file that was saved, and reusing anything else prints
"Could not be read" over a file that read fine. A `locked` value is added and the summary gains its
own arm.

That comparison is NOT exhaustive over the union, so the type checker will not enumerate consumers —
the first plan claimed it would and was wrong. The inventory is taken by hand and lives in task 1_3.
`media/webview.js` contains the same string but is a BUILD ARTIFACT and untracked; it is not a site.

### D5: The report rides with the write, and one publication is out of reach

The lock is known before the reread is attempted (`WorktreeHost.ts:2483` vs `:2492`), so it is
carried on the write's outcome and a rejected reread cannot swallow it.

The `publish` closure also drops everything when a NEWER source switch has occurred (`:2430-2454`).
That one is not a defect to fix: the panel is then showing a different file, and attaching this
file's lock to it would be a false statement about what the user is looking at. The spec's
"failed refresh" requirement is therefore about the reread, and supersession is named here as
deliberately uncovered.

### D6: One identity helper

`sameIdentity` (`lockedJsonFile.ts:292-296`) and the comparison in `openRegularFile`
(`regularFileRead.ts:97-105`) are the same predicate written twice; the second was added by
WT-012.19. Both coerce with `BigInt` and both throw on a missing field, so extraction is literal and
changes neither caller's error handling.

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| `releaseLock` | A branch mapped to the wrong disposition | D3's table is the contract; one witness per row on a real filesystem |
| installer warning | Dropping paths hides a real problem from the user | Only paths it cannot vouch for are dropped; the warning still fires, and its suite is acceptance |
| wire `reason` | A consumer misses the new value, since the check is not exhaustive | Hand inventory in task 1_3, plus the contract test |
| summary | "Not saved" over a written file — the defect this exists to fix | Witnessed at the renderer on a POPULATED model, not an empty one |
| growth axis | none | n/a |

## Obligation ledger

| Claim | Semantics | Defeater | Witness / check | Disposition |
|---|---|---|---|---|
| No pathname for a lock reaches the user | Neither the panel nor the installer warning names one | The reverted attempt, and the installer's current `unresolved` join | A witness on the installer warning for a mismatch, and the absence of any path field on the panel's lock report (tasks 1_1, 1_2) | supported — D1, and D2 which fixes the shipping case |
| A written file is never summarised as unsaved | Summary AND detail say written, on a model that actually carries problems | A witness on an empty model, which returns counts before inspecting problems | A renderer witness on a POPULATED written-but-locked model, asserting the summary string (task 1_3) | supported — the empty-model hole was named by the plan attack and the witness is specified against it |
| The disposition table is exhaustive | Every reachable exit of `releaseLock` maps to exactly one value | The `ENOENT` + `nlink > 0n` arm, which the first table omitted | D3's table, drawn against `:258-283`, with a witness per row (task 1_1) | supported as corrected — was `refuted`; `movedAway` is the added arm |
| `released` and `stuck` are claims about a moment, not proofs | Neither is turned into an instruction to delete | Reading them as durable facts | D1's refusal to emit a pathname; D3 states both limits | supported |
| A lock survives a failed reread | The report is carried on the write's outcome | Publishing it inside the reread's success path | A witness rejecting the reread and asserting the report still arrives (task 1_3) | supported — D5 |
| Supersession is deliberately uncovered | A newer switch drops it, and that is correct | Claiming the report always arrives | D5, and the spec scoping the requirement to the refresh | supported |
| The cause of a reboundable name is not addressed | Nothing here repairs or prevents substitution | Reading "names no path" as "handles it" | The proposal's non-goals; WT-012.21 owns it | supported |
