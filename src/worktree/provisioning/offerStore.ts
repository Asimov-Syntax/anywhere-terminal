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

export function createProvisionOfferStore(): ProvisionOfferStore {
  const bySurface = new Map<string, Map<string, ProvisionOffer>>();
  let sequence = 0;

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
      const offer: ProvisionOffer = { offerId: `provision-${sequence}`, model };
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
