# fs-watcher-pool Specification
## Requirements

### Requirement: WatcherPool singleton

The system SHALL expose a `WatcherPool` constructor in `src/providers/fsWatcherPool.ts` whose returned instance is wired exactly once in `src/extension.ts` (the same place `GitDecorationProvider` is constructed) and passed by reference into every `FileTreeHost` created in `TerminalViewProvider`, `TerminalEditorProvider`, and any later provider. No other call site SHALL invoke the constructor — additional pool instances would defeat cross-host refcounting.

### Requirement: subscribe contract

The `WatcherPool` SHALL expose `subscribe(absPath: string, onInvalidate: () => void): vscode.Disposable`. The returned disposable's `dispose()` removes only the calling subscriber. The pool SHALL create the underlying `vscode.FileSystemWatcher` lazily on the first subscriber for a given path key and dispose it on the last unsubscribe. The map key SHALL be the raw `absPath` string — no case-folding is applied (case-normalization is documented as a v1 limitation per design.md Design Constraint #5).

### Requirement: Watcher construction

For each newly watched path, the pool SHALL construct exactly one `vscode.FileSystemWatcher` via `vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(absPath), '*'), /*ignoreCreate*/ false, /*ignoreChange*/ true, /*ignoreDelete*/ false)`. The pattern SHALL be `*` (direct children only); recursive `**/*` is forbidden in this change. `ignoreChange` SHALL be `true` because the file-tree row does not display modification time.

### Requirement: Per-directory trailing debounce

The pool SHALL coalesce every `onDidCreate` and `onDidDelete` for a given watched path through a 150 ms trailing debounce. Within the debounce window, multiple events SHALL collapse into a single fanout to subscribers; the timer SHALL be reset on each new event.

### Requirement: Fanout to all subscribers

When the debounce timer fires for a given path, the pool SHALL invoke every `onInvalidate` callback registered for that path exactly once per debounce cycle, in registration order. Callback exceptions SHALL be caught (`try/catch`) so one failing subscriber does NOT abort fanout to the rest; caught exceptions SHALL be logged with `console.warn`.

### Requirement: Soft cap on watched paths

The pool SHALL emit `console.warn` exactly once per cap-crossing when the count of currently-watched paths first reaches 500 (e.g. `"[fsWatcherPool] watch count reached 500 — review usage"`). The pool SHALL continue creating watchers past the cap (soft only); no eviction occurs.

### Requirement: ENOSPC / EMFILE surfacing

When `createFileSystemWatcher` throws (or its constructor signals a watch-error via VS Code's underlying file service), the pool SHALL log a single `console.error` line including the path and the error code (`ENOSPC`, `EMFILE`, or `<unknown>`), and SHALL NOT re-throw. For a path subscription, subscribers SHALL still receive a disposable, but invalidation events for that path SHALL silently drop until the next process restart.

### Requirement: dispose() force-releases

The `WatcherPool` SHALL expose `dispose(): void` that, when called, immediately disposes every active `vscode.FileSystemWatcher`, clears all per-path debounce timers, and empties the subscriber registry. Post-dispose calls to `subscribe()` SHALL return a no-op disposable (no listener registered, no watcher created).

### Requirement: Window focus re-sync hint

The `WatcherPool` SHALL accept an `onDidChangeWindowState: vscode.Event<{focused: boolean}>` injection in its constructor options (defaulting to `vscode.window.onDidChangeWindowState`) AND an `initialWindowFocused: boolean` injection (defaulting to `vscode.window.state.focused`). It SHALL expose a `vscode.Event<void>` named `onDidRequestRehydrate`. Whenever the injected window-state event fires with `focused === true` AND `focused` was previously `false`, `onDidRequestRehydrate` SHALL fire exactly once.

#### Scenario: Initial focus state mirrors window state

- **WHEN** the pool is constructed with `initialWindowFocused: true` and the window-state event source then emits `focused: true`
- **THEN** `onDidRequestRehydrate` SHALL NOT fire (no rising edge — the pool was already in `focused: true`)

#### Scenario: First focus event after construction with unfocused window does trigger rehydrate

- **WHEN** the pool is constructed with `initialWindowFocused: false` (window was unfocused at activation) and the window-state event source emits `focused: true`
- **THEN** `onDidRequestRehydrate` SHALL fire exactly once (this is the user returning to the window — the rehydrate is correct)

### Requirement: Testability — injected factories

The `WatcherPool` constructor SHALL accept an options bag `{ createFileSystemWatcher?: typeof vscode.workspace.createFileSystemWatcher, onDidChangeWindowState?: vscode.Event<{focused: boolean}>, initialWindowFocused?: boolean }` so unit tests inject fake implementations without monkey-patching the `vscode` module. When omitted, the real `vscode.workspace.createFileSystemWatcher`, `vscode.window.onDidChangeWindowState`, and `vscode.window.state.focused` SHALL be used.

### Requirement: Pattern subscription failure is observable

A pattern subscription SHALL report whether it is live and, when it is not, the reason — so a caller cannot mistake a dead subscription for a working one. The returned value SHALL remain disposable whether or not a watcher was created, so a caller that ignores the outcome behaves exactly as before.

#### Scenario: A pattern subscription whose watcher could not be created reports it

- **WHEN** watcher creation throws for a pattern subscription
- **THEN** the returned subscription reports itself as not live, carrying the reason

