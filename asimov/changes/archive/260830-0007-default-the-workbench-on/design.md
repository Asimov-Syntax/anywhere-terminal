# Design: default-the-workbench-on

## Decisions

### D1: The setting is removed, not defaulted to `true`

Flipping `"default": false` to `true` would leave a supported way to ask for the old UI, and
therefore leave every OFF arm alive. The manifest entry, `readWorktreeWorkbench`,
`affectsWorktreeWorkbench`, the `worktreeWorkbench` init field and the `onWorktreeWorkbench`
message all go. A value left in a user's `settings.json` becomes an unknown key: VS Code marks it
in the settings editor and nothing reads it, which is the standard retirement and is what the
ADDED requirement asserts.

Rejected: keeping the entry with `deprecationMessage`. That is for a setting whose *behaviour* was
replaced by another setting a user should migrate to. There is no successor here — the answer to
"how do I turn it off" is that you no longer can — and a declared key invites a bug report when
writing it changes nothing.

### D2: Each consumer removes its own wiring, in an order the getters force

The dep fields are optional, but that does not make a partial removal type-check: `main.ts` passes
every one of them in a **direct object literal**, so excess-property checking rejects a property the
target type no longer declares. `main.ts` also calls the methods being deleted —
`vaultPanel.setWorkbench`, `tabBarScope.setWorkbench`, `worktreeController.setWorkbench` and
`isWorkbenchEnabled`. So a consumer cannot drop its contract while `main.ts` still supplies it.

Each consumer task therefore removes its own `main.ts` argument, property and method call in the
same task as its branch, and the tasks run in series because they share that file.

The order is forced by one cross-consumer read: `main.ts` passes
`worktreeController.isWorkbenchEnabled()` into `shouldCollapseAfterSelection`. The collapse
predicate must drop that argument **before** the controller loses the getter. Hence

```
1_1 VaultPanel  →  1_4 collapse predicate  →  1_2 View/Controller  →  1_3 scope coordinator
      →  2_1 router contract  →  2_2 setting + message  →  2_3 docs
```

`MessageRouter`'s `onWorktreeWorkbench?` handler member is optional, so the last consumer (1_3) can
delete the whole live handler from `main.ts` without touching the router; 2_1 then removes the now
unreachable interface member and its dispatch. Removing the transport first would instead break
every consumer at once, or silently hand each one `undefined` and flip it to the arm being deleted.

### D3: `shouldCollapseAfterSelection` keeps its other two conditions

Only the `workbench` parameter goes. `worktreeId !== null` and `isStackedLayout(layout)` are not
rollout gates — the first distinguishes a selection from a scope being cleared, the second is the
docked-versus-stacked rule — and the module's reason for existing (an invariant `main.ts` cannot
test, because it exports nothing) is unchanged.

### D4: `worktreeScope` survives

The persisted per-surface scope key belongs to the scoped tab bar, not to the rollout. A user who
had the flag on holds a scope; retiring the gate must not drop it. Nothing in this change touches
`WebviewState.worktreeScope` or its read/write path — only the coordinator's inert mode, which was
the flag's arm, not the key's.

### D5: OFF-arm tests are read, not deleted wholesale

Three kinds appear in the map and they are not interchangeable:

| Kind | What to do |
|---|---|
| A case whose subject IS the OFF arm ("renders shipped flat control", "selects nothing while workbench is off", "every part inert while setting off") | Delete — its contract is gone |
| A transition case ("recomposes when rollout off", "rollout turned off under the inspector") | Delete — there is no edge left to cross |
| A fixture that leaves an unrelated suite on the OFF arm | Remove the obsolete field, then read every case in that suite |

The third kind is the one that can pass for the wrong reason, and it has two shapes. The
`WorktreeController.test.ts` and `WorktreeController.state.test.ts` helpers set `init.workbench`
explicitly; those initializers are deleted with the field rather than flipped, and no remaining
assertion in either suite depends on the OFF arm once the two rollout cases are gone.

