# Spec Delta: worktree-panel — add-last-activity-preview-to-agent-rows

## ADDED Requirements

### Requirement: An agent row gives its last activity a line of its own

An agent row SHALL render at most two lines: identity, marks and age on the first, its
last-activity preview on the second. A row with no preview SHALL render exactly one line, costing
no vertical space and offering no placeholder in the preview's stead.

#### Scenario: A preview that is only decoration

- **WHEN** a row's preview consists only of decorative animation frames or whitespace
- **THEN** the row renders as one line, exactly as a row carrying no preview at all does

### Requirement: Each of an agent row's lines truncates on its own

Neither of an agent row's lines SHALL wrap, and each SHALL truncate independently with an
ellipsis. The preview SHALL consume none of the first line's width, and the age and the leading
glyphs SHALL NOT truncate at any width.

### Requirement: A decorative frame is neither shown in a preview nor a reason to repaint

Decorative animation frames SHALL be stripped from a preview wherever it is presented — the line
itself, and any hover or focus text that repeats it — and a preview that differs from what is
already rendered only in those frames SHALL cause no rendering work.

### Requirement: A list row does not name the model

No row in the panel's list SHALL display the agent's model identifier, and no placeholder SHALL
stand in for one that is unknown. The model is presented where there is room to present it, not
in the width the row's own last activity needs.
