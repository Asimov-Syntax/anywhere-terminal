// src/agentHooks/install/activation.ts — The order activation has to keep, as
// something other than a sequence of statements inside `activate`.
//
// Reading the record after installing let the first install of a session record
// its destination against an empty view, overwriting the record naming the file
// the previous session wrote: the record was consulted only after the write that
// destroyed it (round-9 B14). That is an ordering, and an ordering buried in a
// 1,400-line activation function is one nothing can hold in place.

export interface AgentHookStartup {
  /** Reads the durable record. Best-effort by contract, so it never rejects. */
  loadLedger(): Promise<void>;
  /** Installs or removes per the current settings — the first thing that WRITES. */
  startController(): Promise<void>;
  /** Retries what a previous session recorded but could not clean (D13). */
  reconcileAll(): Promise<unknown>;
}

/**
 * Nothing installs before the record is read (D19). The reconcile is deliberately
 * not awaited: it retries old obligations and must not hold activation open.
 */
export async function startAgentHooks(startup: AgentHookStartup): Promise<void> {
  await startup.loadLedger();
  await startup.startController();
  void startup.reconcileAll();
}
