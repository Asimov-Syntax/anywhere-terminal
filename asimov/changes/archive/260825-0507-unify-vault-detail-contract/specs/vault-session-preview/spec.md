# vault-session-preview Spec Delta

## ADDED Requirements

### Requirement: The detail declares its own content kind

Every session detail SHALL declare `contentKind` as either `timeline` or `metadata-only`, and the preview SHALL choose between the transcript view and the limited metadata view from that declaration alone — never from the entry's agent.

A `metadata-only` detail SHALL carry no timeline items, no recent activity, and no `truncated` signal.

#### Scenario: An agent other than Cursor returns a limited detail

- **WHEN** any agent's reader returns a detail declaring `contentKind` `metadata-only`
- **THEN** the preview renders the limited metadata view with its Continue action, and offers no transcript, no per-message actions, and no load-older-messages affordance
