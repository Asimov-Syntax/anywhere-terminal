import fs from "node:fs";

export async function removeTree(dir: string, member: "rm" | "rmdir"): Promise<void> {
  await fs.promises[member](dir);
}
