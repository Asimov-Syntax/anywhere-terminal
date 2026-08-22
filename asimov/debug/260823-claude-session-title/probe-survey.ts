import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readLatestAiTitle } from "../../../src/vault/readers/claudeRecords";

const root = path.join(os.homedir(), ".claude", "projects");
const dirs = await fs.readdir(root);
const all: { p: string; size: number; mtime: number }[] = [];
for (const d of dirs) {
  let names: string[];
  try {
    names = await fs.readdir(path.join(root, d));
  } catch {
    continue;
  }
  for (const n of names.filter((x) => x.endsWith(".jsonl"))) {
    const p = path.join(root, d, n);
    const st = await fs.stat(p);
    all.push({ p, size: st.size, mtime: st.mtimeMs });
  }
}
all.sort((a, b) => b.mtime - a.mtime);
let noai = 0;
let deep = 0;
let ok = 0;
for (const f of all.slice(0, 120)) {
  if (f.size < 20000) continue;
  const buf = await fs.readFile(f.p, "utf8");
  const last = buf.lastIndexOf('"type":"ai-title"');
  const tail = await readLatestAiTitle(f.p);
  if (last < 0) {
    noai++;
    console.log(`NOAI size=${f.size} ${path.basename(f.p)}`);
  } else if (tail === undefined) {
    deep++;
    console.log(`DEEP dist=${f.size - last} size=${f.size} ${path.basename(f.p)}`);
  } else {
    ok++;
  }
}
console.log({ ok, noai, deep });
