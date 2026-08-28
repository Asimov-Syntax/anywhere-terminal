# Proposal: inline-cursor-hooks

## Why

The released Cursor hook writes and executes a mutable wrapper file, resolves utilities through ambient process configuration, and can transmit loopback hook payloads through a proxy. Replace that shipped registration with a bounded inline command while migrating only historical bytes a released version actually wrote.

## Appetite

M (≤3d)

## Scope

### In scope

- Darwin/Linux inline migration for the Cursor hook shipped in v0.18.1.
- Exact ownership and cleanup of the released wrapper under the currently derivable Cursor storage root.
- Transport hardening against inherited executable search, proxy variables, curl startup files, malformed coordinates, and unavailable listeners.
- Windows removal-only reconciliation with complete failure/path reporting.
- Reproducible direct-shell tests and a real Cursor Agent spike of the exact frozen bytes.

### Out of scope

- Claude hooks or any generalized multi-agent installer.
- Historical storage roots that cannot be derived by the running extension.
- Owner, lease, destination pointer, relocation, or shape-based residue inference.
- A Windows inline command before it can be executed on a real Windows host.
- Preserving Cursor hook observability on Windows during the removal-only interval.

## Risk Level

HIGH — the change migrates a user-owned configuration file and handles raw agent hook payloads at a privacy boundary.
