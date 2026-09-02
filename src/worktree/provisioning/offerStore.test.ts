import { describe, expect, it } from "vitest";
import type { ProvisionModel } from "../../types/messages";
import { createProvisionOfferStore, type ProvisionOfferKey } from "./offerStore";

function model(path: string): ProvisionModel {
  return {
    entries: [{ id: "i1", path, mode: "copy", source: "asimov/worktree.yaml" }],
    setup: [],
    ports: [],
    providers: [{ id: "asimov", files: ["asimov/worktree.yaml"], active: true }],
    excluded: [],
    contenders: [],
    problems: [],
  };
}

const A: ProvisionOfferKey = { surface: "surface-1", repoId: "/repo" };
const B: ProvisionOfferKey = { surface: "surface-2", repoId: "/repo" };
/** Same surface, second repository — the picker offers more than one. */
const A2: ProvisionOfferKey = { surface: "surface-1", repoId: "/other" };

describe("createProvisionOfferStore", () => {
  it("rewrites contender group ids along with the entries they name", () => {
    // Groups name entry ids, and `issue` remints every entry id. Carrying the
    // groups through untranslated leaves each one pointing at ids nobody holds
    // — a failure no row count can see, because the rows are all still there.
    const store = createProvisionOfferStore();
    const offer = store.issue(A, {
      ...model("MixedCase"),
      entries: [
        { id: "i1", path: "MixedCase", mode: "copy", source: ".vscode/worktree.json" },
        { id: "i2", path: "mixedcase", mode: "link", source: "orca.yaml" },
      ],
      contenders: [{ members: ["i1", "i2"], natives: ["i1"] }],
    });

    const live = new Set(offer.model.entries.map((e) => e.id));
    const group = offer.model.contenders[0];

    expect(group?.members.length).toBe(2);
    for (const id of group?.members ?? []) {
      expect(live.has(id)).toBe(true);
    }
    for (const id of group?.natives ?? []) {
      expect(live.has(id)).toBe(true);
    }
    // The repository's own row is still named after reminting, not merely some
    // id that happens to be live.
    expect((group?.natives ?? []).map((id) => offer.model.entries.find((e) => e.id === id)?.path)).toEqual([
      "MixedCase",
    ]);
    // And the pre-remint ids are gone, so a stale group could not resolve.
    expect(live.has("i1")).toBe(false);
  });

  it("[round-7 F015] translates a group's repository declarations, not only its members", () => {
    // `remint` rebuilt each group key by key, so a field added to the group was
    // silently dropped and the dialog saw a group with no repository
    // declarations at all. The apply never noticed, because it recomputes its
    // groups from the entries it is submitted — only the offer side lost.
    const store = createProvisionOfferStore();
    const offer = store.issue(A, {
      ...model("MixedCase"),
      entries: [
        { id: "i1", path: "MixedCase", mode: "copy", source: ".vscode/worktree.json" },
        { id: "i2", path: "MIXEDCASE", mode: "copy", source: ".vscode/worktree.json" },
        { id: "i3", path: "mixedcase", mode: "copy", source: "orca.yaml" },
      ],
      contenders: [{ members: ["i1", "i2", "i3"], natives: ["i1", "i2"] }],
    });

    const group = offer.model.contenders[0];
    const live = new Set(offer.model.entries.map((e) => e.id));
    const pathOf = new Map(offer.model.entries.map((e) => [e.id, e.path] as const));

    expect(group?.natives).toHaveLength(2);
    for (const id of group?.natives ?? []) {
      // The new ids, not the ones the caller handed in. A list carried through
      // untranslated satisfies every members-only assertion and then resolves
      // to nothing.
      expect(live.has(id)).toBe(true);
      expect(["i1", "i2", "i3"]).not.toContain(id);
    }
    expect((group?.natives ?? []).map((id) => pathOf.get(id))).toEqual(["MixedCase", "MIXEDCASE"]);
    // And still a subset of the members, so the predicate both sides apply
    // cannot count a declaration the group does not contain.
    expect((group?.natives ?? []).every((id) => group?.members.includes(id))).toBe(true);
  });

  it("offers both members of a contender group rather than withholding either", () => {
    // The alternative D3 rejected was to offer NEITHER member of a pair that
    // could not be told apart. The host redeems a selection by filtering the
    // offered entries on the ids the webview ticked
    // (`WorktreeHost.ts:1980-1981`), so a withheld member is one that no id can
    // reach — which is what this reproduces rather than describes.
    const store = createProvisionOfferStore();
    const offer = store.issue(A, {
      ...model("MixedCase"),
      entries: [
        { id: "i1", path: "MixedCase", mode: "copy", source: ".vscode/worktree.json" },
        { id: "i2", path: "mixedcase", mode: "link", source: "orca.yaml" },
      ],
      contenders: [{ members: ["i1", "i2"], natives: ["i1"] }],
    });

    const redeemed = store.lookup(A, offer.offerId);
    const ticked = new Set(offer.model.contenders[0]?.members ?? []);
    const selected = (redeemed?.entries ?? []).filter((e) => ticked.has(e.id));

    expect(selected.map((e) => [e.path, e.mode])).toEqual([
      ["MixedCase", "copy"],
      ["mixedcase", "link"],
    ]);
  });

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

describe("ids are scoped to the offer, not to the adapter (round-2 W4)", () => {
  /** Two adapters' output, each minted from its own counter starting at i1. */
  function merged(): ProvisionModel {
    return {
      entries: [
        { id: "i1", path: ".env", mode: "copy", source: "asimov/worktree.yaml" },
        { id: "i2", path: "third_party", mode: "link", source: "asimov/worktree.yaml" },
        { id: "i1", path: ".vscode/settings.json", mode: "copy", source: ".vscode/worktree.json" },
      ],
      ports: [{ id: "i2", name: "APP", source: ".vscode/worktree.json" }],
      setup: [{ id: "i1", kind: "shell", script: "pnpm install", source: ".vscode/worktree.json" }],
      providers: [
        { id: "asimov", files: ["asimov/worktree.yaml"], active: true },
        { id: "vscodeTasks", files: [".vscode/worktree.json"], active: false },
      ],
      excluded: [],
      contenders: [],
      problems: [],
    };
  }

  it("gives every row a distinct id even when two adapters both minted i1", () => {
    // `issue` is the assembly point — it already receives the completed model —
    // so reminting here needs no registry, no detection order and no merge
    // algorithm, which is what made this look like a later task's job.
    const store = createProvisionOfferStore();
    const offer = store.issue(A, merged());
    const ids = [...offer.model.entries, ...offer.model.ports, ...offer.model.setup].map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it("keeps everything about a row except its id", () => {
    const store = createProvisionOfferStore();
    const offer = store.issue(A, merged());

    expect(offer.model.entries.map((e) => [e.path, e.mode, e.source])).toEqual([
      [".env", "copy", "asimov/worktree.yaml"],
      ["third_party", "link", "asimov/worktree.yaml"],
      [".vscode/settings.json", "copy", ".vscode/worktree.json"],
    ]);
    expect(offer.model.setup[0]?.script).toBe("pnpm install");
    expect(offer.model.problems).toEqual([]);
    expect(offer.model.providers).toHaveLength(2);
  });

  it("mints ids that are not paths and not derived from one", () => {
    const store = createProvisionOfferStore();
    const offer = store.issue(A, merged());
    const ids = [...offer.model.entries, ...offer.model.ports, ...offer.model.setup].map((r) => r.id);

    expect(ids.every((id) => !id.includes("/") && !id.includes("."))).toBe(true);
  });

  it("does not reuse ids across two offers to the same form", () => {
    // A superseded id must resolve to nothing rather than name whatever now
    // occupies that slot.
    const store = createProvisionOfferStore();
    const first = store.issue(A, merged());
    const second = store.issue(A, merged());
    const idsOf = (m: ProvisionModel) => [...m.entries, ...m.ports, ...m.setup].map((r) => r.id);

    expect(new Set([...idsOf(first.model), ...idsOf(second.model)]).size).toBe(10);
  });
});
