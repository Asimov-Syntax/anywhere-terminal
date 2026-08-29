// The window's answer to "has this session's delegation history been asked for
// yet" — one answer, shared by the tree and the inspector (design.md D6).

import { describe, expect, it } from "vitest";
import { agentRow } from "./worktreeFixtures";
import { RosterRequests, rosterKey } from "./worktreeRosterRequests";

const withSession = (rowId: string, entryId = "claude:s1"): ReturnType<typeof agentRow> =>
  agentRow({ rowId, entryId, agent: "claude" });

/** Everything `flush` sent, in order. */
function drain(reqs: RosterRequests): string[] {
  const sent: string[] = [];
  reqs.flush((row) => sent.push(row.rowId));
  return sent;
}

describe("rosterKey", () => {
  it("has no key for a row with no session", () => {
    // Nothing to ask about: the roster is keyed by the session, not the row.
    expect(rosterKey(agentRow({ rowId: "a" }))).toBeUndefined();
  });

  it("keys the pane and the session together", () => {
    // The same pane after a resume is a different session and a different
    // roster; keying on the row alone would suppress the second read.
    expect(rosterKey(withSession("a", "claude:s1"))).not.toBe(rosterKey(withSession("a", "claude:s2")));
    expect(rosterKey(withSession("a"))).not.toBe(rosterKey(withSession("b")));
  });
});

describe("RosterRequests", () => {
  it("sends nothing until it is flushed", () => {
    // The whole point of the split: `want` is called from inside a render, and a
    // dep that answered synchronously would re-enter it.
    const reqs = new RosterRequests();
    let sends = 0;
    reqs.want(withSession("a"));
    expect(sends).toBe(0);
    reqs.flush(() => {
      sends += 1;
    });
    expect(sends).toBe(1);
  });

  it("asks once for a row two surfaces both want", () => {
    const reqs = new RosterRequests();
    reqs.want(withSession("a"));
    reqs.want(withSession("a"));
    expect(drain(reqs)).toEqual(["a"]);
  });

  it("does not ask again on a later render", () => {
    const reqs = new RosterRequests();
    reqs.want(withSession("a"));
    expect(drain(reqs)).toEqual(["a"]);
    reqs.want(withSession("a"));
    expect(drain(reqs)).toEqual([]);
  });

  it("never asks for a row with no session", () => {
    const reqs = new RosterRequests();
    reqs.want(agentRow({ rowId: "a" }));
    expect(drain(reqs)).toEqual([]);
  });

  it("asks again once the row has left and come back", () => {
    // The host evicted the roster with the row, so a set that remembers asking
    // leaves the returning row on "Reading…" with nothing coming.
    const reqs = new RosterRequests();
    const row = withSession("a");
    reqs.want(row);
    expect(drain(reqs)).toEqual(["a"]);

    reqs.reconcile(new Set());
    reqs.want(row);
    expect(drain(reqs)).toEqual(["a"]);
  });

  it("keeps remembering a row that is still live", () => {
    const reqs = new RosterRequests();
    const row = withSession("a");
    reqs.want(row);
    drain(reqs);

    const live = rosterKey(row);
    if (live === undefined) {
      throw new Error("fixture lost its session");
    }
    reqs.reconcile(new Set([live]));
    reqs.want(row);
    expect(drain(reqs)).toEqual([]);
  });

  it("leaves the rows behind a failed send askable", () => {
    // Every key is written to `asked` by `want`, so a row dropped by a throwing
    // callback can never be wanted again and sits on "Reading…" for the session
    // — including the rows that were never even attempted (round-1 W3).
    const reqs = new RosterRequests();
    reqs.want(withSession("a"));
    reqs.want(withSession("b"));
    reqs.want(withSession("c"));
    expect(() =>
      reqs.flush((row) => {
        if (row.rowId === "a") {
          throw new Error("host gone");
        }
      }),
    ).toThrow("host gone");

    // b and c were queued and never sent, so they are still owed…
    expect(drain(reqs)).toEqual(["b", "c"]);
    // …and a, which failed, can be asked for again.
    reqs.want(withSession("a"));
    expect(drain(reqs)).toEqual(["a"]);
  });

  it("survives a send that queues another want", () => {
    // A synchronous answer is what the deferral exists for; it must not lose the
    // request it makes, nor replay the one being sent.
    const reqs = new RosterRequests();
    reqs.want(withSession("a"));
    const sent: string[] = [];
    reqs.flush((row) => {
      sent.push(row.rowId);
      reqs.want(withSession("b"));
    });
    expect(sent).toEqual(["a"]);
    expect(drain(reqs)).toEqual(["b"]);
  });
});
