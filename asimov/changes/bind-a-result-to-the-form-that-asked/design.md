# Design: bind-a-result-to-the-form-that-asked

> Ref: docs/design/worktree-rpc.md § 2.1, § 2.2, § 2.4

## D1 — The opening identity already exists; this change finishes it, it does not mint a second

The panel already mints a per-opening token in `WorktreeController.openCreateForRepo`
(`refsToken`), sends it on `requestWorktreeRefs`, `worktreeCreateProbe` and
`worktreeAuthorizeDebris`, and drops any reply below the live one. worktree-rpc.md § 2.1 already
describes it as naming "the OPENING that is asking".

Two requests and two replies were left outside it: `requestWorktreeCreateDefaults` carries no
token, and neither `worktreeCreateDefaults` nor `worktreeProvisionOffer` echoes one. That is the
whole of the gap — the identity is not missing, it is partial.

So this change extends the existing token rather than introducing a parallel id. A second identity
would have to be kept consistent with the first at every site that already drops on the first, and
two staleness rules on one form is the defect this task exists to remove, not a shape of it.

## D2 — The host holds the live opening per surface, and answers nothing for any other

Today the host has `provisionGeneration`, minted **when the host processes an opening ask**. It
cannot bind a result to the panel's live opening, because the panel's reopening is not observable
to the host until the new message arrives — and in that window a predecessor's read can resolve and
publish into a form that has already been replaced. `WorktreeController.handleProvisionOffer` has no
staleness guard at all, so it caches whatever arrives.

The host therefore records the opening the PANEL named, per surface, and compares against that:

- a request naming the live opening is served;
- a request naming a retired or never-seen opening is answered with nothing;
- every reply echoes the opening it is answering.

`provisionGeneration` is replaced rather than kept beside it. Keeping both would leave two
authorities on the same question, which is the round-2 finding this change inherits.

## D3 — Retirement is its own message, because closure cannot be inferred

The host currently infers "a form opened" from a branch-less `requestWorktreeCreateDefaults`. There
is no corresponding signal for closing, which is exactly why a cancelled form's read still mints
host authority: nothing ever tells the host the conversation ended.

`worktreeCreateClosed { opening }` is added, posted on **both** exits — cancel and submit. Inferring
closure from the next opening is not equivalent: a form that is cancelled and never reopened would
leave its opening live forever, which is the case that matters most.

The panel's two exits run through one place. `WorktreeView` owns `onSubmit`/`onCancel` today and the
controller's `createDialogDeps` is typed `Omit<…, "onSubmit" | "onCancel">`, so the view gains one
`onCreateClosed` dep called from both, and the controller posts the retirement there. One caller,
both exits — a retirement wired into only one of them is the bug in a different position.

## D4 — A repeat joins; it never supersedes

Every opening ask currently supersedes the last, including a duplicate of the live one. That makes a
repeated message a way to suppress the legitimate result: the second ask retires the first's right to
publish and starts a read whose answer the form has no reason to prefer.

With the panel's opening as the key, a repeat is recognisable — it names the opening already live —
and the host joins the read in flight rather than starting another. Only a *different* opening
supersedes. This is what bounds the reads: one per opening, not one per message.

The marker that recognises a repeat outlives the read. Keying it on the read *in flight* bounded
concurrent duplicates only: the slot was cleared when the read settled, so a duplicate delivered
afterwards found nothing and started a second read against the same live opening
(.reviews/round-1.md B4). The requirement is one read per opening, not one concurrent read per
opening, so the marker is cleared by retirement — close, supersede or detach — and not by the read
finishing.

A read that FAILS is the exception and may be retried within its opening. The marker records that a
read succeeded, not that one was attempted: a transient filesystem error would otherwise cost the
user the provisioning section for the life of the form, with no way back except closing and
reopening it. Duplicate *delivery* still runs one read, which is what the requirement bounds.

## D5 — Retirement withdraws every channel the opening carries, not only its offer

The provisioning offer is issued against the opening that asked for it, so retirement evicts it.
A create citing an evicted offer id is already handled: § 2.4 requires the host to perform no create
and no provisioning, resolve a fresh model, present it, and require a second submission. This change
adds no new refusal path there — it makes an existing one reachable for a case that previously kept
authority it should not have had.

**Corrected after round 1.** This decision originally stopped at the offer and said "§ 2.4's
existing rule covers the rest". It does not. One opening token is what the create form spends on
*every* channel it uses — the per-repository `openings` records that `worktreeCreateProbe` and
`worktreeAuthorizeDebris` read, the refs and pull-request enumerations, and the provisioning offer.
Retiring only the last of those left a cancelled form able to publish discovery replies and, more
seriously, still able to mint a DEBRIS AUTHORIZATION — a deletion authority (round-1 B2). The
accepted spec was never ambiguous about this: a retired opening mints no authority and leaves no
state. So retirement is one operation over every channel the token carries:

- the surface's live opening and its provisioning read markers,
- the offers it issued,
- every per-repository `openings` record the surface holds,
- and, in the panel, the token stops being honoured for replies of any kind.

This widens what the existing retirement owner covers. It mints no new owner: the `openings` map
already belongs to WT-012.12's debris carve-out, and that carve-out's rule is unchanged — a deletion
still requires an explicit authorization naming a fingerprint. What changes is that a form the user
cancelled can no longer be the thing that names one.

The panel half matters as much as the host half. `refsToken` is the panel's own guard for refs,
resolutions, probes and debris; leaving it honoured after a close let a reply already in transit
when the close was posted land in a cache for a form that no longer exists. Retirement advances it.
An existing test asserted the opposite — that a refs reply is still stored after a dialog closes —
and that assertion encoded the behaviour this decision corrects, so it moves with the decision
rather than constraining it.

## Failure-surface inventory

The mutable resource is the host's **per-surface opening record and the offer store keyed against
it**. Both are in-process and per-surface; nothing is written to disk.

| Question | Answer |
|---|---|
| Who owns writes | The host, in the message handler, on one turn per message. The panel never writes it — it names an opening and the host records or rejects it. |
| What serializes concurrent access | The extension host's single-threaded message loop. Every read-modify-write of the opening record happens synchronously within one `handleMessage` turn, **before** any await, which is the property the round-1 provisioning guard got wrong and this design keeps explicit. |
| What a crash mid-write leaves behind | Nothing durable. A host restart loses every opening, and the panel's next form mints a new one; a reply for an opening the restarted host does not hold is answered with nothing, which is the same path a retired opening takes. |
| Failed / malformed read | Fails **closed**. A message whose `opening` is absent, not a number, or unknown is answered with nothing rather than being treated as the live opening — the permissive reading is what would let a malformed message adopt a form's authority. |
| Two racing hosts | Not applicable to the record itself: it is per-surface and per-process, and two windows each hold their own. Two SURFACES asking about one repository is already the case the offer key `{ surface, repoId }` separates, and this change narrows that key rather than widening it. |
