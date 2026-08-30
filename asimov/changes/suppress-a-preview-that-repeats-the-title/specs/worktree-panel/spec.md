## ADDED Requirements

### Requirement: A row draws its preview only when it adds something

An agent row SHALL withhold its preview — from its second line and from any hover text repeating it
— WHEN that preview is blank, or equals the row's title after the decoration the title's own
presentation removes is taken off **the title alone**.

Every other preview SHALL be drawn verbatim, however slightly it differs, and no similarity, prefix,
or truncated comparison SHALL suppress one.

#### Scenario: A session whose only message is its title

- **WHEN** a row's title and its preview are the same sentence
- **THEN** the row renders as one line, and its hover text names that sentence once

#### Scenario: A session that gains a second message

- **WHEN** a row whose preview was withheld for repeating its title reports different activity
- **THEN** the row draws its preview line again

#### Scenario: A preview that differs from the title only slightly

- **WHEN** a row's preview and title differ by a single trailing word
- **THEN** the preview is drawn in full

#### Scenario: A preview whose marker the title's stripper would eat

- **WHEN** a row's preview is a lone `*` or `- ` marker, or opens with one, and its title is that
  same text without the marker
- **THEN** the preview is drawn in full, because only the title was normalized

## MODIFIED Requirements

### Requirement: An agent row gives its last activity a line of its own

An agent row SHALL render at most two lines: identity, marks and age on the first, its
last-activity preview on the second. A row with no preview SHALL render exactly one line, costing
no vertical space and offering no placeholder in the preview's stead.

## REMOVED Requirements

### Requirement: A decorative frame is neither shown in a preview nor a reason to repaint

**Reason**: Superseded by the accepted decision that a preview is transcript message text rather
than a pane title, so a leading `- ` or `*` in it is a marker the model wrote and not an animation
frame an agent printed. `worktree-agent-presence` § "A preview is message text, not a pane title"
now states the opposite of this requirement and is the newer contract. The rule was written when
the preview's only source was a pane title; the source changed underneath it and it was never
withdrawn, leaving an accepted rule that shipped behaviour has contradicted since.

**Migration**: None — no behaviour changes on removal. The preview continues to be presented
verbatim and every change to one continues to repaint. Its "a preview that is only decoration
renders as one line" scenario is deleted with it, by the MODIFIED delta above, rather than rehomed:
a marker-only preview must render as itself.
