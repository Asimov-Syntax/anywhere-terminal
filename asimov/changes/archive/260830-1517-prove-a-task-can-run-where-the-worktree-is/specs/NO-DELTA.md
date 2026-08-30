# No spec delta

No externally verifiable behaviour or externally mandated constraint changes. The change stands up
developer test tooling and settles one design question; the subject of that question — the `task`
variant of a provisioning setup step — is designed but unimplemented, so nothing a user can hold
changes either way.

The nearest candidate is `build-infrastructure`, which does carry developer-facing requirements
about build commands. A test-harness config and a test-runner choice are private HOW under the
admission gate (repo layout, chosen framework, machinery that exists to prove something), so they
belong in tasks and design rather than in that spec. Overrule at Gate 2 if the precedent should
win instead.
