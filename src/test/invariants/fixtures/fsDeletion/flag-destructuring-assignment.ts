import fs from "node:fs";

let wipe: typeof fs.promises.rm;

export async function removeTree(dir: string): Promise<void> {
  ({ rm: wipe } = fs.promises);
  await wipe(dir, { recursive: true });
}
