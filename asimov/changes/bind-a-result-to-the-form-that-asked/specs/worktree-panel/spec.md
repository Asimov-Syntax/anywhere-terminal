# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A create form's opening identity travels on every request and every reply

The create form SHALL carry an opening identity minted by the panel, sent on every request that
belongs to that opening, and echoed by the extension on every reply to one. The panel SHALL drop a
reply whose identity is not the live opening's, rather than caching or rendering it.

#### Scenario: A predecessor's answer reaches a form that has already been replaced

- **WHEN** a create form is reopened while the previous form's provisioning read is still in flight
- **THEN** nothing from that predecessor is rendered or cached, whether the read succeeds or fails

#### Scenario: A destination answer for a superseded opening is not applied

- **WHEN** a `worktreeCreateDefaults` reply arrives naming an opening that is no longer live
- **THEN** the form neither seeds nor updates from it

### Requirement: Closing a create form retires its opening

The panel SHALL tell the extension when a create form closes, whether it was cancelled or submitted.
The extension SHALL treat a retired opening as holding nothing: a result arriving for one SHALL mint
no authority, publish nothing, and leave no state behind.

#### Scenario: A cancelled form's read lands after the cancel

- **WHEN** a create form is cancelled while its provisioning read is still running
- **THEN** the read publishes no offer and leaves nothing the extension would later honour

#### Scenario: A submitted form does not keep an open conversation

- **WHEN** a create form is submitted
- **THEN** its opening is retired, and a later reply naming it changes nothing

### Requirement: A repeated request for one opening never starts a second read

Where the extension receives more than one opening request naming the same live opening, it SHALL
join or ignore the repeat rather than begin another read. A repeat SHALL NOT retire, supersede, or
suppress the answer the live opening is already owed.

#### Scenario: A duplicated opening request still yields the legitimate answer

- **WHEN** the same opening request is delivered twice
- **THEN** exactly one read runs and the form still receives its answer

#### Scenario: A request naming an opening the extension does not hold

- **WHEN** a request names an opening that was never live or has been retired
- **THEN** the extension answers nothing
