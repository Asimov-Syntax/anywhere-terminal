import { describe, expect, it } from "vitest";
import type { ClaudeSessionRecord } from "../vault/readers/runningSessions";
import { composeSessionViews, type SessionPathResolver } from "./sessionViews";

/** Records what it was asked to resolve, so "never resolved" is assertable. */
function resolver(): SessionPathResolver & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    prepare(paths) {
      asked.push(...paths);
      return Promise.resolve();
    },
    resolvedOr: (path) => `real:${path}`,
  };
}

function record(over: Partial<ClaudeSessionRecord> = {}): ClaudeSessionRecord {
  return { pid: 1, sessionId: "s-1", cwd: "/elsewhere", alive: true, ...over } as ClaudeSessionRecord;
}

describe("composeSessionViews", () => {
  it("keeps a losing live duplicate in `live` and out of `canonical`", async () => {
    // The whole point of two views (round-1 B2). The interactive record outside
    // the target is the registry's canonical winner; the headless one inside it
    // loses that selection but is still a live pid in that directory, so the
    // ownership proof must keep seeing it.
    const inside = record({ pid: 2, cwd: "/repo/wt-a", entrypoint: "sdk-ts" });
    const outside = record({ pid: 3, cwd: "/elsewhere" });

    const views = await composeSessionViews([inside, outside], false, resolver());

    expect(views.live.map((s) => s.cwd)).toEqual(["real:/repo/wt-a", "real:/elsewhere"]);
    expect(views.canonical.map((s) => s.cwd)).toEqual(["real:/elsewhere"]);
  });

  it("never asks the resolver about a dead record's path", async () => {
    // The growth axis is user-wide stale session history, and a dead record is
    // inert in both views — so resolving it was unbounded work for an answer
    // nobody reads (round-1 B3a).
    const paths = resolver();

    const views = await composeSessionViews(
      [record({ pid: 4, cwd: "/long/dead", alive: false }), record({ pid: 5, cwd: "/repo/wt-a" })],
      false,
      paths,
    );

    expect(paths.asked).toEqual(["/repo/wt-a"]);
    expect(views.live).toHaveLength(1);
    expect(views.canonical).toHaveLength(1);
  });

  it("carries `partial` through rather than dropping it", async () => {
    // It is the only thing that stops an incomplete scan reading as proof that
    // nobody is here, about the one action that cannot be undone (round-1 W1).
    const views = await composeSessionViews([record()], true, resolver());

    expect(views.partial).toBe(true);
  });

  it("a complete scan is not partial", async () => {
    expect((await composeSessionViews([record()], false, resolver())).partial).toBe(false);
  });

  it("names each session by its registry identity, never its pid", async () => {
    const views = await composeSessionViews([record({ sessionId: "s-7" })], false, resolver());

    expect(views.live[0]?.entryId).toBe("claude:s-7");
    expect(views.live[0]?.activity).toBeUndefined();
  });
});