The shape that actually breaks tests is **implicit**: `WorktreeView.test.ts`'s `mount` omits
`workbench` entirely, which today means OFF because the dep is an optional getter. Making selection
unconditional changes five cases in that suite from "expansion equals card" to the ON arm's separate
`.wt-group` wrapper and selected `.wt-card`. Those five are named in task 1_2 and must be edited
case by case — a batch `.wt-card` rename would weaken them, because a collapsed selected worktree
keeps `.wt-card` on purpose.

### D6: The provider tests keep their non-boolean coverage, retargeted

`readWorktreeWorkbench` was strict `=== true` because a hand-edited `settings.json` can hold the
string `"false"`. That reader goes, and with it those seven cases per provider. They are deleted
rather than retargeted at another setting: the strictness rule they proved belongs to whichever
reader still needs it, and inventing a home for them here would be scope this change does not own.

## Failure-surface inventory

| Resource | Answer |
|---|---|
| The user's `settings.json` entry | Not written by this change and never was — the extension only ever read it. A stale entry is inert: nothing reads the key, so a malformed or leftover value cannot fail either open or closed. VS Code surfaces it as an unknown key in its own editor |
| `WebviewState.worktreeScope` (persisted webview state) | Untouched. The webview owns writes as it does today, serialized by being single-threaded; a scope for a worktree that no longer exists is already handled by the coordinator's drop path, which is the ON arm and is unchanged |
| Live configuration-change listeners in both providers | Removed with the setting. Nothing is left subscribed to a key that no longer exists, so there is no listener to fire on a user editing the stale entry |
| Two surfaces (sidebar and editor) holding different values | Was possible while the flag was live and is what the post-init resend existed to settle. With no value to disagree about, both surfaces compose the same way and the resend goes with it |

## Interfaces

Removed, in the order D2 gives:

```ts
// src/webview/vault/VaultPanel.ts
interface VaultPanelDeps { workbench?: boolean }          // and setWorkbench(enabled: boolean)
// src/webview/tabBarScope.ts
interface TabBarScopeDeps { workbench?: boolean }          // and its runtime setter
// src/webview/worktree/WorktreeView.ts
interface WorktreeViewDeps { workbench?: () => boolean }
// src/webview/worktree/WorktreeController.ts
interface WorktreeControllerDeps { init: { workbench: boolean } }
//   and setWorkbench(enabled: boolean), isWorkbenchEnabled(): boolean
// src/webview/worktree/WorktreeView.ts
class WorktreeView { refresh(): void }              // exists only for setWorkbench
// src/webview/tabBarScopeWiring.ts
interface TabBarScopeWiringDeps { workbench: boolean }   // required, not optional
interface TabBarScopeWiring { setWorkbench(enabled: boolean): void }
// src/webview/messaging/MessageRouter.ts
interface ... { onWorktreeWorkbench?(msg: WorktreeWorkbenchMessage): void }
// src/webview/vault/collapseAfterSelection.ts
function shouldCollapseAfterSelection(args: { workbench: boolean; ... }): boolean   // param only
// src/types/messages.ts
interface WebviewInitMessage { worktreeWorkbench: boolean }
interface WorktreeWorkbenchMessage { ... }                 // the message, and its ExtensionToWebviewMessage membership
// src/settings/SettingsReader.ts
function readWorktreeWorkbench(): boolean
function affectsWorktreeWorkbench(e: vscode.ConfigurationChangeEvent): boolean
```

## Risk map

| Risk | Mitigation |
|---|---|
| A branch deleted but its dep left accepted and ignored | Excess-property checking on `main.ts`'s direct literals makes this a compile error rather than a silent leftover, provided each task removes its own wiring (D2) |
| A consumer task leaving the tree not type-checking | D2's series order, and `verify-task` running the full type check per task |
| An unrelated suite passes for the wrong reason after its fixture flips | D5's third row: read every case in the two controller suites rather than batch-editing the helper |
| A CSS rule left matching nothing | `vault-segmented--flat` is emitted from exactly one place; the rule and the emitter are removed together, and the label-squeeze rule that depends on it goes with them |
| The spec keeps describing a setting nothing reads | Four MODIFIED requirements drop their `WHERE the workbench setting is enabled` clause and their "setting is off" scenarios; the tab-bar requirement that exists only to state the default is REMOVED |
