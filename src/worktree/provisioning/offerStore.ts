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

export interface ProvisionOfferStore {
  /**
   * Record a model and mint the id that names it, superseding whatever this key
   * held before.
   *
   * Superseding EVICTS rather than keeping both. Two live offers for one form
   * means a submission can name the older, and the older is by definition the
   * model the user is no longer looking at.
   */
  issue(key: string, model: ProvisionModel): ProvisionOffer;
  /** The offer this key currently holds, or `undefined` before one is issued. */
  current(key: string): ProvisionOffer | undefined;
  /**
   * The model an id names, or `undefined`.
   *
   * Undefined rather than a throw: an unknown or expired id is an ordinary
   * outcome with a defined answer — no create and no provisioning, resolve a
   * fresh model, present it, wait for a second submission (rpc § 2.4). A throw
   * would make the caller decide that, and there is only one right answer.
   */
  lookup(offerId: string): ProvisionModel | undefined;
  /** Drop everything a surface holds. Its offers can never be submitted again. */
  forget(key: string): void;
}

export function createProvisionOfferStore(): ProvisionOfferStore {
  const currentByKey = new Map<string, ProvisionOffer>();
  const modelById = new Map<string, ProvisionModel>();
  let sequence = 0;

  return {
    issue(key, model) {
      const previous = currentByKey.get(key);
      if (previous !== undefined) {
        modelById.delete(previous.offerId);
      }
      sequence += 1;
      // Monotonic and never reused, so a resubmission of a superseded id cannot
      // land on a later offer that happens to occupy the same slot.
      const offer: ProvisionOffer = { offerId: `provision-${sequence}`, model };
      currentByKey.set(key, offer);
      modelById.set(offer.offerId, model);
      return offer;
    },
    current(key) {
      return currentByKey.get(key);
    },
    lookup(offerId) {
      return modelById.get(offerId);
    },
    forget(key) {
      const held = currentByKey.get(key);
      if (held !== undefined) {
        modelById.delete(held.offerId);
        currentByKey.delete(key);
      }
    },
  };
}
