## MODIFIED Requirements

### Requirement: OSC Title Change Handling

The webview SHALL listen for xterm.js `onTitleChange` events on each terminal instance and
update the `TerminalInstance.name` property with the new title. The tab bar re-render
SHALL be triggered only when the new title's **decorative signature** OR its
**decoration-presence** differs from the previous title's.

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
