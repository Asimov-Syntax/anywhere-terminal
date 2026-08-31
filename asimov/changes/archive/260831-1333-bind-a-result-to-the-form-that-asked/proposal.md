# Proposal: bind-a-result-to-the-form-that-asked

## Why

A create form's provisioning offer can be published into a form that never asked for it, and a form
the user cancelled keeps minting host authority it will never redeem.

Both come from one missing thing: the panel's create form has an opening identity, and two of its
requests and two of its replies are outside it. The host substitutes a generation of its own, minted
when it processes a request rather than when the form opened, so it cannot tell the panel's live
opening from its predecessor. WT-012.1's review found the invariant unclosable inside a rendering
task, which is why it is this change.

WT-012.2 is the first task that would redeem a provisioning offer. This lands before anything acts
on one, so nothing is ever built on an offer whose owner cannot be established.

## Scope

- The panel's opening token travels on `requestWorktreeCreateDefaults` and is echoed on
  `worktreeCreateDefaults` and `worktreeProvisionOffer`.
- The host records the opening the panel named, per surface, and answers nothing for any other.
- Closing a form — cancelled or submitted — retires its opening.
- A repeated request naming the live opening joins the read in flight instead of starting another.

## Non-goals and must-nots

- **No second identity.** The existing opening token is extended (D1); a parallel id is out of scope.
- **No change to what a create submits.** `worktreeCreate`'s payload is untouched.
- **No new refusal for an evicted offer.** § 2.4's resolve-fresh-and-resubmit rule already covers it
  and is not re-specified here.
- **Must not** make the destination reply wait on the provisioning read. They are independent today
  and stay independent — the reason `requestWorktreeRefs` is its own message in the first place.
- **Must not** infer closure from the next opening. D3 is explicit about why that is not equivalent.

## Appetite

M. The identity exists and three sites already honour it; this extends it to the remaining four and
adds one message.

## Risk

The staleness rule is being applied to two replies that never had one, so the failure mode of a
mistake is a form that renders nothing rather than a form that renders the wrong thing. That is the
safe direction, but it is why every drop path gets a witness that the LIVE opening still lands —
a guard that drops everything passes a test that only checks the drop.
