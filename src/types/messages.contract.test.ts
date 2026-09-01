// src/types/messages.contract.test.ts — the shapes that must not compile.
//
// `ProvisionSelection`, `BranchDeleteOffer` and `BranchDeleteRequest` have no
// producer until WT-012.1 and WT-013.3, so their acceptance cannot be a runtime
// one. It is this file: `pnpm run check-types` judges every `@ts-expect-error`
// below, and a directive on a line that DOES compile is itself a type error —
// which is what makes the assertion real rather than decorative (design.md D6).
//
// Each negative case is matched by a positive one, so a union accidentally
// widened to `any` fails here instead of passing silently.

import { describe, expect, it } from "vitest";
import type {
  BranchDeleteOffer,
  BranchDeleteRequest,
  DestinationDisposition,
  ExtensionToWebViewMessage,
  ProvisionSelection,
  ProvisionStepOutcome,
  ProvisionStepResult,
  WorktreeAfterCreate,
  WorktreeCreateMode,
  WorktreeProvisionResultMessage,
} from "./messages";

type Mode<K extends WorktreeCreateMode["kind"]> = Extract<WorktreeCreateMode, { kind: K }>;
type After<K extends WorktreeAfterCreate["kind"]> = Extract<WorktreeAfterCreate, { kind: K }>;

// --- Every mode constructs ---------------------------------------------------

const fresh: Mode<"fresh"> = { kind: "fresh", branch: "feat/x" };
const freshFromBase: Mode<"fresh"> = { kind: "fresh", branch: "feat/x", baseRef: "main" };
const detached: Mode<"fresh-detached"> = { kind: "fresh-detached", baseRef: "HEAD" };
const reuse: Mode<"reuse"> = { kind: "reuse", branch: "feat/x" };
const reattach: Mode<"reattach"> = {
  kind: "reattach",
  branch: "feat/x",
  repairPath: "/wt/x",
  expectedOid: "abc123",
};
const adopt: Mode<"adopt"> = {
  kind: "adopt",
  branch: "feat/x",
  adoptPath: "/wt/x",
  expectedBranchOid: "abc123",
};

// --- A base ref belongs to the modes that create one -------------------------

// `reuse` checks out a branch that exists; there is nothing for a base to seed.
// @ts-expect-error reuse carries no base ref
const reuseWithBase: Mode<"reuse"> = { kind: "reuse", branch: "feat/x", baseRef: "main" };

// `reattach` re-points an administrative entry at a branch that already exists.
const reattachWithBase: Mode<"reattach"> = {
  kind: "reattach",
  branch: "feat/x",
  repairPath: "/wt/x",
  expectedOid: "abc123",
  // @ts-expect-error reattach carries no base ref
  baseRef: "main",
};

const adoptWithBase: Mode<"adopt"> = {
  kind: "adopt",
  branch: "feat/x",
  adoptPath: "/wt/x",
  expectedBranchOid: "abc123",
  // @ts-expect-error adopt carries no base ref
  baseRef: "main",
};

// A detached checkout has no branch to name — that is what detached means.
// @ts-expect-error fresh-detached carries no branch
const detachedWithBranch: Mode<"fresh-detached"> = { kind: "fresh-detached", baseRef: "HEAD", branch: "feat/x" };

// The base ref is required, not optional: the controller substitutes "HEAD"
// where the field is blank, so the type can insist on it (design.md D2).
// @ts-expect-error fresh-detached requires a base ref
const detachedNoBase: Mode<"fresh-detached"> = { kind: "fresh-detached" };

// --- The agent fields live only on the agent variant -------------------------

const none: After<"none"> = { kind: "none" };
const terminal: After<"terminal"> = { kind: "terminal" };
const newWindow: After<"newWindow"> = { kind: "newWindow" };
const addToWorkspace: After<"addToWorkspace"> = { kind: "addToWorkspace" };
const agent: After<"agent"> = {
  kind: "agent",
  waitForSetup: true,
  agent: "claude",
  offerId: "offer-1",
  generation: 7,
};

// A draft that chose "Nothing" is structurally incapable of launching one.
// @ts-expect-error a non-agent after-create carries no agent
const noneWithAgent: After<"none"> = { kind: "none", agent: "claude" };

// The setup gate exists to sequence an agent; without one it has nothing to gate.
// @ts-expect-error a non-agent after-create carries no setup gate
const terminalWithWait: After<"terminal"> = { kind: "terminal", waitForSetup: true };

// --- A selection names ids, never what to run --------------------------------

const selection: ProvisionSelection = { offerId: "offer-1", itemIds: ["item-1", "item-2"] };

// Command text on this message would make the webview the authority on what
// executes — the property the untrusted-provider model exists to deny.
const selectionWithCommand: ProvisionSelection = {
  offerId: "offer-1",
  itemIds: ["item-1"],
  // @ts-expect-error a selection carries no command
  command: "pnpm install",
};

