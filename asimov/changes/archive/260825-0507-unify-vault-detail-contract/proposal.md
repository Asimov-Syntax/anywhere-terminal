# Proposal: unify-vault-detail-contract

## Why

Four vault readers each decide for themselves how to assemble a session detail, so the same questions get re-answered per agent and nothing enforces the answer. That let three readers conflate unrecoverable source omission with a pageable window — fixed separately in `de9f995`, ahead of this change — and it still lets the webview decide "is this a limited view?" by hard-coding an agent name. This change makes the contract structural instead of conventional, so the next reader cannot drift off it silently.

## Appetite

M (≤3d)

## Scope

### In scope

- One constructor pair every detail producer returns through, owning `partial`, `limitedReason` and a now-required `contentKind`, including the limited-view case.
- A shared assertion vocabulary each reader's own tests call, so a new reader cannot drift off the contract unnoticed.
- Collapsing the per-agent service wiring into one adapter per agent, and closing the one registration step whose omission still fails silently.

### Out of scope

- The load-more defect itself. It is a behaviour change and ships as its own change, which lands first; this one rebases onto it and preserves its result.
- The webview timeline renderer, which is already agent-neutral. Its only change is deleting the agent-name special case.
- Sharing child/sub-session discovery or placement between agents — the four source models bind children by genuinely different edges.
- Sharing the `subagentSession` item literal — the four differ in title, agent, timestamp and truncation policy.
- Unifying child-id encoding across agents; these encode resolution and security, not presentation.
- Bounding, stats, classification and child discovery stay reader-owned.
- Extracting the shared safe-I/O primitives (bounded reads, containment checks, safe-id validation) that all four readers repeat. Larger payoff than this change, but it touches every agent's security code and deserves its own review.

## Risk Level

MEDIUM — touches every detail producer and a required field crosses the host/webview boundary, against a large existing test suite whose comments encode prior review findings; and it must rebase onto a concurrent change editing the same lines.
