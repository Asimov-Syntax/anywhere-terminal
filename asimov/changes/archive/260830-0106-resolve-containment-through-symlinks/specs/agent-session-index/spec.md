# Spec Delta: agent-session-index — resolve-containment-through-symlinks

## ADDED Requirements

### Requirement: Enumeration is not exempt from containment

A transcript reached by **enumerating** a directory beneath a store root SHALL be containment-checked
on the same terms as one reached by resolving an id. Being listed under the root is not evidence of
being inside it, and an entry that fails the check SHALL be skipped without failing its siblings.

#### Scenario: A listed entry that leaves the root

- **WHEN** a session file enumerated beneath the Claude projects root is a symlink resolving to a
  file outside that root
- **THEN** it does not become an index entry, and the remaining entries in that directory are
  indexed normally
