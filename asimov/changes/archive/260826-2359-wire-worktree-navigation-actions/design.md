# Design: wire-worktree-navigation-actions

## Decisions

### D1: One predicate routes worktree messages, replacing the per-type case list

Both providers currently name each worktree message type in their own `switch`
(`src/providers/TerminalViewProvider.ts:1282`, `src/providers/TerminalEditorProvider.ts:639`,
two cases each). That list is replaced by a single membership test over the worktree message
types, so a new type is routed by being declared, not by being remembered twice.

This is not a tidy-up. The list already failed: `requestWorktreeSubagents` was added to the
message union, posted by the webview and handled by `WorktreeHost`, and reached neither
provider — the feature it belongs to is inert end to end, and no unit test could see it because
the host and the view are each tested alone. This change adds seven more types to the same two
switches, so the failure mode is not hypothetical, it is the expected outcome.

The membership test derives from the message union itself, and the completeness half is a real
constraint rather than an inert type alias:

```ts
// src/types/messages.ts
type AssertNever<T extends never> = T;
/** The worktree inbound subunion — the source of truth, not the array. */
export type WorktreeInboundMessage = Extract<WebViewToExtensionMessage, { type: `worktree${string}` | `requestWorktree${string}` }>;
export const WORKTREE_MESSAGE_TYPES = [...] as const;
/** Fails the build for a subunion member the array omits. */
type _NoneUnrouted = AssertNever<Exclude<WorktreeInboundMessage["type"], (typeof WORKTREE_MESSAGE_TYPES)[number]>>;
export function isWorktreeMessage(msg: WebViewToExtensionMessage): msg is WorktreeInboundMessage;
```

The subunion is derived by the shape of the type NAME, so membership is not a second list
somebody maintains. `satisfies` alone would only prove every array entry is valid; the
`AssertNever` alias is what makes an omitted member a compile error, and without it the routing
test — driven from the same array — would prove "every listed type routes" rather than "every
worktree type is listed", which is not the failure that occurred.

### D2: One action handler, owned by the host, shared by every surface

`WorktreeHost.handleMessage` gains the action types. The host already holds the tree cache and
the published presence — the two things every action must resolve against — and is already the
one component all three surfaces route worktree messages to.

The alternative, handling actions in each provider beside the vault handlers, was rejected on
the evidence above: it is the arrangement that lost `requestWorktreeSubagents`, and it puts
resolution in the component that does NOT hold the tree. `fileTreeHost.handleMessage` is the
repo's precedent for one shared handler behind three surfaces.

The host performs nothing itself. Every capability it cannot own arrives as an injected
function, exactly as `readDelegations` did:

```ts
export interface WorktreeActions {
  openFolder(path: string, mode: "newWindow" | "addToWorkspace"): Promise<void>;
  revealInOS(path: string): Promise<void>;
  copyText(text: string): Promise<void>;
  focusPane(paneId: string, viewId: string): Promise<void>;
  copyResumeCommand(entryId: string): Promise<void>;
  revealSessionCwd(entryId: string): Promise<void>;
  copySessionCwd(entryId: string): Promise<void>;
}
```

**Opening a terminal is the eighth capability and it is NOT one of these.** An earlier form of
this decision had `openTerminal(surface, cwd)` among them, implemented in `extension.ts`. Build
evidence refuted it: creating a pane is `sessionManager.createSession(viewId, webview, {cwd})`,
which the extension reaches only through a `TerminalViewProvider` (`doNewTerminal`,
`extension.ts:427`), and `WorktreeSurface` is constructed privately inside each provider's
`resolveWebviewView` — the extension holds no mapping from one to the other and cannot be given
one without inventing a registry that exists for this single call.

So it goes where the capability already lives: `WorktreeSurface` gains an optional
`openTerminal(cwd)`. This is the same shape as `post` — the surface IS the provider's own handle,
and every provider already builds one knowing its own `viewId` and webview. It changes nothing
about ownership: the host still resolves `worktreeId` against its cached tree and hands over the
path IT looked up. Only the party that performs moves, from a component that cannot to the one
that already does.

Optional for the same reason every other capability is: a surface that does not implement it
simply does not offer terminals, exactly as it behaved before actions existed.

**Two of the seven do not end in the extension at all**, and an earlier form of this decision
had them wrong. The preview overlay is entirely webview-owned: `PreviewController.open()` builds
and shows the floating shell and only then posts `requestVaultSessionDetail`
(`src/webview/vault/PreviewController.ts:227-263`), and the extension resolves detail without
ever opening UI. Focus is the same shape — revealing a VS Code surface
(`src/extension.ts:884-892`) is not selecting a pane inside that surface's webview.

So both requests are validated host-side and then answered back to the requesting surface, which
performs them. That needs an outbound half the panel does not have today — the outbound union
ends at `WorktreeTreeResponseMessage` (`src/types/messages.ts:1343-1390`) — so this change adds
one: a message telling the surface to show a preview for an entry id it did NOT supply, and one
telling the surface holding a pane to activate it. Host-side validation is unchanged and still
the point: the entry id and pane id the surface acts on are the host's, not the webview's.

