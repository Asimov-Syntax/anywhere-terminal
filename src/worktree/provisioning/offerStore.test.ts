import { describe, expect, it } from "vitest";
import type { ProvisionModel } from "../../types/messages";
import { createProvisionOfferStore } from "./offerStore";

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

describe("createProvisionOfferStore", () => {
  it("returns the model an id names", () => {
    const store = createProvisionOfferStore();
    const offer = store.issue("surface:/repo", model(".env"));

    expect(store.lookup(offer.offerId)).toBe(offer.model);
    expect(store.current("surface:/repo")).toEqual(offer);
  });

  it("resolves a superseded id to nothing", () => {
    // Two live offers for one form means a submission can name the model the
    // user has stopped looking at.
    const store = createProvisionOfferStore();
    const first = store.issue("surface:/repo", model(".env"));
    const second = store.issue("surface:/repo", model(".env.local"));

    expect(store.lookup(first.offerId)).toBeUndefined();
    expect(store.lookup(second.offerId)).toBe(second.model);
    expect(first.offerId).not.toBe(second.offerId);
  });

  it("resolves an id it never issued to nothing, rather than throwing", () => {
    // An unknown id has one defined answer — no create, no provisioning,
    // re-present — so the store states it rather than making a caller decide.
    const store = createProvisionOfferStore();

    expect(store.lookup("provision-999")).toBeUndefined();
    expect(store.current("surface:/never")).toBeUndefined();
  });

  it("never reuses an id, so a resubmission cannot land on a later offer", () => {
    const store = createProvisionOfferStore();
    const ids = [
      store.issue("a", model("1")).offerId,
      store.issue("a", model("2")).offerId,
      store.issue("b", model("3")).offerId,
      store.issue("a", model("4")).offerId,
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps two surfaces independent", () => {
    // One window's offer is unknown to another, which resolves to the same
    // answer as an expired one rather than to the wrong model.
    const store = createProvisionOfferStore();
    const left = store.issue("left:/repo", model("left"));
    const right = store.issue("right:/repo", model("right"));

    expect(store.lookup(left.offerId)).toBe(left.model);
    expect(store.lookup(right.offerId)).toBe(right.model);
    expect(store.current("left:/repo")).toEqual(left);
  });

  it("forgets everything a surface held", () => {
    const store = createProvisionOfferStore();
    const offer = store.issue("gone:/repo", model(".env"));
    store.forget("gone:/repo");

    expect(store.lookup(offer.offerId)).toBeUndefined();
    expect(store.current("gone:/repo")).toBeUndefined();
  });

  it("forgets a key it does not hold without complaint", () => {
    const store = createProvisionOfferStore();

    expect(() => store.forget("never")).not.toThrow();
  });
});
