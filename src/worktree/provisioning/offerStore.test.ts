import { describe, expect, it } from "vitest";
import type { ProvisionModel } from "../../types/messages";
import { createProvisionOfferStore, type ProvisionOfferKey } from "./offerStore";

function model(path: string): ProvisionModel {
  return {
    entries: [{ id: "i1", path, mode: "copy", source: "asimov/worktree.yaml" }],
    setup: [],
    ports: [],
    providers: [{ id: "asimov", file: "asimov/worktree.yaml", active: true }],
    excluded: [],
    problems: [],
  };
}

const A: ProvisionOfferKey = { surface: "surface-1", repoId: "/repo" };
const B: ProvisionOfferKey = { surface: "surface-2", repoId: "/repo" };
/** Same surface, second repository — the picker offers more than one. */
const A2: ProvisionOfferKey = { surface: "surface-1", repoId: "/other" };

describe("createProvisionOfferStore", () => {
  it("returns the model an id names", () => {
    const store = createProvisionOfferStore();
    const offer = store.issue(A, model(".env"));

    expect(store.lookup(A, offer.offerId)).toBe(offer.model);
    expect(store.current(A)).toEqual(offer);
  });

  it("resolves a superseded id to nothing", () => {
    // Two live offers for one form means a submission can name the model the
    // user has stopped looking at.
    const store = createProvisionOfferStore();
    const first = store.issue(A, model(".env"));
    const second = store.issue(A, model(".env.local"));

    expect(store.lookup(A, first.offerId)).toBeUndefined();
    expect(store.lookup(A, second.offerId)).toBe(second.model);
    expect(first.offerId).not.toBe(second.offerId);
  });

  it("resolves an id it never issued to nothing, rather than throwing", () => {
    // An unknown id has one defined answer — no create, no provisioning,
    // re-present — so the store states it rather than making a caller decide.
    const store = createProvisionOfferStore();

    expect(store.lookup(A, "provision-999")).toBeUndefined();
    expect(store.current(A)).toBeUndefined();
  });

  it("[B3] refuses an id issued to another surface", () => {
    // Ids are a small monotonic counter. Unscoped, one window could resolve
    // another window's model by guessing an integer.
    const store = createProvisionOfferStore();
    const mine = store.issue(A, model("mine"));
    store.issue(B, model("theirs"));

    expect(store.lookup(B, mine.offerId)).toBeUndefined();
    expect(store.lookup(A, mine.offerId)).toBe(mine.model);
  });

  it("[B3] refuses an id issued for another repository on the same surface", () => {
    const store = createProvisionOfferStore();
    const forRepo = store.issue(A, model("mine"));
    store.issue(A2, model("other"));

    expect(store.lookup(A2, forRepo.offerId)).toBeUndefined();
    expect(store.lookup(A, forRepo.offerId)).toBe(forRepo.model);
  });

  it("never reuses an id, so a resubmission cannot land on a later offer", () => {
    const store = createProvisionOfferStore();
    const ids = [
      store.issue(A, model("1")).offerId,
      store.issue(A, model("2")).offerId,
      store.issue(B, model("3")).offerId,
      store.issue(A, model("4")).offerId,
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps two surfaces independent", () => {
    // One window's offer is unknown to another, which resolves to the same
    // answer as an expired one rather than to the wrong model.
    const store = createProvisionOfferStore();
    const left = store.issue(A, model("left"));
    const right = store.issue(B, model("right"));

    expect(store.lookup(A, left.offerId)).toBe(left.model);
    expect(store.lookup(B, right.offerId)).toBe(right.model);
    expect(store.current(A)).toEqual(left);
  });

  it("forgets everything one form held", () => {
    const store = createProvisionOfferStore();
    const offer = store.issue(A, model(".env"));
    store.forget(A);

    expect(store.lookup(A, offer.offerId)).toBeUndefined();
    expect(store.current(A)).toBeUndefined();
  });

  it("[B6] forgets every repository a detached surface held, and only that surface", () => {
    const store = createProvisionOfferStore();
    const one = store.issue(A, model("one"));
    const two = store.issue(A2, model("two"));
    const other = store.issue(B, model("other"));
    store.forgetSurface("surface-1");

    expect(store.lookup(A, one.offerId)).toBeUndefined();
    expect(store.lookup(A2, two.offerId)).toBeUndefined();
    expect(store.lookup(B, other.offerId)).toBe(other.model);
  });

  it("forgets a key it does not hold without complaint", () => {
    const store = createProvisionOfferStore();

    expect(() => store.forget(A)).not.toThrow();
    expect(() => store.forgetSurface("never")).not.toThrow();
  });

  it("keeps a repoId that contains the separator a flat key would have used", () => {
    // `repoId` is a filesystem path. Any character chosen to join a flat key is
    // one some repository is entitled to contain.
    const store = createProvisionOfferStore();
    const odd: ProvisionOfferKey = { surface: "s", repoId: "/repo with space/.git" };
    const nastier: ProvisionOfferKey = { surface: "s", repoId: "/repo" };
    const offer = store.issue(odd, model("x"));
    store.issue(nastier, model("y"));

    expect(store.lookup(odd, offer.offerId)).toBe(offer.model);
  });
});