const selectionWithPath: ProvisionSelection = {
  offerId: "offer-1",
  itemIds: ["item-1"],
  // @ts-expect-error a selection carries no path
  path: "/repo/.env",
};

// --- The remaining shapes construct ------------------------------------------

const branchOffer: BranchDeleteOffer = {
  branch: "feat/x",
  branchOid: "abc123",
  defaultBranch: "main",
  defaultOid: "def456",
};
const branchDelete: BranchDeleteRequest = {
  branch: "feat/x",
  expectedBranchOid: "abc123",
  defaultBranch: "main",
  expectedDefaultOid: "def456",
  fingerprint: "fp-1",
};

const free: DestinationDisposition = { kind: "free" };
const debris: DestinationDisposition = {
  kind: "debris",
  authorization: { path: "/wt/x", fingerprint: "fp-1" },
};

// --- A step result answers an id, and never carries a path back as authority --

type Outcome<K extends ProvisionStepOutcome["kind"]> = Extract<ProvisionStepOutcome, { kind: K }>;

const copied: Outcome<"copied"> = { kind: "copied" };
const linked: Outcome<"linked"> = { kind: "linked" };
const degraded: Outcome<"degradedToCopy"> = { kind: "degradedToCopy" };
const skipped: Outcome<"skipped"> = { kind: "skipped", reason: "already there" };
const refusedOutcome: Outcome<"refused"> = { kind: "refused", reason: "resolves outside the repository" };
const failedOutcome: Outcome<"failed"> = { kind: "failed", reason: "EIO" };

// The three outcomes that mean "nothing happened" each carry WHY. A bare kind
// would render as an unexplained absence, which is what the spec forbids.
// @ts-expect-error a refusal states its reason
const refusedNoReason: Outcome<"refused"> = { kind: "refused" };

// A successful copy has nothing to explain, so it takes no reason field.
// @ts-expect-error a copy has no reason to give
const copiedWithReason: Outcome<"copied"> = { kind: "copied", reason: "because" };

const stepForFile: ProvisionStepResult = { id: "i3", path: ".env", outcome: copied };
const stepForDirectory: ProvisionStepResult = {
  id: "i4",
  path: "config",
  outcome: copied,
  // A directory entry has one outcome and many nodes: the descendant a copy
  // skipped has to be reportable (design.md D8).
  details: [{ path: "config/local.json", reason: "already there" }],
};

const provisionResult: WorktreeProvisionResultMessage = {
  type: "worktreeProvisionResult",
  worktreeId: "w1",
  steps: [stepForFile, stepForDirectory],
};

// It is an extension → webview message, so a panel switching on the union sees it.
const provisionResultInUnion: ExtensionToWebViewMessage = provisionResult;

// Provisioning never says whether the create succeeded — that is the create's
// own result, and this message arrives after it (worktree-apply.md § 1).
const provisionResultWithVerdict: WorktreeProvisionResultMessage = {
  type: "worktreeProvisionResult",
  worktreeId: "w1",
  steps: [],
  // @ts-expect-error a provision result carries no verdict on the create
  ok: false,
};

describe("the wire contract", () => {
  it("is judged by pnpm run check-types, not by this assertion", () => {
    // The suite exists so the file is a valid Vitest module; the proofs above
    // are the acceptance, and they fail the build rather than this test.
    expect([fresh, freshFromBase, detached, reuse, reattach, adopt].map((m) => m.kind)).toEqual([
      "fresh",
      "fresh",
      "fresh-detached",
      "reuse",
      "reattach",
      "adopt",
    ]);
    expect([none, terminal, newWindow, addToWorkspace, agent].map((a) => a.kind)).toEqual([
      "none",
      "terminal",
      "newWindow",
      "addToWorkspace",
      "agent",
    ]);
    expect([free, debris].map((d) => d.kind)).toEqual(["free", "debris"]);
    expect(branchDelete.expectedBranchOid).toBe(branchOffer.branchOid);
    expect(selection.itemIds).toHaveLength(2);
    expect([reuseWithBase, reattachWithBase, adoptWithBase, detachedWithBranch, detachedNoBase]).toHaveLength(5);
    expect([noneWithAgent, terminalWithWait, selectionWithCommand, selectionWithPath]).toHaveLength(4);
    expect([copied, linked, degraded, skipped, refusedOutcome, failedOutcome].map((o) => o.kind)).toEqual([
      "copied",
      "linked",
      "degradedToCopy",
      "skipped",
      "refused",
      "failed",
    ]);
    expect(stepForDirectory.details).toHaveLength(1);
    expect(provisionResultInUnion.type).toBe("worktreeProvisionResult");
    expect([refusedNoReason, copiedWithReason, provisionResultWithVerdict]).toHaveLength(3);
  });
});
