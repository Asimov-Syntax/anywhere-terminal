import fs from "node:fs";

export function removeTree(dir: string): void {
  fs.rmSync(dir, { recursive: true });
}
