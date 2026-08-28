import fs from "node:fs";

const anyFs: any = fs.promises;

export async function removeTree(dir: string): Promise<void> {
  await anyFs.rm(dir, { recursive: true });
}
