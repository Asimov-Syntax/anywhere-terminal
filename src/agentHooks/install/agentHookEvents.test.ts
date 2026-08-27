// src/agentHooks/install/agentHookEvents.test.ts — The listener's decision, at
// the seam where it is actually made. A location-only change reached the
// listener and then submitted an unforced reconciliation, so the event was
// delivered and declined to do anything (round-9 B15).

import { describe, expect, it } from "vitest";
import { agentHookSubmissions } from "./agentHookEvents";
import { AGENT_HOOK_REGISTRY } from "./agentHookRegistry";

const CLAUDE = AGENT_HOOK_REGISTRY.find((entry) => entry.locationSettingKeys.length > 0);
const CURSOR = AGENT_HOOK_REGISTRY.find((entry) => entry.locationSettingKeys.length === 0);

/** Matches the one key the event names, as `affectsConfiguration` would. */
const only =
  (key: string) =>
  (candidate: string): boolean =>
    candidate === key;

describe("what a configuration event asks each agent to do", () => {
  it("forces a reconciliation when only the configuration location moved", () => {
    const entry = CLAUDE;
    if (!entry) {
      throw new Error("no agent declares a location setting");
    }

    const submissions = agentHookSubmissions(
      AGENT_HOOK_REGISTRY,
      only(`anywhereTerminal.${entry.locationSettingKeys[0]}`),
    );

    // Enablement did not change, so an unforced submission reconciles nothing
    // and the hooks stay registered at the path the user just moved away from.
    expect(submissions).toEqual([{ entry, force: true }]);
  });

  it("does not force one when only the enablement changed", () => {
    const entry = CLAUDE;
    if (!entry) {
      throw new Error("no agent declares a location setting");
    }

    const submissions = agentHookSubmissions(AGENT_HOOK_REGISTRY, only(`anywhereTerminal.${entry.enabledSettingKey}`));

    expect(submissions).toEqual([{ entry, force: false }]);
  });

  it("asks nothing of an agent the event does not concern", () => {
    const submissions = agentHookSubmissions(AGENT_HOOK_REGISTRY, only("anywhereTerminal.somethingElse"));

    expect(submissions).toEqual([]);
  });

  it("answers only the agents the event names, not every registered one", () => {
    const entry = CURSOR;
    if (!entry) {
      throw new Error("no agent without a location setting");
    }

    const submissions = agentHookSubmissions(AGENT_HOOK_REGISTRY, only(`anywhereTerminal.${entry.enabledSettingKey}`));

    expect(submissions.map((submission) => submission.entry.agent)).toEqual([entry.agent]);
  });
});
