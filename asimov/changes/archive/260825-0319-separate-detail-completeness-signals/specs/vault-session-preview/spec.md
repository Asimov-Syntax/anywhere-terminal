# vault-session-preview Specification Delta

## ADDED Requirements

### Requirement: Source omission and pageability are distinct signals

`truncated` SHALL be set if and only if a larger requested detail limit would return additional timeline items. `partial`, with a short `limitedReason`, SHALL be set WHEN the read omitted source records that no larger limit can recover.

Both MAY hold at once, and the system SHALL NOT derive either signal from the other.

#### Scenario: A read that dropped source records still pages within what it retained

- **WHEN** a session's read omitted source records AND the retained items exceed the requested limit
- **THEN** the detail reports both `partial` true with a `limitedReason` and `truncated` true

### Requirement: Load-more is offered only while more transcript exists

The preview SHALL offer its load-older-messages affordance only WHILE the detail reports `truncated`, so a reader that can supply nothing further never offers to.

#### Scenario: A session whose source read dropped records is paged to its end

- **WHEN** the reader has returned every timeline item it can decode for a session whose source read omitted records
- **THEN** the detail reports `partial` true and `truncated` false, and the preview offers no load-older-messages affordance

## MODIFIED Requirements

### Requirement: Bounded detail retains both transcript ends

WHEN a session's transcript exceeds the on-demand detail read window, the per-agent read SHALL retain both the **head** and the **tail** of the transcript — never the head alone — so that `firstPrompt` (selected from the head) and the final assistant message (surfaced as `latestMessage` and as the trailing `{ kind: "message", role: "assistant" }` timeline item, selected from the tail) BOTH survive, and SHALL set `partial: true` with a short `limitedReason` — the omitted middle is not recoverable by requesting a larger limit. For OpenCode specifically the read SHALL retain both the earliest and the most-recent `message` and `part` rows (head ASC ∪ tail DESC), de-duplicated by row id, rather than only the earliest rows.

Whether such a read ALSO reports `truncated` SHALL depend only on whether a larger requested limit would return more of what it retained.

#### Scenario: Long OpenCode session surfaces both ends

- **WHEN** an OpenCode session's `message`/`part` rows exceed the read window
- **THEN** the detail's `firstPrompt` is still the first user message, `latestMessage` is the final assistant message text and the timeline includes its trailing assistant `message` item, and `partial` is `true`
