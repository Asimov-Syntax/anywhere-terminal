import { describe, expect, it } from "vitest";
import { createDebrisAuthorizationStore, type DebrisEvidence } from "./debrisAuthorization";
import { FINGERPRINT_TTL_MS } from "./worktreeFingerprint";

const PATH = "/trees/repo-feat";

function evidence(entries: readonly string[], identity: string | null = "dev:1|ino:2"): DebrisEvidence {
  return { entries, identity };
}

describe("createDebrisAuthorizationStore", () => {
  it("proceeds where what is there now is what was authorized", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a", "b"]), 0);
    expect(store.redeem(PATH, token, evidence(["a", "b"]), 1)).toMatchObject({ kind: "proceed" });
  });

  it("proceeds where an entry disappeared — that is inside what the user approved", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a", "b"]), 0);
    expect(store.redeem(PATH, token, evidence(["a"]), 1)).toMatchObject({ kind: "proceed" });
  });

  it("re-prompts where an entry appeared — it was never named", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"]), 0);
    expect(store.redeem(PATH, token, evidence(["a", "b"]), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts where the same COUNT hides a replacement", () => {
    // A count comparison passes this. The set comparison is the point.
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a", "b"]), 0);
    expect(store.redeem(PATH, token, evidence(["a", "c"]), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts where the directory's identity changed", () => {
    // Same entries, different inode: the directory was replaced between the
    // authorization and the redemption.
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"], "dev:1|ino:2"), 0);
    expect(store.redeem(PATH, token, evidence(["a"], "dev:1|ino:9"), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts where identity became unreadable", () => {
    // "We can no longer tell which directory this is" is not a match.
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"], "dev:1|ino:2"), 0);
    expect(store.redeem(PATH, token, evidence(["a"], null), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts where the platform had no identity to record at issuance", () => {
    // A null recorded identity must not become a wildcard that matches anything.
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"], null), 0);
    expect(store.redeem(PATH, token, evidence(["a"], "dev:1|ino:2"), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("spends the token on sight, so one authorization is one attempt", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"]), 0);
    expect(store.redeem(PATH, token, evidence(["a"]), 1)).toMatchObject({ kind: "proceed" });
    expect(store.redeem(PATH, token, evidence(["a"]), 2)).toMatchObject({ kind: "reprompt" });
  });

  it("spends the token even when it is REFUSED, so a refusal cannot be replayed", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"]), 0);
    expect(store.redeem(PATH, token, evidence(["a", "b"]), 1)).toMatchObject({ kind: "reprompt" });
    // The evidence now satisfies the token. It must still refuse: the record is gone.
    expect(store.redeem(PATH, token, evidence(["a"]), 2)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts a token issued for a different path", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"]), 0);
    expect(store.redeem("/trees/other", token, evidence(["a"]), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts a forged token", () => {
    const store = createDebrisAuthorizationStore();
    store.issue(PATH, evidence(["a"]), 0);
    expect(store.redeem(PATH, "not-the-token", evidence(["a"]), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("re-prompts once the record has expired", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"]), 0);
    expect(store.redeem(PATH, token, evidence(["a"]), FINGERPRINT_TTL_MS + 1)).toMatchObject({ kind: "reprompt" });
  });

  it("releases expired records rather than holding them for the session", () => {
    const store = createDebrisAuthorizationStore();
    store.issue(PATH, evidence(["a"]), 0);
    expect(store.size()).toBe(1);
    store.issue("/trees/other", evidence(["a"]), FINGERPRINT_TTL_MS + 1);
    expect(store.size()).toBe(1);
  });

  it("holds one record per path, replaced rather than appended", () => {
    const store = createDebrisAuthorizationStore();
    store.issue(PATH, evidence(["a"]), 0);
    store.issue(PATH, evidence(["a", "b"]), 1);
    expect(store.size()).toBe(1);
  });

  it("refuses the token the replacement superseded", () => {
    // Re-issuing is what a re-prompt does. The token the user is no longer
    // looking at must not still authorize anything.
    const store = createDebrisAuthorizationStore();
    const first = store.issue(PATH, evidence(["a"]), 0);
    store.issue(PATH, evidence(["a", "b"]), 1);
    expect(store.redeem(PATH, first, evidence(["a"]), 2)).toMatchObject({ kind: "reprompt" });
  });

  it("honours the replacement token", () => {
    const store = createDebrisAuthorizationStore();
    store.issue(PATH, evidence(["a"]), 0);
    const second = store.issue(PATH, evidence(["a", "b"]), 1);
    expect(store.redeem(PATH, second, evidence(["a", "b"]), 2)).toMatchObject({ kind: "proceed" });
  });

  it("forgets a path on request", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a"]), 0);
    store.forget(PATH);
    expect(store.redeem(PATH, token, evidence(["a"]), 1)).toMatchObject({ kind: "reprompt" });
  });

  it("compares entries as a set, not as an ordered list", () => {
    const store = createDebrisAuthorizationStore();
    const token = store.issue(PATH, evidence(["a", "b"]), 0);
    expect(store.redeem(PATH, token, evidence(["b", "a"]), 1)).toMatchObject({ kind: "proceed" });
  });
});
