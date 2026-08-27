# worktree-panel Specification

## MODIFIED Requirements

### Requirement: Each cause of emptiness reads differently

The view SHALL distinguish, in its rendered copy, a workspace with no folder, a workspace whose
folders hold no repository, an unavailable git, and a filter that matched nothing. None of these
SHALL be presented with error styling, and a first load with no tree yet SHALL render placeholder
rows rather than a spinner in an empty panel. The unavailable-git copy SHALL be shown only when no
listing is retained.

## ADDED Requirements

### Requirement: A retained listing is shown rather than replaced by an empty state

When git is unavailable and a listing is retained, the view SHALL render that listing and SHALL
show a whole-tree affordance naming the cause, rather than an empty state. That affordance SHALL be
announced as a status rather than an alert.

#### Scenario: Git becomes unavailable while the panel shows worktrees

- **WHEN** git becomes unavailable while the panel is showing a repository's worktrees
- **THEN** those worktrees stay on screen under an affordance naming the cause
