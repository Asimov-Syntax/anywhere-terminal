import fs from "node:fs";

export async function removeTree(dir: string): Promise<void> {
  // The bracket spelling IS the fixture: an earlier rule read `fs.promises.rm` and missed this.
  // biome-ignore lint/complexity/useLiteralKeys: simplifying the key deletes the case under test
  await fs.promises["rm"](dir, { recursive: true });
}
