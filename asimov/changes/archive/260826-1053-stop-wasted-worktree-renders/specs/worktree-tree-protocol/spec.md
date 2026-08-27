# Spec Delta: worktree-tree-protocol (stop-wasted-worktree-renders)

## MODIFIED Requirements

### Requirement: Deliver each push only to surfaces showing the view

The system SHALL accept a `worktreeViewVisibility` message carrying a `visible` flag, by which
one surface declares whether its worktree view is being shown. Each push SHALL be delivered to
every live surface that has both declared the view visible and is being displayed by the window —
including the surface whose request produced it — and SHALL NOT be delivered to any other surface.

#### Scenario: A hidden surface is skipped

- **WHEN** two surfaces have declared the view visible and a third has not
- **THEN** the push reaches exactly the two that declared it visible

#### Scenario: A retained surface stops receiving while it is not displayed

- **WHEN** a surface that declared the view visible stops being displayed, and a rebuild produces a push
- **THEN** that surface receives no push, and the surfaces still displayed receive it

## ADDED Requirements

### Requirement: Serve a surface that is displayed again

WHEN a surface begins showing the view again after a period of not showing it, the system SHALL
deliver the current listings to that surface without the surface asking, and SHALL NOT require a
rebuild to do so. Where no listings have been produced yet, it SHALL produce them.

The delivery SHALL reach only the surface that began showing the view, so a surface already
showing it performs no work on another surface's transition.

#### Scenario: A surface displayed again shows current data

- **WHEN** a surface stops being displayed, the listings change while it is not displayed, and it is displayed again
- **THEN** that surface receives the changed listings, and no rebuild is run to produce them
