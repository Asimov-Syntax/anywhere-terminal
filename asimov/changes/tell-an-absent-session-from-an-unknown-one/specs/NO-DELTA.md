# No spec delta

No externally verifiable behaviour changes: `getEntry` returns exactly what it returns today for
every input, no caller acts on the new `absent` answer yet, and nothing reaches a user surface.
`vault-session-launch` § "Launch resolves a single entry by id" — including its requirement that
`getEntry` return null for synthetic nesting ids — stays true verbatim, which is why `getEntry`
survives as a wrapper rather than being replaced.

The change that consumes `absent`, `docs/PLAN.md` WT-011.5, owns the user-visible delta.
