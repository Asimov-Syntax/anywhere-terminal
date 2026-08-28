import fs from "node:fs";

let wipe: typeof fs.promises.rm;

export async function removeTree(dir: string): Promise<void> {
  ({
    promises: { rm: wipe },
  } = fs);
  await wipe(dir, { recursive: true });
}
