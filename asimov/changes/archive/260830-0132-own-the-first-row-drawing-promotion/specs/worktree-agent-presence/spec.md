# Spec Delta: worktree-agent-presence — own-the-first-row-drawing-promotion

## ADDED Requirements

### Requirement: A window that begins drawing rows gets enriched rows without waiting for a scan

WHEN a window gains its first surface that is drawing agent rows, and the presence envelope it
currently holds was built without row enrichment, presence SHALL be rebuilt and published with
enrichment applied on the terms the existing naming and preview requirements already set, rather
than the window waiting for the next polled scan. This SHALL hold however the surface reaches that
state, and whether or not a presence rebuild is already in flight when it does.

#### Scenario: A retained rail is displayed again

- **WHEN** a surface that was already visible and drawing rows becomes displayed, against an
  envelope built without enrichment
- **THEN** its eligible rows are enriched without waiting for the next scan

#### Scenario: The promotion lands during a rebuild

- **WHEN** a window gains its first row-drawing surface while a presence rebuild that is not
  enriching is already in flight
- **THEN** the window does not end up holding that unenriched result