`openTerminal` takes the requesting surface, because a new terminal tab belongs where the user
was. `worktreeCopyResumeCommand`'s optional `worktreeId` (`worktree-rpc.md` § 2.1) is a cwd
override for a resume, which is WT-005.3's concern; this change omits the field rather than
accepting one it would ignore.

### D3: Resolution is by id against what the host currently holds, and a miss does nothing

| Request | Resolved from | Value handed to the action |
|---|---|---|
| `worktreeOpenFolder`, `worktreeRevealInOS`, `worktreeCopyPath`, `worktreeOpenTerminal` | the cached tree | that worktree's own `displayPath` |
| `worktreeFocusPane` | the published presence | the row's own `paneId` + `viewId` |
| `worktreeOpenPreview`, `worktreeCopyResumeCommand` | the published presence | the row's own `entryId` |

The webview's copy of a value is never the value used. Where the request carries one — a
`paneId`, an `entryId` — it is compared against the host's own and the action runs only on
equality, which is `surface-subagent-history-rows` D1's expected-version rule applied to the
same class of problem: a surface whose last envelope was skipped still shows the previous
worktree or session under a stable row id.

A request naming a worktree or row the host does not currently hold performs nothing. It does
NOT fall back to a nearest match, a first repository, or the workspace root — an action that
"did something" against an unintended target is worse than one that did nothing.

`missing` worktrees resolve for `worktreeCopyPath` and for nothing else, which is what the menu
already offers (`WorktreeContextMenu.worktreeItems`): copying the path is how a user goes and
looks at what happened to a directory that is gone.

### D4: Focus resolves the pane's OWN view, and external rows are structurally unfocusable

`focusPane` receives the `viewId` the presence row carries, and the wiring reveals THAT surface
before activating the pane — `TerminalEditorProvider.findByViewId` for an `editor-` prefixed
view, `anywhereTerminal.sidebar.focus` / `.panel.focus` otherwise
(`src/extension.ts:887`). Revealing the surface the request came from would focus a pane the
user cannot see whenever the panel is open in two places at once.

An external row carries no `paneId` — `presenceTypes.ts` states `paneId` is present iff
`scope === "window"` — so the host cannot resolve a focus for one even if asked. The view's
absent menu item, the setting's override, and this resolution are three independent barriers,
and the innermost one holds when the other two are wrong.

### D5: Row activation reads one setting, and the setting cannot express the impossible

`anywhereTerminal.worktree.rowActivation` (`"focus" | "preview"`, default `"focus"`) is declared
in the manifest and read host-side through `SettingsReader`. It is carried to the view in the
`init` payload alongside `worktreeHasRepo`, which is the existing channel for host facts the
view needs before it paints.

Read host-side rather than in the webview, because the webview has no
`workspace.getConfiguration`, and delivered in `init` because the first click must not race a
request. `init` carries the INITIAL value only: `WorktreeHost.initPayload()` is already spread
into every init path (`TerminalViewProvider.ts:1379-1385`, `TerminalEditorProvider.ts:831-837`),
and `main.ts:986-991` currently forwards only `workspaceRoot` into the controller, so that seam
moves too.

A setting change reaches views that are already open. Every other UI setting here is live —
terminal settings are rebroadcast on configuration change (`src/extension.ts:804-844`) and
hover-preview settings have their own provider listeners
(`TerminalViewProvider.ts:202-215`) — and the existing `configUpdate` is terminal-only, consumed
solely by `factory.applyConfig`. Reload-required would be a worse behaviour than the panel's
neighbours already offer, so this change carries the update rather than declaring the gap.

The view applies it to window-scope rows only. An external row's activation is `preview`
unconditionally — the setting is not consulted, rather than consulted and overridden, so there
is no state in which the answer depends on reading the override correctly.

### D6: The two context menus become one shell, and the vault menu gains what it was missing

`src/webview/vault/VaultContextMenu.ts` and `src/webview/worktree/WorktreeContextMenu.ts` hold
the same lifecycle — element construction, cursor-anchored clamped placement, outside-pointer
dismissal, `Escape`, class toggling on the anchor row, listener teardown — and have drifted in
four places. The shell is extracted to `src/webview/shared/contextMenuShell.ts`; both menus keep
their own item sets and become callers of it.

The extraction resolves each drift toward the worktree menu's behavior, because in each case it
is the correct one and the vault menu is the one that lacks it:

| Behavior | Vault today | Worktree today | Extracted |
|---|---|---|---|
| Focus first item on open | no | yes | yes |
| `ArrowUp`/`ArrowDown` between items | no | yes | yes |
| `Escape` restores focus to the anchor row | no | yes | yes |
| Order of dismissal and the item's action | act, then close | close, then act | close, then act |

The last is load-bearing rather than cosmetic: an item that opens a dialog must not leave the
dialog anchored to a button that is removed before focus returns to it. The vault menu's
`Rename` item opens an inline editor, so the vault panel is where the bug lives.

