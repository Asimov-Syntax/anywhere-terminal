// src/worktree/provisioning/provisioningDeps.ts — The real filesystem behind
// `readAsimovProvisioning`.
//
// The adapter takes its reads injected so its suite needs no disk. This is the
// one place that supplies the real ones, and the one place the byte budget is
// enforced — the adapter classifies failures, it does not perform them.

import { lstat, open, readdir, realpath } from "node:fs/promises";
import type { AsimovProviderDeps } from "./asimovProvider";

/**
 * The most a provider file may weigh.
 *
 * `asimov/worktree.yaml` is a short declaration; anything approaching this is
 * not one. The cap exists because the file is checked in and therefore
 * untrusted, and both the buffer and the parsed object are held in the
 * extension host (.reviews/round-1.md W1).
 */
export const MAX_PROVIDER_BYTES = 256 * 1024;

/**
 * Read at most `maxBytes + 1` bytes, and refuse the file if it has more.
 *
 * Bounded by the READ itself rather than by a prior `stat().size`: a file that
 * grows or is replaced between the stat and the read outruns the check (TOCTOU).
 * The handle is always closed, and no more than `maxBytes + 1` bytes are ever
 * materialized.
 *
 * Errors are THROWN with their errno intact rather than collapsed to a
 * sentinel. The adapter has to tell absence from denial to satisfy the
 * unreadable-file scenario, so a reader that answers `undefined` for both would
 * defeat it (round-1 B8). Oversize is reported as `EFBIG`, which is a failure
 * to read rather than a failure to find.
 */
async function readBounded(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buf.length) {
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total);
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
    }
    if (total > maxBytes) {
      throw Object.assign(new Error(`provider file exceeds ${maxBytes} bytes`), { code: "EFBIG" });
    }
    return buf.subarray(0, total).toString("utf8");
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * The adapter's dependencies over the real filesystem.
 *
 * `realpath` and `lstat` are supplied because containment is decided on the
 * RESOLVED path — the answer authorizes a read, so a symlinked component has to
 * be followed before it is trusted (design.md D4).
 */
export function createProvisioningDeps(): AsimovProviderDeps {
  return {
    readFile: (p) => readBounded(p, MAX_PROVIDER_BYTES),
    readdir: (p) => readdir(p),
    realpath: (p) => realpath(p),
    lstat: (p) => lstat(p),
  };
}
