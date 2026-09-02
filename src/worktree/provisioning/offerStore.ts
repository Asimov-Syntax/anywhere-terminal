// src/worktree/provisioning/offerStore.ts — What the user was shown, kept by
// the host (worktree-provisioning.md § 4.0).
//
// The safety property is *nothing executes that the user has not seen*. That is
// only a property of the system if the host keeps the model it displayed and
// executes from THAT — re-reading the provider files after Create is pressed is
// exactly the window an untrusted checked-in file needs.
//
// So the webview gets display material plus an opaque id, and answers with the
// id. This module owns the id → model map. Nothing here executes anything;
// WT-012.2 is the first redeemer.

import type { ProvisionModel } from "../../types/messages";

export interface ProvisionOffer {
  readonly offerId: string;
  readonly model: ProvisionModel;
}

/**
 * Which form an offer belongs to.
 *
 * A surface and a repository, never a bare string: the surface is the window
 * that was shown the model, and admission has to be able to ask "was THIS
 * surface shown THIS offer" rather than "does this id exist somewhere"
 * (.reviews/round-1.md B3).
 *
 * Kept as a pair and held in nested maps rather than joined into one string.
 * `repoId` is a filesystem path, so any separator chosen for a flat key is a
 * character some repository is entitled to contain.
 */
export interface ProvisionOfferKey {
  readonly surface: string;
  readonly repoId: string;
}

export interface ProvisionOfferStore {
  /**
   * Record a model and mint the id that names it, superseding whatever this key
   * held before.
   *
   * Superseding EVICTS rather than keeping both. Two live offers for one form
   * means a submission can name the older, and the older is by definition the
   * model the user is no longer looking at.
   */
  issue(key: ProvisionOfferKey, model: ProvisionModel): ProvisionOffer;
  /** The offer this key currently holds, or `undefined` before one is issued. */
  current(key: ProvisionOfferKey): ProvisionOffer | undefined;
  /**
   * The model an id names, **for the form that was shown it**, or `undefined`.
   *
   * Scoped rather than global. Ids are a monotonic counter, so a global lookup
   * would let one window resolve another window's model by guessing a small
   * integer — and a redeemer written against an unscoped signature cannot add
   * the scope back, because by then the store no longer knows it (round-1 B3).
   *
   * Undefined rather than a throw: an unknown, expired or foreign id is an
   * ordinary outcome with a defined answer — no create and no provisioning,
   * resolve a fresh model, present it, wait for a second submission (rpc § 2.4).
   * A throw would make the caller decide that, and there is only one right
   * answer.
   */
  lookup(key: ProvisionOfferKey, offerId: string): ProvisionModel | undefined;
  /** Drop what one form holds. Its offers can never be submitted again. */
  forget(key: ProvisionOfferKey): void;
  /**
   * Drop everything a surface holds, across every repository.
   *
   * A detached surface takes its offers with it. Without this the store grows
   * with every window that has ever been open, and a read completing after a
   * detach could still publish into it (round-1 B6).
   */
  forgetSurface(surface: string): void;
}

/**
 * Re-mint every selectable id so they are unique within THIS offer.
 *
 * Each adapter mints from its own counter starting at the same value, so two
 * adapters read for one create both produce `i1` and a merged offer would carry
 * an ambiguous id (.reviews/round-2.md W4). `issue` is where that is fixable
 * without guessing anything: it receives the completed model, so it needs no
 * provider registry, no detection order and no merge algorithm — which is what
 * made this look like a later task's job.
 *
 * Ids stay opaque and non-derived. Not a path and not a hash of one: an id that
 * encoded a path would be a path the webview could read back out, and an id from
 * a superseded offer must resolve to nothing rather than name whatever now
 * occupies that slot (worktree-provisioning.md § 4.0).
 */
function remint(model: ProvisionModel, seq: () => string): ProvisionModel {
  const reminted = new Map<string, string>();
  const entries = model.entries.map((e) => {
    const id = seq();
    reminted.set(e.id, id);
    return { ...e, id };
  });
  return {
    ...model,
    entries,
    ports: model.ports.map((p) => ({ ...p, id: seq() })),
    setup: model.setup.map((s) => ({ ...s, id: seq() })),
    // Groups name entry ids, and every entry id just changed. Carrying them
    // through untranslated would leave each group pointing at ids nobody holds
    // — silent, total, and invisible to any test that only counts rows.
    contenders: model.contenders.map((group) => {
      // Both lists through the SAME translation. Rebuilding a group key by key
      // is how `priorityClaimedTwice` was silently dropped here — apply-time
      // correctness hid it, because the apply recomputes its groups from the
      // submitted entries, so only the dialog ever saw the loss
      // (.reviews/round-7.md F015).
      const translate = (ids: readonly string[]) =>
        ids.flatMap((id) => {
          const next = reminted.get(id);
          return next === undefined ? [] : [next];
        });
      return { members: translate(group.members), natives: translate(group.natives) };
    }),
    // `excluded` rows are shown as deliberate omissions, never selected, so they
    // are carried through untouched rather than given ids that mean nothing.
  };
}

export function createProvisionOfferStore(): ProvisionOfferStore {
  const bySurface = new Map<string, Map<string, ProvisionOffer>>();
  let sequence = 0;
  /** Never restarts, so no two offers from this store share an item id. */
  let itemSequence = 0;

  return {
    issue(key, model) {
      let repos = bySurface.get(key.surface);
      if (repos === undefined) {
        repos = new Map();
        bySurface.set(key.surface, repos);
      }
      sequence += 1;
      // Monotonic and never reused, so a resubmission of a superseded id cannot
      // land on a later offer that happens to occupy the same slot. The `set`
      // below evicts the previous offer for this form by construction.
      const offer: ProvisionOffer = {
        offerId: `provision-${sequence}`,
        model: remint(model, () => {
          itemSequence += 1;
          return `item-${itemSequence}`;
        }),
      };
      repos.set(key.repoId, offer);
      return offer;
    },
    current(key) {
      return bySurface.get(key.surface)?.get(key.repoId);
    },
    lookup(key, offerId) {
      const held = bySurface.get(key.surface)?.get(key.repoId);
      // The id must be the one THIS form currently holds. An id that is merely
      // live somewhere resolves to nothing here, which is the safe answer.
      return held?.offerId === offerId ? held.model : undefined;
    },
    forget(key) {
      const repos = bySurface.get(key.surface);
      repos?.delete(key.repoId);
      if (repos?.size === 0) {
        bySurface.delete(key.surface);
      }
    },
    forgetSurface(surface) {
      bySurface.delete(surface);
    },
  };
}
