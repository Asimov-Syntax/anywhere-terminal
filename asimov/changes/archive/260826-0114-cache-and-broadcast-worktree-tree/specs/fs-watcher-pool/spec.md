## MODIFIED Requirements

### Requirement: ENOSPC / EMFILE surfacing

When `createFileSystemWatcher` throws (or its constructor signals a watch-error via VS Code's underlying file service), the pool SHALL log a single `console.error` line including the path and the error code (`ENOSPC`, `EMFILE`, or `<unknown>`), and SHALL NOT re-throw. For a path subscription, subscribers SHALL still receive a disposable, but invalidation events for that path SHALL silently drop until the next process restart.

## ADDED Requirements

### Requirement: Pattern subscription failure is observable

A pattern subscription SHALL report whether it is live and, when it is not, the reason — so a caller cannot mistake a dead subscription for a working one. The returned value SHALL remain disposable whether or not a watcher was created, so a caller that ignores the outcome behaves exactly as before.

#### Scenario: A pattern subscription whose watcher could not be created reports it

- **WHEN** watcher creation throws for a pattern subscription
- **THEN** the returned subscription reports itself as not live, carrying the reason
