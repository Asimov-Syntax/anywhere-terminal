# No spec delta

This adds a build-time gate. No externally verifiable behavior changes for any supported input or
environment: the shipped extension behaves identically, and the only new outcome is that a build
producing an unloadable bundle fails at `pnpm run package` instead of at the user's activation.

The failure it catches is real and shipped once — see design.md § Context — but "the extension
activates" is not a new promise; it is the promise this gate stops us breaking.
