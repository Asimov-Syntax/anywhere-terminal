# Review round 3

- Date: 2026-08-31
- Cycle: 2
- Mode: discovery
- Scope: range `eb792a5c~1..HEAD` — complete revised contract and implementation
- Head: `ddf06936afd7e83fba75a1d657658988ba8a1049`
- Tree: dirty only from review accounting (`analytics.json`)
- Reviewable lines: 560
- Extension: the one bounded monotonicity override recorded by the coordinator
- Agents spawned:
  - `asm-review-contracts` — complete wire contract and runtime boundary — `gpt-5.6-sol[1M]`
  - `asm-review-data-security` — debris authorization and retirement — `sonnet[1M]`
  - `asm-review-logic` — retirement callers and async races — `gpt-5.6-terra[1M]`
  - `asm-review-frontend` — dialog identity and panel liveness — `gpt-5.6-terra[1M]`
  - `asm-review-performance` — map growth and cleanup bounds — `gpt-5.6-luna[1M]`
- Agents skipped: `asm-review-reuse` — no repository capability was reimplemented or split
- Verdict: BLOCK
- Counts: 1 BLOCK, 0 WARN, 0 SUGGEST
- Split: 1 feature / 0 machinery gating blockers

## Findings

### B2 — persists from round 1

- ID: B2
- Severity: BLOCK
- Confidence: HIGH
- Priority: P1
- Agent: `asm-review-contracts`, `asm-review-data-security`, chair
- Class: feature
- File: `src/providers/WorktreeHost.ts:1974`
- Title: The refs channel can reacquire a retired or malformed opening
- Evidence: `requestWorktreeRefs` is the writer of the per-surface+repository `openings` record that `worktreeCreateProbe` and `worktreeAuthorizeDebris` trust. Unlike the defaults opening request, this handler does not call `namedOpening` and does not require `msg.token` to equal the surface's `liveOpening`; it starts forge/refs reads and unconditionally executes `openings.set(...)` at line 2038. After `worktreeCreateClosed` correctly sweeps the record, replaying `requestWorktreeRefs` with the retired token recreates it. A following probe can publish a debris candidate and a following authorization request can reach `issueDebrisAuthorization` again. Token `0`, which the new defaults boundary explicitly rejects, can also be installed here. In addition, the forge and refs continuations at lines 1995-2024 and 2044-2065 recheck only host/surface lifetime, so an already-running read still publishes after close or supersession.
- Impact: D2/D5's one-token retirement is incomplete at the host authority boundary. A retired, never-held, or malformed opening can regain enumeration/probe state and mint deletion authority; in-flight discovery can publish after the opening was retired. Panel token guards prevent normal rendering but do not withdraw the extension-host capability, and the inbound webview boundary is explicitly untrusted.
- SuggestedFix: Before any forge/refs I/O or `openings.set`, require `namedOpening(msg.token)` and `liveOpening.get(surfaceKey(surface)) === msg.token`. Before every refs/pull-request post, recheck that the same opening is still live and that `openingFor(surface, repoId, token)` still identifies its record. Add non-vacuous witnesses for replaying refs after close, token `0`/malformed tokens, and refs/forge reads resolving after close.
- Status: accepted — persists from round 1
- Triage: Round 1 B2 explicitly inventoried replayed `requestWorktreeRefs` and unguarded refs/forge continuations, and its suggested fix required guarding both. The remediation swept existing `openings` records but did not prevent this handler from recreating them or its continuations from publishing. Severity remains BLOCK: the evidence and deletion-authority impact are unchanged.
- Invariant inventory: a retired opening cannot be recreated or publish through any channel. Affected boundaries: refs request admission, pull-request read/publish, refs read/publish, probe state, debris authorization. Verified safe: direct post-close probe/authorization without replay, provisioning reads/offers, defaults replies, panel-side stale-reply guards.

## Cross-round adjudication

- Round-1 B1: fixed — positive-safe runtime validation plus per-surface high-water rejects retired and delayed defaults opening asks.
- Round-1 B2: persists — existing records are swept, but `requestWorktreeRefs` can recreate them and in-flight enumeration still publishes.
- Round-1 B3: fixed — malformed defaults openings are rejected before repository/destination work; close validation is defensively present.
- Round-1 B4: fixed — successful read markers remain until retirement; failed reads release only their own marker for retry.
- Round-1 B5: fixed at the live-host growth boundary — detach invokes complete per-surface retirement and drops high-water history. The specialist's disposed-host retention concern was not kept: disposal is terminal, state no longer grows, continuations refuse publication, and no retained-owner lifetime was evidenced.
- Round-1 B6: fixed — the view captures immutable dialog identity, all disposal paths retire once, and the guarded counter advance rejects closed replies without invalidating a successor.
- Dropped round-1 specialist finding: fixed — superseding through repository B sweeps repository A's marker, and publication also rechecks the surface live opening.

## Adjudication notes

- The debris carve-out itself remains intact: issuance rechecks the exact published candidate after its filesystem read; create admission requires a non-empty fingerprint bound to the create path; redemption remains one-time and evidence-bound.
- The performance finding about departed repositories was not admitted because the offer/read behavior is unchanged from the review base; this review does not report unchanged code below critical security. The disposed-host WARN was also dropped for lack of a retained-owner lifetime or live growth axis.
- Recorded Verify Gate is green at this Head: 269 files / 6167 tests, check-types clean, Biome at the pre-existing 3/14/1 check-mode baseline. The review ran no project verify command.
