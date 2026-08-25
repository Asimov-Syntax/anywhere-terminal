// src/vault/readers/detailContract.testkit.ts — the assertions every vault
// reader's detail must satisfy, called from each reader's OWN test file.
//
// Assertions, not fixtures: the four readers' fixture mechanisms share nothing
// (temp JSONL, temp rollouts + injected SQL, SQL-text dispatch, injected fs
// seams, real SQLite), so a shared suite would collapse into four near-identical
// files whose only common part is what is asserted. That part lives here.
//
// Every assertion FAILS when handed nothing to check, so a vacuous call on a
// null or childless detail cannot pass as coverage.

import { expect } from "vitest";
import type { VaultSessionDetail } from "../types";
import { MAX_DETAIL_LIMIT } from "./detail";

/** Invariants of the detail contract itself, independent of which agent produced it. */
export function expectDetailContract(detail: VaultSessionDetail | null, label: string): VaultSessionDetail {
  expect(detail, `${label}: expected a detail to check, got null`).not.toBeNull();
  const d = detail as VaultSessionDetail;

  expect(d.entryId, `${label}: entryId must be <agent>:<sessionId>`).toMatch(/^[a-z]+:.+/);
  expect(["timeline", "metadata-only"], `${label}: contentKind must be declared`).toContain(d.contentKind);

  if (d.contentKind === "metadata-only") {
    // Nothing was decoded, so there is nothing to render or to page through.
    expect(d.timeline, `${label}: a metadata-only detail carries no timeline`).toEqual([]);
    expect(d.recentActivity, `${label}: a metadata-only detail carries no activity`).toEqual([]);
    // Absent, not merely falsy: the spec says a metadata-only detail carries no
    // pageability signal, and an explicit `false` is still a signal.
    expect(d.truncated, `${label}: a metadata-only detail must not carry a truncated signal`).toBeUndefined();
    expect(d.partial, `${label}: a metadata-only detail is by definition partial`).toBe(true);
  }

  // The two completeness axes are independent, but each must be self-consistent:
  // a partial detail explains itself, and a complete one claims no reason.
  if (d.partial) {
    expect(typeof d.limitedReason, `${label}: partial detail needs a limitedReason`).toBe("string");
    expect((d.limitedReason ?? "").length, `${label}: limitedReason must not be empty`).toBeGreaterThan(0);
  } else {
    expect(d.limitedReason, `${label}: a complete detail carries no limitedReason`).toBeUndefined();
  }

  expect(d.stats, `${label}: stats are required`).toBeDefined();
  for (const [key, value] of Object.entries(d.stats)) {
    expect(value, `${label}: stats.${key} must be a non-negative number`).toBeGreaterThanOrEqual(0);
  }
  return d;
}

/**
 * Re-read at growing limits while `truncated` holds: every increase must return
 * STRICTLY more timeline items, and the walk must END with `truncated` false.
 *
 * A stall is the load-more defect — the preview offers a button that yields
 * nothing — and so is a reader still claiming `truncated` once it has been asked
 * for `MAX_DETAIL_LIMIT`, because the webview cannot ask for more than that.
 */
export async function expectLimitGrowth(
  read: (limit: number) => Promise<VaultSessionDetail | null>,
  opts: { start: number; label: string; maxRounds?: number },
): Promise<void> {
  const { start, label } = opts;
  const maxRounds = opts.maxRounds ?? 12;

  let limit = start;
  let previous = expectDetailContract(await read(limit), `${label} @${limit}`);
  expect(previous.truncated, `${label}: fixture is not truncated at limit ${limit} — nothing to page`).toBe(true);

  for (let round = 0; round < maxRounds; round++) {
    expect(
      limit,
      `${label}: still truncated at the ${MAX_DETAIL_LIMIT} ceiling — load-more can never end`,
    ).toBeLessThan(MAX_DETAIL_LIMIT);
    const nextLimit = Math.min(limit * 2, MAX_DETAIL_LIMIT);
    const next = expectDetailContract(await read(nextLimit), `${label} @${nextLimit}`);
    expect(
      next.timeline.length,
      `${label}: raising the limit ${limit} → ${nextLimit} returned no additional items`,
    ).toBeGreaterThan(previous.timeline.length);
    if (!next.truncated) {
      return;
    }
    limit = nextLimit;
    previous = next;
  }
  expect.fail(`${label}: still truncated after ${maxRounds} rounds — load-more does not converge`);
}

/** Every child a detail advertises must resolve to a readable detail of its own. */
export async function expectResolvableChildren(
  detail: VaultSessionDetail | null,
  resolve: (entryId: string) => Promise<VaultSessionDetail | null>,
  label: string,
): Promise<void> {
  const d = expectDetailContract(detail, label);
  const children = d.timeline.filter((item) => item.kind === "subagentSession" && !!item.entryId);
  expect(children.length, `${label}: expected at least one child to resolve, found none`).toBeGreaterThan(0);

  for (const child of children) {
    const entryId = (child as { entryId: string }).entryId;
    expectDetailContract(await resolve(entryId), `${label} → child ${entryId}`);
  }
}
