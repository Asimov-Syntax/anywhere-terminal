import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAsimovProvisioning } from "./asimovProvider";
import { createProvisioningDeps, MAX_PROVIDER_BYTES } from "./provisioningDeps";

/**
 * The production dependencies against a real checkout.
 *
 * Every other suite here injects fakes, which is what let the whole feature ship
 * unwired: the adapter was proved against a filesystem nobody runs
 * (.reviews/round-1.md B1). This one runs the real `node:fs` seam the extension
 * entry point uses, so a dep of the wrong shape fails here rather than silently
 * in a shipped window.
 */
describe("createProvisioningDeps", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "prov-"));
    await mkdir(path.join(root, "asimov"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = (rel: string, text: string) => writeFile(path.join(root, rel), text, "utf8");
  const read = () => readAsimovProvisioning(createProvisioningDeps(), root);

  it("reads a real provider file and expands a real glob", async () => {
    await write("asimov/worktree.yaml", "copy:\n  - .env\n  - docs/*.md\nsetup:\n  - pnpm install\n");
    await write(".env", "X=1");
    await mkdir(path.join(root, "docs"));
    await write("docs/a.md", "a");
    await write("docs/b.txt", "b");

    const model = await read();

    expect(model.entries.map((e) => e.path)).toEqual([".env", "docs/a.md"]);
    expect(model.setup.map((s) => s.script)).toEqual(["pnpm install"]);
    expect(model.problems).toEqual([]);
  });

  it("returns an empty model for a checkout with no provider file", async () => {
    const model = await read();

    expect(model.problems).toEqual([]);
    expect(model.providers).toEqual([]);
  });

  it("[W1] refuses an oversized provider file instead of parsing it", async () => {
    // Bounded at the read. The file is valid YAML, so anything that parsed it
    // would succeed — the refusal has to come from the byte budget.
    await write("asimov/worktree.yaml", `copy:\n${"  - a.txt\n".repeat(MAX_PROVIDER_BYTES / 8)}`);

    const model = await read();

    expect(model.problems.map((p) => p.reason)).toEqual(["unreadable"]);
    expect(model.entries).toEqual([]);
  });

  it("[B2] refuses a glob match that is a symlink out of the checkout", async () => {
    // The real `realpath`, not a fake — this is the case the injected suite can
    // only approximate.
    const outside = await mkdtemp(path.join(tmpdir(), "prov-out-"));
    try {
      await write("asimov/worktree.yaml", "copy:\n  - docs/*.md\n");
      await mkdir(path.join(root, "docs"));
      await write("docs/safe.md", "safe");
      await writeFile(path.join(outside, "secret.md"), "secret", "utf8");
      await symlink(path.join(outside, "secret.md"), path.join(root, "docs", "escape.md"));

      const model = await read();

      expect(model.entries.map((e) => e.path)).toEqual(["docs/safe.md"]);
      expect(model.problems.map((p) => p.reason)).toEqual(["malformed"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("[B2] refuses a provider file that is itself a symlink out of the checkout", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "prov-out-"));
    try {
      await writeFile(path.join(outside, "evil.yaml"), "copy:\n  - .env\n", "utf8");
      await symlink(path.join(outside, "evil.yaml"), path.join(root, "asimov", "worktree.yaml"));

      const model = await read();

      expect(model.entries).toEqual([]);
      expect(model.problems.map((p) => p.reason)).toEqual(["malformed"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
