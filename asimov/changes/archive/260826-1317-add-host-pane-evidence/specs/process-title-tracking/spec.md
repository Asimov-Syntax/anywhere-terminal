## MODIFIED Requirements

### Requirement: OSC Title Change Handling

The webview SHALL listen for xterm.js `onTitleChange` events on each terminal instance and
update the `TerminalInstance.name` property with the new title, including when that title is
empty. The tab bar re-render SHALL be triggered only when the new title's **decorative
signature** OR its **decoration-presence** differs from the previous title's.

Where the resolved label would be empty — the title was cleared and no user-supplied name
applies — the tab SHALL display the terminal's default `Terminal N` name instead, so clearing a
title returns the tab to its original label rather than blanking it.

Decoration-presence is part of the compared state because the tab label is rendered from
the raw `name`: dropping the spinner glyph changes what the tab displays even when the
signature is unchanged, and suppressing that render would freeze a spinner on a finished
agent's tab.

A title longer than 1024 characters SHALL bypass the comparison and always render, so a
hostile or pathological OSC payload cannot be scanned twice per frame to save a render. Both
stored comparison values SHALL be cleared when that happens: retaining the last in-range
values would let the next in-range title compare against pre-oversize state and be
suppressed even though the displayed label changed in between.

A title's decorative signature is computed by removing every character in the braille
range `U+2800`–`U+28FF` and the quarter-circle range `U+25D0`–`U+25D3`, collapsing each
run of whitespace to a single space, and trimming. `TerminalInstance.name` SHALL always be
assigned the raw title (never the signature), so the tab label still shows what the agent
last wrote.

#### Scenario: Spinner frame advances without changing the title text

- **WHEN** an instance's title changes from `⠋ Fix tests` to `⠙ Fix tests`
- **THEN** `TerminalInstance.name` MUST become `⠙ Fix tests` and the tab bar re-render
  MUST NOT be triggered.

#### Scenario: Title text changes behind an unchanged spinner frame

- **WHEN** an instance's title changes from `⠋ Fix tests` to `⠋ Run build`
- **THEN** the tab bar re-render MUST be triggered.

#### Scenario: Oversized title

- **WHEN** an instance emits the same 2000-character title twice in a row
- **THEN** the tab bar re-render MUST be triggered both times.

#### Scenario: Spinner disappears when the agent finishes

- **WHEN** an instance's title changes from `⠙ Fix tests` to `Fix tests`
- **THEN** the tab bar re-render MUST be triggered, so the tab does not keep displaying a
  spinner glyph for an agent that has stopped working.

#### Scenario: A program clears the title

- **WHEN** an instance whose title is `Fix tests` emits an empty title, and the user has not
  renamed the tab
- **THEN** the tab MUST display its default `Terminal N` name.
