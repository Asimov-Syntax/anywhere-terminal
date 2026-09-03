// src/webview/worktree/worktreeMessageHandlers.ts — The worktree route table.
// See: docs/design/worktree-rpc.md § 1;
//      asimov/changes/offer-a-pull-request-as-a-source/.reviews/round-1.md W4
//
// One owner for the routes that are pure delegation to `WorktreeController`.
// `main.ts` spreads this into its handler object, and the assembly test uses
// the same table rather than a hand-written copy of it — a second copy is what
// let a route exist in the test and not in production, which shipped a feature
// dark once during this change's own build.

import type { MessageHandlers } from "../messaging/MessageRouter";
import type { WorktreeController } from "./WorktreeController";

/** The routes this table owns. Anything main.ts writes differently stays out. */
export type WorktreeDelegatedHandlers = Pick<
  MessageHandlers,
  | "onWorktreeRowActivation"
  | "onWorktreeShowPreview"
  | "onWorktreeActivatePane"
  | "onWorktreeCreateDefaults"
  | "onWorktreeMigrationOffer"
  | "onWorktreeProvisionOffer"
  | "onWorktreeRefs"
  | "onWorktreePullRequests"
  | "onWorktreeCreateResolution"
  | "onWorktreeDebrisAuthorized"
  | "onWorktreeDestinationPicked"
  | "onWorktreeMutationResult"
  | "onWorktreeProvisionResult"
  | "onWorktreeRemoveAssessment"
>;

/**
 * Route the worktree messages that go straight to the controller and nowhere
 * else.
 *
 * Takes a GETTER rather than the controller: both callers create the controller
 * after the handlers, and a captured `undefined` would route nothing while
 * looking wired.
 *
 * Deliberately NOT here: `onWorktreeTreeResponse`, which main.ts orders through
 * the tab-bar scope seam, and `onVaultLaunchTargets`, which main.ts routes by
 * the capability the reply echoes. Both do more than delegate, so folding them
 * in would make this table a lie about what production does.
 */
export function worktreeDelegatedHandlers(
  controller: () => WorktreeController | null | undefined,
): WorktreeDelegatedHandlers {
  return {
    onWorktreeRowActivation: (msg) => controller()?.setRowActivation(msg.activation),
    onWorktreeShowPreview: (msg) => {
      controller()?.showPreview(msg.entryId);
    },
    onWorktreeActivatePane: (msg) => {
      controller()?.activatePane(msg.paneId);
    },
    onWorktreeCreateDefaults: (msg) => controller()?.handleCreateDefaults(msg),
    onWorktreeMigrationOffer: (msg) => controller()?.handleMigrationOffer(msg),
    onWorktreeProvisionOffer: (msg) => controller()?.handleProvisionOffer(msg),
    onWorktreeRefs: (msg) => controller()?.handleRefs(msg),
    onWorktreePullRequests: (msg) => controller()?.handlePullRequests(msg),
    onWorktreeCreateResolution: (msg) => controller()?.handleCreateResolution(msg),
    onWorktreeDebrisAuthorized: (msg) => controller()?.handleDebrisAuthorized(msg),
    onWorktreeDestinationPicked: (msg) => controller()?.handleDestinationPicked(msg),
    onWorktreeMutationResult: (msg) => controller()?.handleMutationResult(msg),
    onWorktreeProvisionResult: (msg) => controller()?.handleProvisionResult(msg),
    onWorktreeRemoveAssessment: (msg) => controller()?.handleRemoveAssessment(msg),
  };
}