Three copies is the admission test the repo's own blueprint sets for this
(`docs/PLAN.md` WT-005.1: "extracting the shared shell belongs here rather than growing a third
copy"). The shell owns lifecycle and keyboard behavior only. Item content, ordering, and the visibility
rules that make an unavailable item ABSENT rather than disabled stay with each menu, because
those are the rules each panel's spec owns.

One limit on what the extraction buys: the vault's `Rename` item opens an inline editor that
does not restore focus to the row when the edit ends (`vaultListView.ts:193-218`). Closing the
menu before the action runs is necessary for that to be fixable and is not sufficient for it, so
this change claims only the menu's own focus behavior and leaves the rename editor's to the
capability that owns it.

### D7: The seam that dropped a message is closed by a test that crosses it

`src/providers/TerminalViewProvider.worktree.test.ts` already drives a real provider against a
real host through `handleMessage`. Every worktree inbound type is asserted to reach the host
through both providers, driven from `WORKTREE_MESSAGE_TYPES` so a type added later without a
route fails the existing test rather than needing a new one.

This is the coverage the current defect proves is missing. Unit tests of the host and of the
view each passed while the path between them was broken, so the test that matters is the one
whose subject IS the path.

### D10: A menu offers an item only when something can perform it

`WorktreeMenuActions` requires every callback, and the menu offers lock, remove and resume
unconditionally or on `entryId` alone (`WorktreeContextMenu.ts:18-35, 62-106`). Wiring only the
read-only half would therefore mean passing no-op callbacks for the mutating and launch items —
producing controls that are present, look live, and do nothing.

That is precisely what `worktree-panel`'s accepted requirement forbids: an action the view cannot
perform is ABSENT, not present and inert. So the capabilities become optional, and an item whose
capability was not supplied is not built. WT-005.2 and WT-005.3 then light their own items by
supplying theirs, with no further change to the menu.

This relaxes what an earlier form of this decision fenced off: the extraction may not change
each menu's item SET or ordering, but the condition "something can perform this" is a new one it
must add, because it is the condition that keeps the absent-not-disabled rule true across three
changes landing at different times.

### D8: Two agent-row items the design refs never inventoried are wired from the session

`Reveal in Finder` and `Copy Path` on an AGENT row (`WorktreeContextMenu.ts:104-105`) appear in
neither `worktree-actions.md` § 2's inventory nor `worktree-rpc.md` § 2.1's message table, yet
the menu already offers them. Left unwired they violate D10; invented as new host behavior they
would duplicate work the vault already does.

They resolve through the row's `entryId` to the session's recorded working directory, which is
what `handleVaultOpenWorkingDir` and `handleVaultCopyFilePath` already do
(`TerminalViewProvider.ts:851-878`). A row with no `entryId` has no recorded cwd, so the two
items are offered only when the row has one — the same condition already gating resume.

### D9: A subagent row's activation focuses its parent, which is why this change owns it

`WorktreeView` exposes and calls `onActivateSubagent`, and a test already proves it targets the
parent row (`WorktreeView.test.ts:420-429`), but `WorktreeController` never supplies it — the
`surface-subagent-history-rows` change deferred it here on the grounds that row activation is
WT-005.1's. Wiring it is therefore this change's obligation, not an extension of scope: a
subagent row is currently presented as actionable and does nothing.

It resolves to the PARENT row's focus action, per `worktree-panel-ui.md` § 3.4 — a subagent has
no pane of its own, so sending the user anywhere else would be a dead click.

## Architecture

```
right-click / activate ──> WorktreeContextMenu | row activation (setting, window rows only)
                                  |
                        postMessage: worktree* { <id>, ... }
                                  |
     TerminalViewProvider / TerminalEditorProvider: isWorktreeMessage(msg) ──> host   [D1]
                                  |
     WorktreeHost.handleMessage
        worktreeId --> cache.read() --> that worktree's own displayPath
        rowId      --> published.presence --> that row's own paneId/viewId/entryId    [D3]
                                  |
                     miss, or a carried value that no longer matches --> nothing
                                  |
                     hit --> options.actions.<capability>(resolved value)             [D2]
                                  |
     extension.ts: vscode.commands / env.clipboard / findByViewId(viewId)             [D4]
```

## Risk Map

| Component | Risk | Mitigation |
|---|---|---|
| Provider routing | A new worktree message type is declared and never routed, exactly as `requestWorktreeSubagents` was | Membership test derived from the union, plus a compile-time exhaustiveness check and a cross-seam test driven from the type list (D1, D7) |
| Id resolution | An action runs against a target the user did not see — a reused row id, a removed worktree | Resolution against the host's own current tree/presence, carried values compared not used, and a miss performing nothing (D3) |
| Menu shell extraction | Behavior-preserving in name only: two menus with four known differences merged into one, in a webview whose panels are separately spec'd | Each drift resolved deliberately and recorded (D6); the vault menu's changed behavior is a spec delta, not a silent side effect |
| Focus pane | Focusing a pane in the surface that raised the request rather than the one holding it | The `viewId` travels on the presence row and is what the wiring reveals (D4) |
